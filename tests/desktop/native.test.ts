import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeChannel, coreMethods, platformMethods } from '../../src/desktop/channels.js';
import { nativeDictionaries } from '../../src/desktop/native-copy.js';
import { launchNative, type NativeHarness } from '../acceptance/native-harness.js';
import type { AppBootstrap } from '../../src/contracts/app.js';
import type { Result } from '../../src/contracts/errors.js';
import { ok, content } from '../core/helpers.js';

const entry = fileURLToPath(new URL('../../dist/desktop/main.cjs', import.meta.url));

async function within<T>(label: string, milliseconds: number, pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const alive = (child: ChildProcess) =>
  child.pid !== undefined && child.exitCode === null && child.signalCode === null;

async function cleanupNative(native: NativeHarness, child: ChildProcess): Promise<void> {
  if (!alive(child)) return;
  try {
    await within('native test cleanup', 5_000, native.close());
  } finally {
    if (alive(child)) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await within('native test process exit', 2_000, exited);
    }
  }
}

type CrashObservation = {
  stage: string;
  rendererPid?: number;
  bootstrap?: Result<AppBootstrap>;
  details?: { reason: string; exitCode: number };
  buttons?: string[];
  keptOpen?: boolean;
};

async function verifyCrashedRendererClose(
  root: string,
  expectedSpaceId: string,
  remember: (child: ChildProcess) => void,
): Promise<void> {
  // Renderer death can stall Electron's attached debugging transport. This
  // separate real app has no inspector/CDP connection; only a trusted temporary
  // main-process observer and dialog-choice substitute use its private IPC pipe.
  const observer = join(root, 'native-crash-observer.cjs');
  writeFileSync(
    observer,
    String.raw`
const { app, dialog } = require('electron');
const send = (stage, detail = {}) => process.send({ channel: 'native-crash-test', stage, ...detail });
let window;
let release;
const original = dialog.showMessageBox;
dialog.showMessageBox = (...args) => new Promise((resolve) => {
  release = resolve;
  send('prompt', { buttons: args.at(-1).buttons, keptOpen: !window.isDestroyed() });
});
app.once('browser-window-created', (_event, created) => {
  window = created;
  const owner = window.webContents;
  owner.once('render-process-gone', (_event, details) => {
    send('gone', { details, keptOpen: !window.isDestroyed() });
  });
  owner.once('did-finish-load', async () => {
    try {
      const bootstrap = await owner.executeJavaScript('window.agentSpace.bootstrap()');
      send('ready', { bootstrap, rendererPid: owner.getOSProcessId() });
    } catch {
      send('observer-error');
    }
  });
});
process.on('message', (message) => {
  if (message.channel !== 'native-crash-test') return;
  if (message.action === 'request-close') {
    window.close();
    send('close-requested', { keptOpen: !window.isDestroyed() });
  } else if (message.action === 'keep-open') {
    release({ response: 0, checkboxChecked: false });
    setImmediate(() => send('kept-open', { keptOpen: !window.isDestroyed() }));
  } else if (message.action === 'cleanup') {
    dialog.showMessageBox = original;
    app.exit(0); // Test cleanup only, not a product close-policy assertion.
  }
});
`,
    { mode: 0o600 },
  );
  const executable: unknown = createRequire(import.meta.url)('electron');
  assert.equal(typeof executable, 'string');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTSPACE_USER_DATA: join(root, 'profile'),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable as string, ['--require', observer, entry], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  remember(child);
  const observations: CrashObservation[] = [];
  let startupError: Error | null = null;
  child.on('error', (error) => {
    startupError = error;
  });
  child.on('message', (raw: unknown) => {
    if (
      raw &&
      typeof raw === 'object' &&
      'channel' in raw &&
      raw.channel === 'native-crash-test' &&
      'stage' in raw &&
      typeof raw.stage === 'string'
    )
      observations.push(raw as CrashObservation);
  });
  // Drain diagnostic pipes; no personal data or tokens are printed by this test.
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  const wait = async (stage: string, milliseconds: number): Promise<CrashObservation> => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (observations.some((item) => item.stage === 'observer-error'))
        assert.fail('Native crash observer could not read the real renderer bootstrap');
      const observation = observations.find((item) => item.stage === stage);
      if (observation) return observation;
      assert.ok(alive(child), `Native crash app exited before ${stage}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(
      `Native crash observation ${stage} timed out; stages: ${observations.map((item) => item.stage).join(', ')}`,
    );
  };
  try {
    const ready = await wait('ready', 15_000);
    assert.ok(ready.bootstrap);
    const bootstrap = ok(ready.bootstrap);
    assert.equal(bootstrap.preferences.locale, 'es');
    assert.equal(bootstrap.activeSpace?.status.spaceId, expectedSpaceId);
    assert.ok(Number.isSafeInteger(ready.rendererPid) && ready.rendererPid! > 0);
    assert.notEqual(ready.rendererPid, child.pid);
    // Only the PID reported by this app's own loaded window is killed. This is
    // an actual renderer death, never a mocked render-process-gone event.
    process.kill(ready.rendererPid!, 'SIGKILL');
    const gone = await wait('gone', 5_000);
    assert.equal(gone.keptOpen, true, 'Renderer death itself never authorizes closing');
    assert.equal(gone.details?.reason, 'killed');
    assert.notEqual(gone.details?.exitCode, 0);
    child.send({ channel: 'native-crash-test', action: 'request-close' });
    assert.equal((await wait('close-requested', 3_000)).keptOpen, true);
    // Exercise the real eight-second Main fallback; only its OS choice is held.
    const prompt = await wait('prompt', 12_000);
    assert.equal(prompt.keptOpen, true, 'No renderer response never authorizes closing');
    assert.ok(prompt.buttons?.includes(nativeDictionaries.es.keepOpen));
    assert.ok(prompt.buttons?.includes(nativeDictionaries.es.discard));
    child.send({ channel: 'native-crash-test', action: 'keep-open' });
    assert.equal((await wait('kept-open', 3_000)).keptOpen, true);
    const exited = once(child, 'exit');
    child.send({ channel: 'native-crash-test', action: 'cleanup' });
    assert.deepEqual(await within('native crash test cleanup', 3_000, exited), [0, null]);
  } finally {
    if (alive(child)) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await within('native crash test forced cleanup', 2_000, exited);
    }
  }
}

test(
  'actual desktop enforces origin/sender/schema/binding boundaries and persists private preferences',
  { timeout: 60_000 },
  async (t) => {
    const children = new Set<ChildProcess>();
    const abort = () => {
      for (const child of children) if (alive(child)) child.kill('SIGKILL');
    };
    t.signal.addEventListener('abort', abort, { once: true });
    t.after(() => {
      t.signal.removeEventListener('abort', abort);
      abort();
    });
    const root = mkdtempSync(join(tmpdir(), 'agentspace-native-boundary-'));
    const native = await launchNative({ userData: join(root, 'profile'), entry });
    const nativeChild = native.application.process();
    children.add(nativeChild);
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
        await within(
          'first native close fallback',
          12_000,
          held.evaluate((state) => state.prompt),
        );
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
      await cleanupNative(native, nativeChild);
      nativeClosed = true;
      const reopened = await launchNative({ userData: join(root, 'profile'), entry });
      const reopenedChild = reopened.application.process();
      children.add(reopenedChild);
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
      } finally {
        await cleanupNative(reopened, reopenedChild);
      }
      await verifyCrashedRendererClose(root, example.status.spaceId, (child) =>
        children.add(child),
      );
    } finally {
      if (!nativeClosed) await cleanupNative(native, nativeChild);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
