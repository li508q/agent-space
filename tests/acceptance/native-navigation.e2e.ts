import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { bound } from '../../src/renderer/state/binding.js';
import { t, type Locale } from '../../src/renderer/i18n/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
type TestMain = {
  __agentSpaceTestFault: {
    hold(method: string, objectId?: string): void;
    release(): void;
    snapshot(): { held: boolean };
  };
};

test(
  'a delayed native creation cannot silently discard typing in the previous document',
  { skip: process.platform !== 'darwin', timeout: 30_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Navigation'),
      mainRequire: fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url)),
    });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const baseline = 'Keep every human word when changing documents.';
      await input.fill(baseline);
      await native.page.getByTestId('save-now').click();
      await native.page.waitForFunction(() =>
        document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
      );
      const original = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      assert.equal(original.content.body, baseline);
      await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.hold('createObject'),
      );
      await native.page.getByTestId('new-note').click();
      let held = false;
      for (let i = 0; i < 100 && !held; i++) {
        held = await native.application.evaluate(
          () => (globalThis as unknown as TestMain).__agentSpaceTestFault.snapshot().held,
        );
        if (!held) await delay(20);
      }
      assert.equal(held, true);
      // A single logical line makes DOM text identical to the authored body;
      // multi-line CodeMirror textContent omits line separators.
      const inputVisible = await input.isVisible();
      if (inputVisible) await input.pressSequentially(' late human input');
      const visible = inputVisible ? (await input.textContent())! : baseline;
      await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
      );
      await native.page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)?.value ===
          '',
      );
      const current = requireSuccess(fixture.human.readObject({ objectId: original.id })).object;
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const drafts = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.listDrafts(request),
          bound(session, { limit: 50 }),
        ),
      );
      let retained = false;
      for (const receipt of drafts.items) {
        if (receipt.target.state !== 'existing' || receipt.target.objectId !== original.id)
          continue;
        const draft = requireSuccess(
          await native.page.evaluate(
            (request) => window.agentSpace.readDraft(request),
            bound(session, { draftId: receipt.draftId }),
          ),
        );
        if (draft.content.body === visible) retained = true;
      }
      if (visible !== original.content.body)
        assert.ok(
          current.content.body === visible || retained,
          'Visible input accepted during navigation must be saved or retained before replacing its editor.',
        );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.application
        .evaluate(() => (globalThis as unknown as TestMain).__agentSpaceTestFault.release())
        .catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

