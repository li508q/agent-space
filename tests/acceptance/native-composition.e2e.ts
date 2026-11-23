import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { bound } from '../../src/renderer/state/binding.js';
import { supportedLocales, t } from '../../src/renderer/i18n/index.js';
import { nativeDictionaries } from '../../src/desktop/native-copy.js';

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
      await native.page.getByTestId('nav-library').click();
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
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      assert.equal(await native.page.getByTestId('markdown-input').textContent(), second);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);

type CloseConfirmationProbe = {
  __closeConfirmation: {
    failWrites: boolean;
    failures: string[];
    retirements: number;
    dialogs: { message: string; detail: string; buttons: string[] }[];
    choose(response: number): void;
    restore(): void;
  };
};

test(
  'native discard confirmation preserves input on cancel and retained drafts after confirmed close',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    for (const locale of supportedLocales) {
      const fixture = createAcceptanceFixture();
      const profile = join(fixture.root, 'Close confirmation profile');
      let native = await launchNative({ entry: root, userData: profile });
      try {
        await native.focus();
        await native.chooseNextFolder(fixture.directory);
        await native.page.getByTestId('open-space').click();
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.waitForFunction(
          (value) => document.documentElement.lang === value,
          locale,
        );
        await native.page.keyboard.press('Escape');
        const session = requireSuccess(await native.bootstrap()).activeSpace!;
        const original = requireSuccess(
          fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
        ).object;
        const retainedBody = `Retained recovery text · ${locale} · 中文 日本語 한국어 café`;
        const draft = requireSuccess(
          await native.page.evaluate(
            (request) => window.agentSpace.saveDraft(request),
            bound(session, {
              operationKey: `close-confirmation:${locale}:draft`,
              draftId: crypto.randomUUID(),
              generation: 1,
              target: {
                state: 'existing' as const,
                objectId: original.id,
                baseRevision: original.revision,
              },
              source: { kind: 'editor' as const },
              content: { ...original.content, body: retainedBody },
            }),
          ),
        );
        const readDraft = () =>
          native.page.evaluate(
            (request) => window.agentSpace.readDraft(request),
            bound(session, { draftId: draft.draftId }),
          );
        const retained = requireSuccess(await readDraft());
        await native.application.evaluate(({ ipcMain, dialog }) => {
          const registry = (
            ipcMain as unknown as {
              _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
            }
          )._invokeHandlers;
          if (!(registry instanceof Map)) throw new Error('The real IPC registry is required.');
          const originalDialog = dialog.showMessageBox;
          const originals = new Map<string, (...args: unknown[]) => unknown>();
          let reply: ((value: { response: number; checkboxChecked: boolean }) => void) | null =
            null;
          const probe: CloseConfirmationProbe['__closeConfirmation'] = {
            failWrites: true,
            failures: [],
            retirements: 0,
            dialogs: [],
            choose(response) {
              const resolve = reply;
              reply = null;
              resolve?.({ response, checkboxChecked: false });
            },
            restore() {
              this.choose(0);
              for (const [name, handler] of originals) {
                ipcMain.removeHandler(name);
                ipcMain.handle(name, handler);
              }
              dialog.showMessageBox = originalDialog;
              delete (globalThis as Partial<CloseConfirmationProbe>).__closeConfirmation;
            },
          };
          for (const method of ['saveObject', 'saveDraft', 'discardDraft']) {
            const name = `agentspace:method:${method}`;
            const handler = registry.get(name);
            if (typeof handler !== 'function') throw new Error(`Missing real handler: ${name}`);
            originals.set(name, handler);
            ipcMain.removeHandler(name);
            ipcMain.handle(name, async (...args: unknown[]) => {
              // Only writes fail. Draft reads and retirement use the actual Core.
              if (probe.failWrites && method !== 'discardDraft') {
                probe.failures.push(method);
                return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } };
              }
              if (method === 'discardDraft') probe.retirements++;
              return handler(...args);
            });
          }
          dialog.showMessageBox = (async (...args: unknown[]) => {
            const options = args.at(-1) as {
              message?: string;
              detail?: string;
              buttons?: string[];
            };
            probe.dialogs.push({
              message: options.message ?? '',
              detail: options.detail ?? '',
              buttons: options.buttons ?? [],
            });
            return new Promise((resolve) => {
              reply = resolve;
            });
          }) as typeof dialog.showMessageBox;
          (globalThis as unknown as CloseConfirmationProbe).__closeConfirmation = probe;
        });
        await native.page.getByTestId('nav-library').click();
        await native.page.getByTestId('nav-continue').click();
        const resume = () =>
          native.page
            .locator('.draft-list')
            .getByRole('button')
            .filter({ hasText: t(locale, 'editor.resumeDraft') })
            .first();
        await resume().click();
        const input = native.page.getByTestId('markdown-input');
        assert.equal(await input.textContent(), retainedBody);
        const newest = `Latest unsaved input · ${locale} · must survive Cancel`;
        await input.fill(newest);
        await native.page.getByTestId('save-now').click();
        await native.page
          .getByTestId('save-state')
          .getByText(t(locale, 'editor.notSaved'), { exact: true })
          .waitFor();
        const askToDiscard = async (expectedDialogs: number) => {
          await native.application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]!.close(),
          );
          await native.page
            .getByTestId('native-close-dialog')
            .getByRole('button', { name: t(locale, 'ui.discardEdits'), exact: true })
            .click();
          for (let attempt = 0; attempt < 100; attempt++) {
            const dialogs = await native.application.evaluate(
              () => (globalThis as unknown as CloseConfirmationProbe).__closeConfirmation.dialogs,
            );
            if (dialogs.length === expectedDialogs) {
              const prompt = dialogs.at(-1)!;
              assert.equal(prompt.message, nativeDictionaries[locale].discardTitle);
              assert.equal(prompt.detail, nativeDictionaries[locale].discardExplanation);
              assert.deepEqual(prompt.buttons, [
                t(locale, 'common.cancel'),
                nativeDictionaries[locale].discard,
              ]);
              return;
            }
            await delay(25);
          }
          assert.fail('The original native discard confirmation must be reached.');
        };
        await askToDiscard(1);
        await native.application.evaluate(() =>
          (globalThis as unknown as CloseConfirmationProbe).__closeConfirmation.choose(0),
        );
        await native.page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="markdown-input"]')
              ?.getAttribute('contenteditable') === 'true',
        );
        assert.deepEqual(
          { body: await input.textContent(), draft: await readDraft() },
          { body: newest, draft: { ok: true, value: retained } },
          `${locale}: cancelling native confirmation must preserve input and retained draft`,
        );
        const continued = `${newest} · Typing continues after cancellation.`;
        await input.fill(continued);
        assert.equal(await input.textContent(), continued);
        await askToDiscard(2);
        const probe = await native.application.evaluate(() => {
          const value = (globalThis as unknown as CloseConfirmationProbe).__closeConfirmation;
          return { failures: value.failures, retirements: value.retirements };
        });
        assert.ok(probe.failures.includes('saveObject') && probe.failures.includes('saveDraft'));
        assert.equal(probe.retirements, 0, 'Closing must not retire a retained recovery draft.');
        const child = native.application.process();
        const exited = once(child, 'exit');
        await native.application.evaluate(() =>
          (globalThis as unknown as CloseConfirmationProbe).__closeConfirmation.choose(1),
        );
        await Promise.race([
          exited,
          delay(8_000, undefined, { ref: false }).then(() => {
            throw new Error('A confirmed close should exit normally.');
          }),
        ]);
        assert.equal(child.exitCode, 0);
        assert.equal(child.signalCode, null);
        assert.equal(
          requireSuccess(fixture.human.readObject({ objectId: original.id })).object.content.body,
          original.content.body,
        );
        assert.deepEqual(native.pageErrors, []);
        native = await launchNative({ entry: root, userData: profile });
        const reopened = requireSuccess(await native.bootstrap()).activeSpace!;
        assert.deepEqual(
          requireSuccess(
            await native.page.evaluate(
              (request) => window.agentSpace.readDraft(request),
              bound(reopened, { draftId: draft.draftId }),
            ),
          ),
          retained,
        );
        await native.page.getByTestId('nav-continue').click();
        await resume().click();
        assert.equal(await native.page.getByTestId('markdown-input').textContent(), retainedBody);
        assert.deepEqual(native.pageErrors, []);
      } finally {
        if (native.application.process().exitCode === null)
          await native.application.evaluate(() =>
            (
              globalThis as unknown as Partial<CloseConfirmationProbe>
            ).__closeConfirmation?.restore(),
          );
        await native.close();
        fixture.dispose();
      }
    }
  },
);
