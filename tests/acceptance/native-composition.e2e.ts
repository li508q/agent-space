import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
type MainProbe = { __compositionCloseDialogs: number };

test(
  'actual CodeMirror composition survives a cancelled close and a later close saves committed CJK',
  { skip: process.platform !== 'darwin', timeout: 40_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const profile = join(fixture.root, 'Composition profile');
    let native = await launchNative({ entry: root, userData: profile });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const original = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      const cdp = await native.page.context().newCDPSession(native.page);
      const first = '中文の記録 한국어';
      await input.fill('');
      await input.focus();
      await cdp.send('Input.imeSetComposition', {
        text: first,
        selectionStart: first.length,
        selectionEnd: first.length,
      });
      await native.page.waitForFunction(
        (text) => document.querySelector('[data-testid="markdown-input"]')?.textContent === text,
        first,
      );
      await native.application.evaluate(({ dialog, BrowserWindow }) => {
        (globalThis as unknown as MainProbe).__compositionCloseDialogs = 0;
        // Substitute only the OS dialog result. The real eight-second fallback,
        // nonce cancellation, preload event and editor composition wait remain.
        dialog.showMessageBox = async () => {
          (globalThis as unknown as MainProbe).__compositionCloseDialogs++;
          return { response: 0, checkboxChecked: false };
        };
        BrowserWindow.getAllWindows()[0]!.close();
      });
      await delay(1_000);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
          .revision,
        original.revision,
        'Uncommitted composition must not become an accepted object revision.',
      );
      let dialogs = 0;
      for (let attempt = 0; attempt < 100 && !dialogs; attempt++) {
        dialogs = await native.application.evaluate(
          () => (globalThis as unknown as MainProbe).__compositionCloseDialogs,
        );
        if (!dialogs) await delay(100);
      }
      assert.equal(dialogs, 1);
      await cdp.send('Input.insertText', { text: first });
      await input.waitFor();
      await native.page.getByTestId('save-now').click();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
            .content.body === first
        )
          break;
        await delay(50);
      }
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
          .content.body,
        first,
      );
      assert.equal(await input.getAttribute('contenteditable'), 'true');
      assert.equal(
        await native.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
        ),
        true,
        'Completing an old composition after cancellation cannot authorize a close.',
      );

      const second = '次の確定入力 · 두 번째 · 最后一次';
      await input.fill('');
      await input.focus();
      await cdp.send('Input.imeSetComposition', {
        text: second,
        selectionStart: second.length,
        selectionEnd: second.length,
      });
      const child = native.application.process();
      const exited = once(child, 'exit');
      await native.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.close(),
      );
      await delay(100);
      assert.equal(child.exitCode, null);
      await cdp.send('Input.insertText', { text: second });
      await Promise.race([
        exited,
        delay(8_000, undefined, { ref: false }).then(() => {
          throw new Error('A committed composition should allow an orderly close.');
        }),
      ]);
      assert.equal(child.exitCode, 0);
      assert.equal(child.signalCode, null);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
          .content.body,
        second,
      );
      assert.deepEqual(native.pageErrors, []);
      native = await launchNative({ entry: root, userData: profile });
      assert.equal(
        requireSuccess(await native.bootstrap()).activeSpace?.status.spaceId,
        requireSuccess(fixture.human.status()).spaceId,
      );
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      assert.equal(await native.page.getByTestId('markdown-input').textContent(), second);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);
