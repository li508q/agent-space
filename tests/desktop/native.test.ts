import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeChannel, coreMethods, platformMethods } from '../../src/desktop/channels.js';
import { nativeDictionaries } from '../../src/desktop/native-copy.js';
import { launchNative } from '../acceptance/native-harness.js';
import { ok, content } from '../core/helpers.js';

const entry = fileURLToPath(new URL('../../dist/desktop/main.cjs', import.meta.url));

test(
  'actual desktop enforces origin/sender/schema/binding boundaries and persists private preferences',
  { timeout: 60_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentspace-native-boundary-'));
    const native = await launchNative({ userData: join(root, 'profile'), entry });
    let nativeClosed = false;
    try {
      const { application, page } = native;
      const initial = ok(await native.bootstrap());
      assert.equal(initial.activeSpace, null);
      assert.equal(initial.version, '0.1.0');
      assert.equal(page.url(), 'agentspace://app/index.html');
      assert.deepEqual(
        await page.evaluate(() => ({
          process: typeof process,
          require: typeof (globalThis as unknown as { require?: unknown }).require,
        })),
        { process: 'undefined', require: 'undefined' },
      );
      assert.deepEqual(
        (await page.evaluate(() => Object.keys(window.agentSpace))).sort(),
        [
          ...coreMethods,
          ...platformMethods,
          'onMenuCommand',
          'onCloseRequested',
          'onCloseCancelled',
        ].sort(),
      );
      const security = await application.evaluate(({ BrowserWindow }) => {
        // Pinned Electron exposes this inspection hook but omits it from its
        // public declarations. Product code does not depend on the hook.
        const inspected = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
          getLastWebPreferences(): {
            sandbox: boolean;
            contextIsolation: boolean;
            nodeIntegration: boolean;
            webSecurity: boolean;
          };
        };
        const prefs = inspected.getLastWebPreferences();
        return {
          sandbox: prefs.sandbox,
          isolation: prefs.contextIsolation,
          node: prefs.nodeIntegration,
          webSecurity: prefs.webSecurity,
        };
      });
      assert.deepEqual(security, {
        sandbox: true,
        isolation: true,
        node: false,
        webSecurity: true,
      });
      const schema = await page.evaluate(() => {
        const unsafe = window.agentSpace as unknown as {
          createSpace(input: unknown): Promise<unknown>;
        };
        return unsafe.createSpace({ title: 'Invalid extra path', path: '/unselected/path' });
      });
      assert.deepEqual(schema, {
        ok: false,
        error: { code: 'INVALID_INPUT', retryable: false, field: '' },
      });
      const deniedOrigin = await page.evaluate(async () => ({
        preload: await fetch('agentspace://app/preload.cjs').then(
          (response) => response.status,
          () => 0,
        ),
        core: await fetch('agentspace://app/../core/index.js').then(
          (response) => response.status,
          () => 0,
        ),
        network: await fetch('https://example.test/blocked').then(
          () => false,
          () => true,
        ),
      }));
      assert.notEqual(deniedOrigin.preload, 200);
      assert.notEqual(deniedOrigin.core, 200);
      assert.equal(deniedOrigin.network, true);
      const otherSender = await application.evaluate(
        async ({ BrowserWindow }, preload) => {
          const owner = BrowserWindow.getAllWindows()[0]!;
          const other = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              session: owner.webContents.session,
            },
          });
          try {
            await other.loadURL('agentspace://app/index.html');
            return (await other.webContents.executeJavaScript(
              'window.agentSpace.bootstrap()',
            )) as unknown;
          } finally {
            other.destroy();
          }
        },
        join(dirname(entry), 'preload.cjs'),
      );
      assert.deepEqual(otherSender, { ok: false, error: { code: 'FORBIDDEN', retryable: false } });

      const example = ok(await page.evaluate(() => window.agentSpace.openExample()));
      assert.equal(example.status.example, true);
      const binding = {
        bindingId: example.bindingId,
        spaceId: example.status.spaceId,
        instanceId: example.status.instanceId,
      };
      const note = ok(
        await page.evaluate((request) => window.agentSpace.createObject(request), {
          ...binding,
          input: {
            operationKey: 'desktop:real-save',
            kind: 'document' as const,
            content: content('Actual desktop IPC 保存 🙂', ''),
          },
        }),
      );
      assert.equal(note.object.content.body, 'Actual desktop IPC 保存 🙂');
      const badBinding = await page.evaluate((request) => window.agentSpace.status(request), {
        ...binding,
        bindingId: '00000000-0000-4000-8000-000000000000',
        input: null,
      });
      assert.ok(!badBinding.ok);
      assert.equal(badBinding.error.code, 'SPACE_MISMATCH');
      await application.evaluate(({ dialog }) => {
        const previous = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => {
          dialog.showOpenDialog = previous;
          return { canceled: true, filePaths: [] };
        };
      });
      assert.equal(ok(await page.evaluate(() => window.agentSpace.openSpace())), null);
      assert.equal(ok(await native.bootstrap()).activeSpace?.bindingId, example.bindingId);
      const copied = await application.evaluate(async ({ clipboard, BrowserWindow }) => {
        // Verify the real IPC path while preserving the person's OS clipboard.
        const original = clipboard.writeText;
        let written: string | null = null;
        clipboard.writeText = async (text) => {
          written = text;
        };
        try {
          const result: unknown =
            await BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
              'window.agentSpace.copyText({ text: "Synthetic clipboard · 合成" })',
            );
          return { result, written };
        } finally {
          clipboard.writeText = original;
        }
      });
      assert.deepEqual(copied, {
        result: { ok: true, value: { copied: true } },
        written: 'Synthetic clipboard · 合成',
      });
      const failedCopy = await application.evaluate(async ({ clipboard, BrowserWindow }) => {
        const original = clipboard.writeText;
        clipboard.writeText = async () => {
          throw new Error('Synthetic OS copy failure');
        };
        try {
          return (await BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
            'window.agentSpace.copyText({ text: "Synthetic" })',
          )) as unknown;
        } finally {
          clipboard.writeText = original;
        }
      });
      assert.deepEqual(failedCopy, {
        ok: false,
        error: { code: 'STORAGE_FAILURE', retryable: false },
      });

      const issued = ok(
        await page.evaluate((request) => window.agentSpace.createGrant(request), {
          ...binding,
          input: {
            operationKey: 'desktop:grant',
            spec: {
              label: 'Native synthetic client',
              scope: { mode: 'space' as const },
              capabilities: { read: true, propose: true },
            },
          },
        }),
      );
      assert.ok(issued.token);
      const before = ok(
        await page.evaluate((request) => window.agentSpace.status(request), {
          ...binding,
          input: null,
        }),
      );
      const config = ok(
        await page.evaluate((request) => window.agentSpace.agentConfiguration(request), {
          ...binding,
          input: { grantId: issued.grant.id, token: issued.token },
        }),
      );
      assert.equal(config.command, await application.evaluate(() => process.execPath));
      assert.equal(config.args[1], '--agent-server');
      assert.ok(config.args.includes(example.status.instanceId));
      assert.equal(config.env.AGENTSPACE_TOKEN, issued.token);
      assert.ok(!config.args.includes(issued.token));
      assert.equal(
        ok(
          await page.evaluate((request) => window.agentSpace.status(request), {
            ...binding,
            input: null,
          }),
        ).activitySequence,
        before.activitySequence,
      );

      for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'es'] as const) {
        assert.equal(
          (await page.evaluate((locale) => window.agentSpace.setLocale({ locale }), locale)).ok,
          true,
        );
        const labels = await application.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()!.items.map((item) => item.label),
        );
        assert.ok(labels.includes(nativeDictionaries[locale].edit));
      }
      assert.equal(
        (await page.evaluate(() => window.agentSpace.setTextScale({ factor: 2 }))).ok,
        true,
      );
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
        ),
        2,
      );
      await page.evaluate(() => window.agentSpace.setTextScale({ factor: 1 }));
      const unsafeLink = await page.evaluate(() =>
        window.agentSpace.openExternal({ url: 'javascript:alert(1)' }),
      );
      assert.ok(!unsafeLink.ok);
      assert.equal(unsafeLink.error.code, 'UNSAFE_LINK');
      await application.evaluate(({ shell }) => {
        shell.openExternal = async () => {};
      });
      // Playwright's page.evaluate itself grants transient user activation.
      // Reload and call from main with userGesture=false for the negative case.
      const noGesture = await application.evaluate(async ({ BrowserWindow }) => {
        const owner = BrowserWindow.getAllWindows()[0]!.webContents;
        const loaded = new Promise<void>((resolve) =>
          owner.once('did-finish-load', () => resolve()),
        );
        owner.reload();
        await loaded;
        return (await owner.executeJavaScript(
          'window.agentSpace.openExternal({ url: "https://example.test/user-click" })',
          false,
        )) as { ok: boolean; error?: { code: string } };
      });
      assert.ok(!noGesture.ok);
      assert.equal(noGesture.error?.code, 'UNSAFE_LINK');
      await page.evaluate(() => {
        const button = document.createElement('button');
        button.textContent = 'Synthetic external-link click';
        button.id = 'native-boundary-link';
        button.onclick = () => {
          void window.agentSpace
            .openExternal({ url: 'https://example.test/user-click' })
            .then((result) => {
              button.dataset.result = result.ok ? 'opened' : result.error.code;
            });
        };
        document.body.prepend(button);
      });
      await page.locator('#native-boundary-link').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#native-boundary-link')?.getAttribute('data-result') === 'opened',
      );
      const guessedClose = await page.evaluate(() =>
        window.agentSpace.respondToClose({
          requestId: '00000000-0000-4000-8000-000000000000',
          decision: 'ready',
        }),
      );
      assert.ok(!guessedClose.ok);
      assert.equal(guessedClose.error.code, 'INVALID_INPUT');
      await page.evaluate(() => {
        window.agentSpace.onCloseCancelled((request) => {
          document.body.dataset.nativeCloseCancelled = request.requestId;
        });
      });
      const held = await application.evaluateHandle(
        ({ BrowserWindow, dialog }, requestedChannel) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          const owner = window.webContents;
          const send = owner.send;
          const show = dialog.showMessageBox;
          const observed = {
            request: null as { requestId: string } | null,
            prompted: null as ((buttons: string[]) => void) | null,
            release: null as
              ((value: { response: number; checkboxChecked: boolean }) => void) | null,
          };
          const prompt = new Promise<string[]>((resolve) => {
            observed.prompted = resolve;
          });
          // Withhold only the first close request. This makes the real main
          // timeout observable without replacing the renderer or its API.
          owner.send = (name: string, ...args: unknown[]) => {
            if (name === requestedChannel) observed.request = args[0] as { requestId: string };
            else send.call(owner, name, ...args);
          };
          dialog.showMessageBox = (...args: unknown[]) =>
            new Promise<{ response: number; checkboxChecked: boolean }>((resolve) => {
              observed.release = resolve;
              observed.prompted!((args.at(-1) as { buttons: string[] }).buttons);
            });
          window.close();
          return {
            observed,
            prompt,
            owner,
            send,
            dialog,
            show,
          };
        },
        closeChannel,
      );
      try {
        const request = await held.evaluate((state) => state.observed.request);
        assert.ok(request);
        await held.evaluate((state) => state.prompt);
        const late = await page.evaluate(
          (request) => window.agentSpace.respondToClose({ ...request, decision: 'ready' }),
          request,
        );
        assert.deepEqual(
          late,
          { ok: true, value: { closed: false } },
          'A visible native recovery dialog blocks late ready',
        );
        await held.evaluate((state) =>
          state.observed.release!({ response: 0, checkboxChecked: false }),
        );
        await page.waitForFunction(
          (id) => document.body.dataset.nativeCloseCancelled === id,
          request.requestId,
        );
        const staleReady = await page.evaluate(
          (request) => window.agentSpace.respondToClose({ ...request, decision: 'ready' }),
          request,
        );
        assert.ok(!staleReady.ok);
        assert.equal(staleReady.error.code, 'INVALID_INPUT');
        assert.equal(
          await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
          1,
        );
      } finally {
        await held.evaluate((state) => {
          state.owner.send = state.send;
          state.dialog.showMessageBox = state.show;
        });
        await held.dispose();
      }
      assert.deepEqual(native.pageErrors, []);
      await native.close();
      nativeClosed = true;
      const reopened = await launchNative({ userData: join(root, 'profile'), entry });
      try {
        const restored = ok(await reopened.bootstrap());
        assert.equal(restored.preferences.locale, 'es');
        assert.equal(restored.preferences.textScale, 1);
        assert.equal(restored.activeSpace?.status.spaceId, example.status.spaceId);
        assert.notEqual(restored.activeSpace?.bindingId, example.bindingId);
        assert.ok(restored.activeSpace);
        const saved = ok(
          await reopened.page.evaluate((request) => window.agentSpace.readObject(request), {
            bindingId: restored.activeSpace.bindingId,
            spaceId: restored.activeSpace.status.spaceId,
            instanceId: restored.activeSpace.status.instanceId,
            input: { objectId: note.object.id },
          }),
        );
        assert.equal(saved.object.content.body, note.object.content.body);
        assert.deepEqual(reopened.pageErrors, []);
        const fallback = await reopened.application.evaluate(async ({ BrowserWindow, dialog }) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          const original = dialog.showMessageBox;
          const observed = { report: null as ((buttons: string[]) => void) | null };
          const prompt = new Promise<string[]>((resolve) => {
            observed.report = resolve;
          });
          dialog.showMessageBox = async (...args: unknown[]) => {
            const options = args.at(-1) as { buttons: string[] };
            observed.report!(options.buttons);
            return { response: 0, checkboxChecked: false };
          };
          try {
            const gone = new Promise<void>((resolve) =>
              window.webContents.once('render-process-gone', () => resolve()),
            );
            window.webContents.forcefullyCrashRenderer();
            await gone;
            window.close();
            const buttons = await prompt;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            return { buttons, keptOpen: !window.isDestroyed() };
          } finally {
            dialog.showMessageBox = original;
          }
        });
        assert.equal(fallback.keptOpen, true, 'No renderer response never authorizes closing');
        assert.ok(fallback.buttons.includes(nativeDictionaries.es.keepOpen));
        assert.ok(fallback.buttons.includes(nativeDictionaries.es.discard));
      } finally {
        await reopened.close();
      }
    } finally {
      if (!nativeClosed) await native.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
