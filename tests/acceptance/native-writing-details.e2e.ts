import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { ObjectSnapshot } from '../../src/contracts/core.js';
import type { Failure } from '../../src/contracts/errors.js';
import { supportedLocales, t } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { installClipboardFixture } from './clipboard-fixture.js';
import { launchNative, type NativeHarness } from './native-harness.js';
import { readableControl, tabToControl, writingState } from './material-controls.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.AGENTSPACE_WRITING_DETAILS_RUN ?? 'latest';
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('Invalid writing-details evidence run.');
const out = join(root, '.coordination/final-release/native-writing-details', run);
type Faults = {
  __writingDetailsFault: {
    holdCopy: boolean;
    failCopy: boolean;
    held: boolean;
    failWrites: boolean;
    release(): void;
    restore(): void;
  };
};

async function english(native: NativeHarness) {
  await native.page.getByTestId('settings-button').click();
  await native.page.getByTestId('locale-select').selectOption('en');
  await native.page.keyboard.press('Escape');
}
async function openObject(native: NativeHarness, object: Pick<ObjectSnapshot, 'id' | 'content'>) {
  await native.page.getByTestId('nav-library').click();
  await native.page.getByTestId(`object-row-${object.id}`).click();
  await native.page.waitForFunction(
    (title) =>
      document.querySelector<HTMLInputElement>('[data-testid="document-title"]')?.value === title,
    object.content.title,
  );
}
async function waitCopyHeld(native: NativeHarness) {
  const until = Date.now() + 5_000;
  while (
    !(await native.application.evaluate(
      () => (globalThis as unknown as Faults).__writingDetailsFault.held,
    ))
  ) {
    assert.ok(Date.now() < until, 'The actual copy reply was not held.');
    await delay(20);
  }
}
async function selectBody(native: NativeHarness, start: number, length: number) {
  await native.page.getByTestId('markdown-input').click();
  await native.page.keyboard.press('Meta+A');
  await native.page.keyboard.press('ArrowLeft');
  for (let index = 0; index < start; index++) await native.page.keyboard.press('ArrowRight');
  for (let index = 0; index < length; index++) await native.page.keyboard.press('Shift+ArrowRight');
}

async function installFaults(native: NativeHarness) {
  await native.application.evaluate(({ ipcMain }) => {
    const registry = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
      }
    )._invokeHandlers;
    const original = new Map(
      ['copyText', 'saveObject', 'saveDraft'].map((method) => {
        const channel = `agentspace:method:${method}`,
          handler = registry.get(channel);
        if (!handler) throw new Error('Expected actual IPC handler.');
        return [channel, handler] as const;
      }),
    );
    let release: (() => void) | null = null;
    const state = {
      holdCopy: false,
      failCopy: false,
      held: false,
      failWrites: false,
      release() {
        const next = release;
        release = null;
        state.held = false;
        next?.();
      },
      restore() {
        state.release();
        for (const [channel, handler] of original) {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, handler);
        }
        delete (globalThis as unknown as Partial<Faults>).__writingDetailsFault;
      },
    };
    for (const [channel, handler] of original) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, request) => {
        if (state.failWrites && !channel.endsWith(':copyText'))
          return {
            ok: false,
            error: { code: 'STORAGE_FAILURE', retryable: true },
          } satisfies Failure;
        const result = await handler(event, request);
        if (channel.endsWith(':copyText')) {
          if (state.holdCopy) {
            state.holdCopy = false;
            state.held = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          if (state.failCopy) {
            state.failCopy = false;
            throw new Error('Synthetic copy reply loss');
          }
        }
        return result;
      });
    }
    (globalThis as unknown as Faults).__writingDetailsFault = state;
  });
}

