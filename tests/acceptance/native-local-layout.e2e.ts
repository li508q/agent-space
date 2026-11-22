import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { Locator } from 'playwright-core';
import { supportedLocales } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { launchNative } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
test(
  'local operation and record controls stay reachable in five locales at 980px and native 200% zoom',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = createAcceptanceFixture();
    ok(
      f.human.saveDraft({
        operationKey: 'layout:foreign-draft',
        draftId: randomUUID(),
        generation: 3,
        target: { state: 'existing', objectId: f.ids.retryPolicy, baseRevision: 1 },
        source: {
          kind: 'revision',
          ref: { mode: 'pinned', objectId: f.ids.retryPolicy, revision: 1 },
        },
        content: {
          title: 'A retained thought / 保留した考え',
          body: 'Independent original draft · 中文 · 日本語 · 한국어 · español.',
          properties: {},
          relations: [],
        },
      }),
    );
    const n = await launchNative({ entry: root, userData: join(f.root, 'Local layout profile') });
    try {
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 980, height: 850 }),
      );
      const out = join(root, '.coordination/screenshots/local-dialogs');
      mkdirSync(out, { recursive: true });
      async function reachable(control: Locator) {
        await control.scrollIntoViewIfNeeded();
        assert.equal(await control.isEnabled(), true);
        const box = await control.evaluate((element) => {
          const b = element.getBoundingClientRect();
          return {
            x: b.x,
            right: b.right,
            y: b.y,
            bottom: b.bottom,
            width: innerWidth,
            height: innerHeight,
          };
        });
        assert.ok(box.x >= -1 && box.right <= box.width + 1, JSON.stringify(box));
        assert.ok(box.y >= -1 && box.bottom <= box.height + 1, JSON.stringify(box));
        assert.ok(
          (await n.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          )) <= 1,
        );
      }
      async function capture(name: string) {
        const png = await n.application.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
        );
        writeFileSync(join(out, name + '.png'), Buffer.from(png, 'base64'));
      }
      async function openMenu() {
        const menu = n.page.getByTestId('space-menu');
        if (!(await menu.evaluate((element) => element.parentElement?.hasAttribute('open'))))
          await menu.click();
      }
      for (const locale of supportedLocales)
        for (const scale of [1, 2] as const) {
          await n.page.getByTestId('settings-button').click();
          await n.page.getByTestId('locale-select').selectOption(locale);
          await n.page.getByTestId('text-scale-select').selectOption(String(scale));
          await n.page.waitForFunction((value) => document.documentElement.lang === value, locale);
          await n.page.waitForFunction(
            (value) =>
              document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
              value,
            String(scale),
          );
          await n.page.keyboard.press('Escape');
          await openMenu();
          await n.page.getByTestId('open-imports').click();
          await n.chooseNextFolder(f.originals);
          await n.page.getByTestId('choose-import-folder').click();
          const importer = n.page.getByTestId('import-dialog');
          await importer.getByTestId('confirm-import').waitFor();
          await reachable(importer.getByTestId('choose-import-folder'));
          await reachable(importer.getByTestId('confirm-import'));
          await capture(`${locale}-${scale}x-import`);
          await n.page.keyboard.press('Escape');
          await importer.waitFor({ state: 'hidden' });
          await openMenu();
          await n.page.getByTestId('open-data-transfer').click();
          const transfer = n.page.getByTestId('data-transfer-dialog');
          for (const id of ['start-backup', 'start-export', 'choose-backup'])
            await reachable(transfer.getByTestId(id));
          await capture(`${locale}-${scale}x-transfer`);
          await n.page.keyboard.press('Escape');
          await transfer.waitFor({ state: 'hidden' });
          await n.page.getByTestId('nav-continue').click();
          await n.page.getByTestId('open-recoverable-drafts').click();
          const recovery = n.page.getByTestId('recovery-dialog');
          await recovery.locator('.recovery-list button').first().click();
          await reachable(recovery.getByTestId('copy-recovery-text'));
          await reachable(recovery.getByTestId('retain-recovered-draft'));
          await capture(`${locale}-${scale}x-recovery`);
          await n.page.keyboard.press('Escape');
          await recovery.waitFor({ state: 'hidden' });
          await n.page.getByTestId('nav-library').click();
          await n.page.getByTestId(`object-row-${f.ids.sample}`).click();
          await n.page.getByTestId('record-edit-fields').click();
          const fields = n.page.getByTestId('properties-editor');
          await reachable(fields.getByTestId('add-field'));
          await reachable(fields.getByTestId('apply-fields'));
          await capture(`${locale}-${scale}x-fields`);
          await n.page.keyboard.press('Escape');
          await fields.waitFor({ state: 'hidden' });
        }
      assert.deepEqual(n.pageErrors, []);
      assert.equal(
        ok(f.human.listImports({ limit: 20 })).items.length,
        0,
        'Layout inspection must not confirm an import.',
      );
    } finally {
      await n.close();
      f.dispose();
    }
  },
);
