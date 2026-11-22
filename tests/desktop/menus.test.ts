import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchNative } from '../acceptance/native-harness.js';

const entry = fileURLToPath(new URL('../../dist/desktop/main.cjs', import.meta.url));

test(
  'native commands and editor Undo/Redo shortcuts operate on real data',
  { timeout: 30_000, skip: process.platform !== 'darwin' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentspace-native-menu-'));
    const native = await launchNative({ userData: join(root, 'profile'), entry });
    try {
      const { application, page } = native;
      await page.getByTestId('example-space').click();
      await page.getByTestId('workbench').waitFor();
      await application.evaluate(({ Menu, BrowserWindow, app }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.accelerator === 'CmdOrCtrl+N');
        if (!item) throw new Error('New note menu unavailable');
        app.focus({ steal: true });
        window.focus();
        item.click({}, window, window.webContents);
      });
      const body = page.getByTestId('markdown-input');
      await body.waitFor();
      await page.getByTestId('document-title').fill('Native menu verification');
      await body.pressSequentially('Native menu undo');
      assert.equal(await body.textContent(), 'Native menu undo');
      await native.focus();
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.role === 'undo');
        if (!item) throw new Error('Undo menu unavailable');
        window.focus();
      });
      // The automated session does not reliably own macOS's native first
      // responder. Verify the real editor shortcuts without claiming that a
      // Cocoa menu-role click has been exercised by this test.
      await body.press('Meta+z');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="markdown-input"]')?.textContent === '',
      );
      await native.focus();
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.role === 'redo');
        if (!item) throw new Error('Redo menu unavailable');
        window.focus();
      });
      await body.press('Meta+Shift+z');
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="markdown-input"]')?.textContent ===
          'Native menu undo',
      );
      const editorStyles = await body.evaluate((element) => ({
        whiteSpace: getComputedStyle(element).whiteSpace,
        lineHeight: getComputedStyle(element).lineHeight,
        fontFamily: getComputedStyle(element).fontFamily,
      }));
      assert.notEqual(editorStyles.lineHeight, 'normal');
      assert.ok(
        ['pre-wrap', 'break-spaces'].includes(editorStyles.whiteSpace),
        'CodeMirror dynamic styles are usable under the real CSP',
      );
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.accelerator === 'CmdOrCtrl+S');
        if (!item) throw new Error('Save menu unavailable');
        item.click({}, window, window.webContents);
      });
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
      );
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.accelerator === 'CmdOrCtrl+K');
        if (!item) throw new Error('Search menu unavailable');
        item.click({}, window, window.webContents);
      });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('data-testid') === 'space-search',
      );
      await application.evaluate(({ Menu, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        const item = Menu.getApplicationMenu()!
          .items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.accelerator === 'CmdOrCtrl+,');
        if (!item) throw new Error('Settings menu unavailable');
        item.click({}, window, window.webContents);
      });
      await page.getByTestId('settings-dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByTestId('settings-dialog').waitFor({ state: 'hidden' });
      const evidence = fileURLToPath(new URL('../../test-results/desktop/', import.meta.url));
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: join(evidence, 'native-document.png') });
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
