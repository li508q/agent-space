import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import type { AppBootstrap } from '../../src/contracts/app.js';
import type { Result } from '../../src/contracts/errors.js';

export type NativeHarness = {
  application: ElectronApplication;
  page: Page;
  pageErrors: string[];
  bootstrap(): Promise<Result<AppBootstrap>>;
  focus(): Promise<void>;
  chooseNextFolder(directory: string): Promise<void>;
  close(): Promise<void>;
};

/** Actual Electron, with a private app profile. No renderer mocks or real user settings. */
export async function launchNative(options: {
  userData: string;
  entry?: string;
  executablePath?: string;
  mainRequire?: string;
}): Promise<NativeHarness> {
  mkdirSync(options.userData, { recursive: true, mode: 0o700 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.AGENTSPACE_USER_DATA = options.userData;

  const resolved: unknown = options.executablePath ?? createRequire(import.meta.url)('electron');
  if (typeof resolved !== 'string') throw new Error('An Electron executable is required.');
  const application = await _electron.launch({
    executablePath: resolved,
    args: [
      ...(options.mainRequire ? ['--require', options.mainRequire] : []),
      ...(options.entry ? [options.entry] : []),
    ],
    env,
    timeout: 30_000,
  });
  const pageErrors: string[] = [];
  try {
    const page = await application.firstWindow({ timeout: 30_000 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(10_000);
    await page.waitForFunction(() => typeof window.agentSpace?.bootstrap === 'function');
    return {
      application,
      page,
      pageErrors,
      bootstrap: () => page.evaluate(() => window.agentSpace.bootstrap()),
      async focus() {
        await application.evaluate(({ app, BrowserWindow }) => {
          app.focus({ steal: true });
          const window = BrowserWindow.getAllWindows()[0];
          window?.show();
          window?.focus();
        });
        await page.waitForFunction(() => document.hasFocus());
      },
      async chooseNextFolder(directory) {
        // Substitute only the OS chooser result. The visible control, preload,
        // sender/schema/binding checks, core and native renderer stay real.
        // OS picker interaction needs its own manual/native accessibility check.
        await application.evaluate(({ dialog }, selected) => {
          const original = dialog.showOpenDialog;
          dialog.showOpenDialog = async () => {
            dialog.showOpenDialog = original;
            return { canceled: false, filePaths: [selected] };
          };
        }, directory);
      },
      close: () => stopNative(application),
    };
  } catch (error) {
    await stopNative(application);
    throw error;
  }
}

async function stopNative(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const closed = application.close().catch(() => undefined);
  const orderly = await Promise.race([
    closed.then(() => true),
    delay(2_000, undefined, { ref: false }).then(() => false),
  ]);
  if (orderly || child.exitCode !== null || child.signalCode !== null) return;
  // Cleanup of an isolated failed test is not a product close/recovery assertion.
  const exited = once(child, 'exit').catch(() => undefined);
  child.kill('SIGKILL');
  await Promise.race([exited, delay(2_000, undefined, { ref: false })]);
}