for (const cancel of [false, true]) {
  test(
    cancel
      ? 'cancelled native opening restores editing and rejects its obsolete reply'
      : 'delayed native opening protects the previous editor and unlocks the selected document',
    { skip: process.platform !== 'darwin', timeout: 30_000 },
    async () => {
      const fixture = createAcceptanceFixture();
      const native = await launchNative({
        entry: root,
        userData: join(fixture.root, cancel ? 'Cancelled opening' : 'Delayed opening'),
        mainRequire: fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url)),
      });
      try {
        await native.focus();
        await native.chooseNextFolder(fixture.directory);
        await native.page.getByTestId('open-space').click();
        await native.page.getByTestId('nav-library').click();
        await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
        const input = native.page.getByTestId('markdown-input');
        const baseline = 'A saved one-line note before opening another item.';
        await input.fill(baseline);
        await native.page.getByTestId('save-now').click();
        await native.page.waitForFunction(() =>
          document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
        );
        const target = native.page.getByTestId(`object-row-${fixture.ids.measurements}`);
        if (!(await target.isVisible())) {
          const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
          await native.page
            .getByTestId('document-pane')
            .getByRole('button', { name: t(locale, 'ui.browse'), exact: true })
            .click();
        }
        const originalView = await native.logWindow('before-opening');
        await native.application.evaluate(
          (_electron, id) =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.hold('readObject', id),
          fixture.ids.measurements,
        );
        await target.click();
        let held = false;
        for (let i = 0; i < 100 && !held; i++) {
          held = await native.application.evaluate(
            () => (globalThis as unknown as TestMain).__agentSpaceTestFault.snapshot().held,
          );
          if (!held) await delay(20);
        }
        assert.equal(held, true);
        const notice = native.page.getByTestId('editor-transition');
        await native.logWindow('opening-held');
        await native.page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        if (!(await notice.isVisible())) {
          const visibility = await native.page.evaluate(() => ({
            materialInert: document.querySelector('.material-list')?.hasAttribute('inert'),
            surfaceDisplay: getComputedStyle(document.querySelector('.working-surface')!).display,
            surfaceVisibility: getComputedStyle(document.querySelector('.working-surface')!)
              .visibility,
            noticeDisplay: getComputedStyle(
              document.querySelector('[data-testid="editor-transition"]')!,
            ).display,
          }));
          console.log(
            `[native-opening-hidden] ${JSON.stringify({ ...visibility, sourceSaved: requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object.content.body === baseline, sourceRevision: requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object.revision, targetRevision: requireSuccess(fixture.human.readObject({ objectId: fixture.ids.measurements })).object.revision, held })}`,
          );
          mkdirSync(join(root, '.coordination'), { recursive: true });
          const png = await native.application.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
          );
          writeFileSync(
            join(root, '.coordination/7A-ci-opening-held.png'),
            Buffer.from(png, 'base64'),
          );
        }
        await notice.waitFor();
        assert.equal(await notice.count(), 1);
        // Native test viewport control, not an application preference or product flag.
        await native.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
        );
        await native.page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const enlarged = await native.logWindow('opening-held-zoom2');
        assert.equal(enlarged.zoomFactor, 2);
        const noticeBounds = await notice.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: window.innerHeight };
        });
        assert.ok(noticeBounds.top >= -1 && noticeBounds.bottom <= noticeBounds.height + 1);
        if (originalView.view.compact === 'true') {
          mkdirSync(join(root, '.coordination'), { recursive: true });
          const png = await native.application.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
          );
          writeFileSync(
            join(root, '.coordination/7A-ci-opening-visible.png'),
            Buffer.from(png, 'base64'),
          );
        }
        if (cancel) {
          const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
          const cancelButton = notice.getByRole('button', {
            name: t(locale, 'common.cancel'),
            exact: true,
          });
          for (
            let step = 0;
            step < 12 &&
            !(await cancelButton.evaluate((element) => document.activeElement === element));
            step++
          )
            await native.page.keyboard.press('Tab');
          assert.equal(
            await cancelButton.evaluate((element) => document.activeElement === element),
            true,
          );
          await native.page.keyboard.press('Enter');
          await notice.waitFor({ state: 'hidden' });
          await native.application.evaluate(
            ({ BrowserWindow }, zoom) =>
              BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom),
            originalView.zoomFactor,
          );
          await native.page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          const cancelledView = await native.logWindow('opening-cancelled');
          assert.equal(cancelledView.view.listOpen, originalView.view.listOpen);
          assert.equal(cancelledView.view.auxiliary, originalView.view.auxiliary);
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
              .content.body,
            baseline,
          );
          if (!(await input.isVisible()))
            await native.page
              .locator('.material-list > header')
              .getByRole('button', { name: t(locale, 'ui.sourceReturn'), exact: true })
              .click();
          await input.waitFor();
          const correction = 'Continue writing after cancelling the pending opening.';
          await input.fill(correction);
          await native.page.getByTestId('save-now').click();
          await native.page.waitForFunction(() =>
            document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
          );
          await native.application.evaluate(() =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
          );
          await delay(100);
          assert.equal(
            await native.page.getByTestId('document-title').inputValue(),
            'Retry policy',
          );
          assert.equal(await input.textContent(), correction);
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
              .content.body,
            correction,
          );
        } else {
          if (await input.isVisible()) {
            assert.equal(await input.isEditable(), false);
            await input.pressSequentially(' should not enter');
            assert.equal(await input.textContent(), baseline);
          }
          await native.application.evaluate(
            ({ BrowserWindow }, zoom) =>
              BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom),
            originalView.zoomFactor,
          );
          await native.application.evaluate(() =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
          );
          await native.page.waitForFunction(
            () =>
              (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)
                ?.value === 'Measurements',
          );
          await notice.waitFor({ state: 'hidden' });
          assert.equal(await input.isEditable(), true);
          const correctedTarget = 'A usable target after the delayed opening.';
          await input.fill(correctedTarget);
          await native.page.getByTestId('save-now').click();
          await native.page.waitForFunction(() =>
            document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
          );
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.measurements })).object
              .content.body,
            correctedTarget,
          );
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
              .content.body,
            baseline,
          );
        }
        assert.deepEqual(native.pageErrors, []);
      } finally {
        await native.application
          .evaluate(() => (globalThis as unknown as TestMain).__agentSpaceTestFault.release())
          .catch(() => {});
        await native.close();
        fixture.dispose();
      }
    },
  );
}
