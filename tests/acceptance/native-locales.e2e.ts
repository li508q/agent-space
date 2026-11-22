import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { supportedLocales } from '../../src/renderer/i18n/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

test(
  'five real locales keep review controls usable at 980px and native 200% zoom',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const issued = requireSuccess(
      fixture.human.createGrant({
        operationKey: 'locale:grant',
        spec: {
          label: 'Review client / 確認 / 검토',
          scope: { mode: 'space' },
          capabilities: { read: true, propose: true },
        },
      }),
    );
    assert.ok(issued.token);
    const status = requireSuccess(fixture.human.status());
    const agent = requireSuccess(
      fixture.space.agent({
        grantId: issued.grant.id,
        token: issued.token,
        instanceId: status.instanceId,
      }),
    );
    const purpose = 'Refine retry policy · 中文 · 日本語 · 한국어 · español';
    const reason =
      'Measurements support a single retry for transient failures. '.repeat(10) +
      'Human-authored evidence remains unchanged: café, 日本語, 한국어, 中文.';
    const proposal = requireSuccess(
      agent.propose({
        operationKey: 'locale:proposal',
        action: 'update',
        targetId: fixture.ids.retryPolicy,
        baseRevision: 1,
        purpose,
        reason,
        sources: [{ mode: 'pinned', objectId: fixture.ids.measurements, revision: 1 }],
        patch: { body: '# Retry policy\n\nRetry once; investigate persistent failures.\n' },
      }),
    );
    const native = await launchNative({ entry: root, userData: join(fixture.root, 'Locales') });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 980, height: 850 }),
      );
      const evidence = join(root, '.coordination/screenshots/locales');
      mkdirSync(evidence, { recursive: true });
      for (const locale of supportedLocales) {
        for (const scale of [1, 2] as const) {
          await native.page.getByTestId('settings-button').click();
          await native.page.getByTestId('locale-select').selectOption(locale);
          await native.page.waitForFunction(
            (expected) => document.documentElement.lang === expected,
            locale,
          );
          await native.page.getByTestId('text-scale-select').selectOption(String(scale));
          await native.page.waitForFunction(
            (expected) =>
              document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
              expected,
            String(scale),
          );
          assert.equal(
            await native.application.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
            ),
            scale,
          );
          assert.equal(
            await native.page
              .locator('html')
              .evaluate((element) => getComputedStyle(element).fontSize),
            '16px',
            'The renderer must not multiply native text zoom a second time.',
          );
          await native.page.keyboard.press('Escape');
          await native.page.getByTestId('nav-review').click();
          await native.page.getByTestId(`proposal-row-${proposal.id}`).click();
          const review = native.page.getByTestId('proposal-review');
          await review.getByText(reason, { exact: true }).waitFor();
          assert.ok((await review.innerText()).includes(purpose));
          for (const control of ['accept-proposal', 'reject-proposal']) {
            const button = review.getByTestId(control);
            await button.scrollIntoViewIfNeeded();
            const dimensions = await button.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                width: window.innerWidth,
                height: window.innerHeight,
              };
            });
            assert.ok(dimensions.left >= -1 && dimensions.right <= dimensions.width + 1);
            assert.ok(dimensions.top >= -1 && dimensions.bottom <= dimensions.height + 1);
            assert.equal(await button.isEnabled(), true);
          }
          const overflow = await native.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 1, `${locale}/${scale}: unexpected page overflow ${overflow}`);
          // Native capture avoids Chromium screenshot emulation changing the
          // clip/DPR at Electron's application-owned zoom factor.
          const capture = await native.application.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]!;
            const snapshot = await window.capturePage();
            return {
              png: snapshot.toPNG().toString('base64'),
              size: snapshot.getSize(),
              contentBounds: window.getContentBounds(),
              zoom: window.webContents.getZoomFactor(),
            };
          });
          const geometry = await native.page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
          }));
          assert.ok(
            Math.abs(geometry.width * scale - capture.contentBounds.width) <= 2,
            'The native window and CSS viewport must agree about text zoom.',
          );
          writeFileSync(
            join(evidence, `${locale}-${scale}x.png`),
            Buffer.from(capture.png, 'base64'),
          );
          writeFileSync(
            join(evidence, `${locale}-${scale}x.json`),
            JSON.stringify({ ...capture, png: undefined, geometry }, null, 2),
          );
        }
      }
      assert.equal(
        requireSuccess(fixture.human.getProposal({ proposalId: proposal.id })).proposal.status,
        'pending',
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);
