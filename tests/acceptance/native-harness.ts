import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import type { AppBootstrap } from '../../src/contracts/app.js';
import type { Result } from '../../src/contracts/errors.js';

type WindowBounds = { width: number; height: number };
export type NativeWindowGeometry = {
  runtimeVersion: string;
  executionKind: string;
  requestedWindow: WindowBounds | null;
  controlledMaximum: WindowBounds | null;
  bounds: { x: number; y: number; width: number; height: number };
  contentBounds: { x: number; y: number; width: number; height: number };
  zoomFactor: number;
  workArea: { x: number; y: number; width: number; height: number };
  css: { width: number; height: number; dpr: number };
  view: {
    compact: string | null;
    listOpen: string | null;
    auxiliary: string | null;
    transitioning: string | null;
  };
};

export type NativeHarness = {
  application: ElectronApplication;
  page: Page;
  pageErrors: string[];
  bootstrap(): Promise<Result<AppBootstrap>>;
  focus(): Promise<void>;
  chooseNextFolder(directory: string): Promise<void>;
  setWindowBounds(bounds: WindowBounds): Promise<NativeWindowGeometry>;
  logWindow(label: string): Promise<NativeWindowGeometry>;
  close(): Promise<void>;
};

/** Actual Electron, with a private app profile. No renderer mocks or real user settings. */
export async function launchNative(options: {
  userData: string;
  entry?: string;
  executablePath?: string;
  mainRequire?: string;
  windowBounds?: WindowBounds;
}): Promise<NativeHarness> {
  mkdirSync(options.userData, { recursive: true, mode: 0o700 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  // Test-runner control only: never expose a viewport/testing switch to the app.
  const rawMaximum = process.env.AGENTSPACE_TEST_WINDOW_MAX;
  delete env.AGENTSPACE_TEST_WINDOW_MAX;
  const dimensions = rawMaximum?.match(/^(\d{3,4})x(\d{3,4})$/);
  if (rawMaximum && !dimensions)
    throw new Error('AGENTSPACE_TEST_WINDOW_MAX expects WIDTHxHEIGHT.');
  const maximum = dimensions
    ? { width: Number(dimensions[1]), height: Number(dimensions[2]) }
    : null;
  if (maximum && (maximum.width < 640 || maximum.height < 480))
    throw new Error('The controlled test window is too small.');
  env.AGENTSPACE_USER_DATA = options.userData;

  // A test-only override runs these same visible controls against an actual
  // packaged application. Never pass the development source entry to that app.
  const packaged = process.env.AGENTSPACE_TEST_EXECUTABLE;
  const resolved: unknown =
    options.executablePath ?? packaged ?? createRequire(import.meta.url)('electron');
  if (typeof resolved !== 'string') throw new Error('An Electron executable is required.');
  // This module exports a self-contained installer. Load it in the trusted test
  // process, then run it through Main's inspector after the real IPC handlers
  // exist. Packaged Electron does not execute the development --require hook.
  const installFault: unknown = options.mainRequire
    ? createRequire(import.meta.url)(options.mainRequire)
    : null;
  if (options.mainRequire && typeof installFault !== 'function')
    throw new Error('The Main fault fixture must export an installer.');
  const application = await _electron.launch({
    executablePath: resolved,
    args: options.entry && !packaged ? [options.entry] : [],
    env,
    timeout: 30_000,
  });
  // Playwright removes the process channel when the app exits. Keep the actual
  // child while the connection is live so cleanup is safe after a real quit.
  const child = application.process();
  const pageErrors: string[] = [];
  try {
    const page = await application.firstWindow({ timeout: 30_000 });
    if (typeof installFault === 'function') {
      await application.evaluate(({ ipcMain }, installer) => {
        // Only the trusted fixture source crosses the Main debug connection.
        // No renderer capability, product test flag or packaged file is added.
        const install = new Function('ipcMain', `return (${installer})(ipcMain);`);
        install(ipcMain);
      }, Function.prototype.toString.call(installFault));
    }
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(10_000);
    await page.waitForFunction(() => typeof window.agentSpace?.bootstrap === 'function');
    async function geometry(
      label: string,
      requestedWindow: WindowBounds | null = null,
    ): Promise<NativeWindowGeometry> {
      const native = await application.evaluate(({ BrowserWindow, screen, app }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        return {
          runtimeVersion: app.getVersion(),
          bounds: window.getBounds(),
          contentBounds: window.getContentBounds(),
          zoomFactor: window.webContents.getZoomFactor(),
          workArea: screen.getDisplayMatching(window.getBounds()).workArea,
        };
      });
      const renderer = await page.evaluate(() => ({
        css: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        view: {
          compact:
            document.querySelector('[data-testid="workbench"]')?.getAttribute('data-compact') ??
            null,
          listOpen:
            document.querySelector('[data-testid="workbench"]')?.getAttribute('data-list-open') ??
            null,
          auxiliary:
            document.querySelector('[data-testid="workbench"]')?.getAttribute('data-aux') ?? null,
          transitioning:
            document
              .querySelector('[data-testid="workbench"]')
              ?.getAttribute('data-transitioning') ?? null,
        },
      }));
      const value = {
        requestedWindow,
        controlledMaximum: maximum,
        executionKind: packaged
          ? 'configured packaged executable'
          : options.executablePath
            ? 'explicit executable override'
            : 'development Electron',
        ...native,
        ...renderer,
      };
      // Geometry and generic view flags only; no environment, tokens or authored content.
      console.log(`[native-window:${label}] ${JSON.stringify(value)}`);
      return value;
    }
    async function setWindowBounds(requested: WindowBounds) {
      const applied = maximum
        ? {
            width: Math.min(requested.width, maximum.width),
            height: Math.min(requested.height, maximum.height),
          }
        : requested;
      await application.evaluate(
        ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]!.setBounds(bounds),
        applied,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      return geometry('resize', requested);
    }
    await geometry('launch');
    if (options.windowBounds ?? maximum) await setWindowBounds((options.windowBounds ?? maximum)!);
    return {
      application,
      page,
      pageErrors,
      setWindowBounds,
      logWindow: (label) => geometry(label),
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
      close: async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await geometry('close').catch(() => {});
        await stopNative(application, child);
      },
    };
  } catch (error) {
    await stopNative(application, child);
    throw error;
  }
}

async function stopNative(application: ElectronApplication, child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => undefined);
  void application.close().catch(() => undefined);
  await Promise.race([exited, delay(2_000, undefined, { ref: false })]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Cleanup of an isolated failed test is not a product close/recovery assertion.
  child.kill('SIGKILL');
  await Promise.race([exited, delay(2_000, undefined, { ref: false })]);
}