test(
  'recorded locations retain exact historical snapshots and context details leave writing space',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = createAcceptanceFixture(),
      sentinel = join(f.root, 'never-executed');
    const oldLocation = `https://example.invalid/資料 café/$(touch ${sentinel})`,
      currentLocation = join(f.root, 'Moved 原件 café', 'repository with spaces'),
      importedLocation = join(f.root, 'Original 資料 café', 'long folder '.repeat(18), 'note.md');
    const referenced = ok(
      f.human.createObject({
        operationKey: 'details:reference',
        kind: 'asset',
        content: {
          title: 'Recorded reference',
          body: 'A separately managed reference.',
          properties: {},
          relations: [],
        },
        origin: { mode: 'external-reference', label: 'Synthetic reference', locator: oldLocation },
      }),
    ).object;
    const current = ok(
      f.human.relinkExternalAsset({
        operationKey: 'details:relink',
        objectId: referenced.id,
        expectedRevision: 1,
        locator: currentLocation,
        observedAt: new Date().toISOString(),
      }),
    ).object;
    const imported = ok(
      f.human.createObject({
        operationKey: 'details:imported',
        kind: 'document',
        content: {
          title: 'Imported writing',
          body: 'Keep these authored words: 中文 日本語 한국어 café.',
          properties: {},
          relations: [],
        },
        origin: { mode: 'imported-copy', label: 'Synthetic original', locator: importedLocation },
      }),
    ).object;
    const missing = ok(
      f.human.createObject({
        operationKey: 'details:missing',
        kind: 'asset',
        content: {
          title: 'No recorded location',
          body: 'An explicit missing location.',
          properties: {},
          relations: [],
        },
        origin: { mode: 'external-reference', label: 'Location not recorded' },
      }),
    ).object;
    const native = await launchNative({
      entry: root,
      userData: join(f.root, 'Writing details profile'),
    });
    const clipboard = await installClipboardFixture(native, 'writing-details-exact-snapshots');
    mkdirSync(out, { recursive: true });
    const measurements: unknown[] = [];
    try {
      await native.focus();
      await native.chooseNextFolder(f.directory);
      await native.page.getByTestId('open-space').click();
      await english(native);
      await native.setWindowBounds({ width: 1380, height: 900 });
      await native.page.getByTestId('nav-library').click();
      await openObject(native, current);
      assert.equal(
        await native.page.getByTestId('recorded-location-value').textContent(),
        currentLocation,
      );
      const before = ok(f.human.status()).authoritySequence;
      await native.page.getByTestId('recorded-location-copy').click();
      assert.equal(await clipboard.readText(), currentLocation);
      await native.page.locator('#details-button').click();
      assert.equal(
        await native.page.getByTestId('details-recorded-location-value').textContent(),
        currentLocation,
      );
      await native.page.getByTestId('details-recorded-location-copy').click();
      assert.equal(await clipboard.readText(), currentLocation);
      await native.page
        .locator('.details-pane')
        .getByRole('button', { name: t('en', 'common.close'), exact: true })
        .click();
      await native.page.locator('#history-button').click();
      await native.page.locator('#history-r1').click();
      const source = native.page.getByTestId('source-reader');
      await source.getByText(oldLocation, { exact: true }).waitFor();
      assert.equal(
        await source.getByTestId('source-recorded-location-value').textContent(),
        oldLocation,
      );
      assert.equal(await source.getByTestId('source-recorded-location').locator('a').count(), 0);
      await source.getByTestId('source-recorded-location-copy').click();
      assert.equal(await clipboard.readText(), oldLocation);
      const historicalDetails = source.getByTestId('copy-source-context-details');
      assert.equal(await historicalDetails.getAttribute('open'), null);
      await historicalDetails.locator('summary').click();
      await source.getByTestId('copy-source-context').click();
      const payload = JSON.parse(await clipboard.readText());
      assert.equal(payload.object.id, referenced.id);
      assert.equal(payload.object.revision, 1);
      await source.getByTestId('source-back').click();
      await native.page
        .getByTestId('history-pane')
        .getByRole('button', { name: t('en', 'common.close'), exact: true })
        .click();
      await openObject(native, missing);
      assert.equal(await native.page.getByTestId('recorded-location-copy').isDisabled(), true);
      await openObject(native, ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object);
      assert.equal(await native.page.getByTestId('recorded-location').count(), 0);
      await openObject(native, imported);
      assert.equal(
        await native.page.getByTestId('recorded-location-value').textContent(),
        importedLocation,
      );
      const markdown = native.page.getByTestId('markdown-input'),
        originalInput = await markdown.elementHandle();
      await markdown.click();
      await native.page.keyboard.press('Meta+ArrowLeft');
      await native.page.keyboard.press('Shift+ArrowRight');
      const selection = await writingState(native);
      const details = native.page.getByTestId('copy-saved-context-details');
      assert.equal(await details.getAttribute('open'), null);
      await details.locator('summary').click();
      await native.page.getByTestId('copy-saved-context').click();
      const selected = JSON.parse(await clipboard.readText());
      assert.equal(selected.scope, 'one-saved-object-selected-body');
      assert.equal(
        selected.object.bodySelection,
        imported.content.body.slice(selection.caret.anchor, selection.caret.head),
      );
      await details.locator('summary').click();
      assert.deepEqual(await writingState(native), selection);
      assert.equal(
        await originalInput!.evaluate(
          (element) =>
            element.isConnected &&
            element === document.querySelector('[data-testid="markdown-input"]'),
        ),
        true,
      );
      assert.equal(ok(f.human.status()).authoritySequence, before);
      assert.equal(existsSync(sentinel), false);
      for (const locale of supportedLocales) {
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption('2');
        await native.page.keyboard.press('Escape');
        await native.setWindowBounds({ width: 1024, height: 688 });
        const control = native.page.getByTestId('recorded-location-copy');
        await tabToControl(native, control);
        measurements.push({
          locale,
          control: await readableControl(control),
          geometry: await native.logWindow(`details-${locale}`),
        });
        assert.equal(
          await native.page.getByTestId('recorded-location-value').textContent(),
          importedLocation,
        );
        await control.click();
        assert.equal(await clipboard.readText(), importedLocation);
        const same = await writingState(native);
        assert.equal(same.id, selection.id);
        assert.equal(same.generation, selection.generation);
        assert.equal(same.revision, selection.revision);
        assert.equal(same.body, selection.body);
        assert.deepEqual(same.caret, selection.caret);
      }
      assert.deepEqual(ok(f.human.readObject({ objectId: imported.id })).object, imported);
      assert.deepEqual(ok(f.human.readObject({ objectId: current.id })).object, current);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      writeFileSync(join(out, 'locations-and-layout.json'), JSON.stringify(measurements, null, 2));
      await native.page.evaluate(() => window.agentSpace.bootstrap()).catch(() => undefined);
      await clipboard.restore();
      await native.close();
      f.dispose();
    }
  },
);

test(
  'late copy receipts and collapsed details preserve failed-save input and recovery controls',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const f = createAcceptanceFixture(),
      native = await launchNative({
        entry: root,
        userData: join(f.root, 'Writing details failure profile'),
      });
    const clipboard = await installClipboardFixture(native, 'writing-details-failures');
    let installed = false;
    try {
      await native.focus();
      await native.chooseNextFolder(f.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId('nav-library').click();
      await english(native);
      await openObject(native, ok(f.human.readObject({ objectId: f.ids.repository })).object);
      await installFaults(native);
      installed = true;
      await native.application.evaluate(() => {
        const fault = (globalThis as unknown as Faults).__writingDetailsFault;
        fault.holdCopy = true;
        fault.failCopy = true;
      });
      await native.page.getByTestId('recorded-location-copy').click();
      await waitCopyHeld(native);
      await openObject(native, ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object);
      await native.application.evaluate(() =>
        (globalThis as unknown as Faults).__writingDetailsFault.release(),
      );
      await native.page.getByTestId('markdown-input').waitFor();
      assert.equal(
        await native.page.getByTestId('document-pane').getByTestId('error-notice').count(),
        0,
      );
      const details = native.page.getByTestId('copy-saved-context-details');
      await details.locator('summary').click();
      await selectBody(native, 2, 5);
      const selectionA = await writingState(native);
      await native.application.evaluate(() => {
        (globalThis as unknown as Faults).__writingDetailsFault.holdCopy = true;
      });
      await native.page.getByTestId('copy-saved-context').click();
      await waitCopyHeld(native);
      assert.equal(JSON.parse(await clipboard.readText()).object.bodySelection, 'Retry');
      await selectBody(native, 8, 6);
      const selectionB = await writingState(native);
      assert.equal(selectionB.generation, selectionA.generation);
      assert.notDeepEqual(selectionB.caret, selectionA.caret);
      await native.application.evaluate(() =>
        (globalThis as unknown as Faults).__writingDetailsFault.release(),
      );
      await native.page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>('[data-testid="copy-saved-context"]')
            ?.disabled,
      );
      assert.equal(
        await native.page
          .getByTestId('copy-saved-context')
          .locator('..')
          .getByRole('status')
          .count(),
        0,
      );
      await native.page.getByTestId('copy-saved-context').click();
      await details.getByRole('status').waitFor();
      assert.equal(JSON.parse(await clipboard.readText()).object.bodySelection, 'policy');
      await native.application.evaluate(() => {
        (globalThis as unknown as Faults).__writingDetailsFault.failCopy = true;
      });
      await native.page.getByTestId('copy-saved-context').click();
      await native.page.getByTestId('document-pane').getByTestId('error-notice').waitFor();
      await details.locator('summary').click();
      assert.equal(
        await native.page.getByTestId('document-pane').getByTestId('error-notice').isVisible(),
        true,
      );
      await native.page
        .getByTestId('document-pane')
        .getByTestId('error-notice')
        .getByRole('button', { name: t('en', 'common.retry'), exact: true })
        .click();
      await native.page
        .getByTestId('document-pane')
        .getByTestId('error-notice')
        .waitFor({ state: 'hidden' });
      assert.equal(JSON.parse(await clipboard.readText()).object.id, f.ids.retryPolicy);
      const original: ObjectSnapshot = ok(
        f.human.readObject({ objectId: f.ids.retryPolicy }),
      ).object;
      await native.application.evaluate(() => {
        (globalThis as unknown as Faults).__writingDetailsFault.failWrites = true;
      });
      const beforeFailure = await writingState(native);
      assert.equal(beforeFailure.draftError, null);
      await native.page
        .getByTestId('markdown-input')
        .fill('Later unsaved 中文 日本語 한국어 café input.');
      const untilDraftFailure = Date.now() + 5_000;
      let retainedFailure = await writingState(native);
      while (retainedFailure.draftError !== 'STORAGE_FAILURE') {
        assert.ok(Date.now() < untilDraftFailure, 'The scheduled draft retention must fail first.');
        await delay(20);
        retainedFailure = await writingState(native);
      }
      assert.equal(retainedFailure.body, 'Later unsaved 中文 日本語 한국어 café input.');
      assert.ok(retainedFailure.generation > beforeFailure.generation);
      await native.page.getByTestId('save-now').click();
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid="document-pane"] [role="alert"]').length >= 2,
      );
      const failed = await writingState(native),
        input = await native.page.getByTestId('markdown-input').elementHandle();
      assert.equal(failed.saveState, 'error');
      assert.equal(failed.draftError, 'STORAGE_FAILURE');
      for (let index = 0; index < 2; index++) await details.locator('summary').click();
      assert.deepEqual(await writingState(native), failed);
      assert.equal(await input!.evaluate((element) => element.isConnected), true);
      const rescue = native.page
        .getByTestId('document-pane')
        .getByRole('button', { name: t('en', 'editor.copyEdits'), exact: true });
      assert.equal(await rescue.isVisible(), true);
      await rescue.click();
      assert.equal(await clipboard.readText(), failed.body);
      assert.deepEqual(ok(f.human.readObject({ objectId: original.id })).object, original);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      if (installed)
        await native.application.evaluate(() =>
          (globalThis as unknown as Faults).__writingDetailsFault.restore(),
        );
      await native.page.evaluate(() => window.agentSpace.bootstrap()).catch(() => undefined);
      await clipboard.restore();
      await native.close();
      f.dispose();
    }
  },
);
