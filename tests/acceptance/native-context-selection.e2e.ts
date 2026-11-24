import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { Kind, ObjectSnapshot } from '../../src/contracts/core.js';
import type { PinnedRef } from '../../src/contracts/schema.js';
import { supportedLocales, t } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { installClipboardFixture } from './clipboard-fixture.js';
import { launchNative, type NativeHarness } from './native-harness.js';
import { readableControl, tabToControl } from './material-controls.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.AGENTSPACE_CONTEXT_SELECTION_RUN ?? 'latest';
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('Invalid context-selection evidence run.');
const out = join(root, '.coordination/final-release/native-context-selection', run);
const uuid = (value: number) => `82f00000-0000-4000-8000-${String(value).padStart(12, '0')}`;
type Brief = { task: string; references: { ref: PinnedRef; digest: string; title: string }[] };
type QueryFaults = {
  __contextSelectionFault: {
    holdText: string | null;
    held: boolean;
    failMore: boolean;
    failHomeAfterStale: boolean;
    failHome: boolean;
    failRead: string | null;
    failCopy: boolean;
    pages: { items: number; bytes: number; limit: number; maxBytes: number }[];
    release(): void;
    restore(): void;
  };
};

function fixture() {
  const f = createAcceptanceFixture();
  const notes = Array.from(
    { length: 24 },
    (_, index) =>
      ok(
        f.human.createObject({
          operationKey: `selection:material:${index}`,
          id: uuid(index + 1),
          kind: 'document',
          content: {
            title: `Cross material ${String(index).padStart(2, '0')}`,
            body: `Saved observation ${index}.`,
            properties: {},
            relations: [
              {
                id: uuid(index + 101),
                predicate: 'belongs_to',
                target: {
                  mode: 'current',
                  objectId: index % 2 ? f.ids.fieldNotes : f.ids.compass,
                },
              },
            ],
          },
        }),
      ).object,
  );
  const domain = ok(
    f.human.createObject({
      operationKey: 'selection:domain',
      kind: 'project',
      content: {
        title: 'Across life',
        body: 'A reusable area above individual projects.',
        properties: {},
        relations: [
          {
            id: uuid(501),
            predicate: 'related',
            target: { mode: 'current', objectId: f.ids.compass },
          },
        ],
      },
    }),
  ).object;
  return { ...f, notes, domain };
}

async function openPreparation(native: NativeHarness, directory: string, projectId: string) {
  await native.focus();
  await native.chooseNextFolder(directory);
  await native.page.getByTestId('open-space').click();
  await native.page.getByTestId('settings-button').click();
  await native.page.getByTestId('locale-select').selectOption('en');
  await native.page.keyboard.press('Escape');
  await native.setWindowBounds({ width: 1380, height: 900 });
  await native.page.getByTestId('nav-library').click();
  await native.page.getByTestId(`object-row-${projectId}`).click();
  await native.page.getByTestId('prepare-document-context').click();
  const preparation = native.page.getByTestId('context-preparation');
  await preparation.getByTestId('context-space-query').locator('summary').click();
  return preparation;
}

async function find(native: NativeHarness, kind: Kind | '', text: string) {
  const preparation = native.page.getByTestId('context-preparation');
  await preparation.getByTestId('context-query-kind').selectOption(kind);
  await preparation.getByTestId('context-query-text').fill(text);
}
async function choose(
  native: NativeHarness,
  object: Pick<ObjectSnapshot, 'id' | 'revision' | 'kind' | 'content'>,
) {
  await find(native, object.kind, object.content.title);
  await native.page.getByTestId(`context-space-${object.id}:${object.revision}`).check();
}

async function installQueryFaults(native: NativeHarness) {
  await native.application.evaluate(({ ipcMain }) => {
    type Reply = {
      ok: boolean;
      value?: { items: unknown[]; returnedBytes: number };
      error?: { code: string };
    };
    const registry = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<Reply>> }
    )._invokeHandlers;
    const handlers = new Map(
      ['query', 'readObject', 'copyText'].map((method) => {
        const channel = `agentspace:method:${method}`,
          handler = registry.get(channel);
        if (!handler) throw new Error('Actual IPC handler is required.');
        return [channel, handler] as const;
      }),
    );
    let release: (() => void) | null = null;
    const state = {
      holdText: null as string | null,
      held: false,
      failMore: false,
      failHomeAfterStale: false,
      failHome: false,
      failRead: null as string | null,
      failCopy: false,
      pages: [] as { items: number; bytes: number; limit: number; maxBytes: number }[],
      release() {
        const next = release;
        release = null;
        state.held = false;
        next?.();
      },
      restore() {
        state.release();
        for (const [channel, handler] of handlers) {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, handler);
        }
        delete (globalThis as unknown as Partial<QueryFaults>).__contextSelectionFault;
      },
    };
    for (const [channel, handler] of handlers) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, request) => {
        const input = (
          request as {
            input?: {
              filter?: { text?: string };
              limit?: number;
              maxBytes?: number;
              cursor?: string;
              objectId?: string;
            };
          }
        )?.input;
        const result = await handler(event, request);
        if (channel.endsWith(':query') && input?.limit === 20) {
          if (result.ok && result.value)
            state.pages.push({
              items: result.value.items.length,
              bytes: result.value.returnedBytes,
              limit: input.limit,
              maxBytes: input.maxBytes!,
            });
          if (state.holdText !== null && input.filter?.text === state.holdText) {
            state.holdText = null;
            state.held = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          if (state.failMore && input.cursor) {
            state.failMore = false;
            throw new Error('Synthetic next-page reply loss');
          }
          if (state.failHomeAfterStale && result.error?.code === 'CURSOR_STALE') {
            state.failHomeAfterStale = false;
            state.failHome = true;
          } else if (state.failHome && !input.cursor) {
            state.failHome = false;
            throw new Error('Synthetic fresh-page reply loss');
          }
        }
        if (channel.endsWith(':readObject') && state.failRead === input?.objectId) {
          state.failRead = null;
          throw new Error('Synthetic exact-version read reply loss');
        }
        if (channel.endsWith(':copyText') && state.failCopy) {
          state.failCopy = false;
          throw new Error('Synthetic brief copy reply loss');
        }
        return result;
      });
    }
    (globalThis as unknown as QueryFaults).__contextSelectionFault = state;
  });
}

test(
  'temporary context combines cross-project and independent versions without changing relationships or grants',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = fixture(),
      native = await launchNative({
        entry: root,
        userData: join(f.root, 'Cross-project selection profile'),
      });
    const clipboard = await installClipboardFixture(native, 'cross-project-selection');
    try {
      const preparation = await openPreparation(native, f.directory, f.ids.compass);
      await preparation
        .getByTestId('context-task')
        .fill('Compare the selected material for an open-ended personal review.');
      await find(native, 'document', 'Cross material');
      await native.page.getByTestId(`context-space-${f.notes[1]!.id}:1`).check();
      await preparation.getByTestId('context-query-more').click();
      await native.page.getByTestId(`context-space-${f.notes[23]!.id}:1`).check();
      const later = ok(
        f.human.saveObject({
          operationKey: 'selection:later-human',
          targetId: f.notes[1]!.id,
          expectedRevision: 1,
          content: { ...f.notes[1]!.content, body: 'Later human observation stays separate.' },
        }),
      ).object;
      await preparation.getByTestId('context-query-refresh').click();
      await native.page.getByTestId(`context-space-${later.id}:2`).check();
      assert.equal(
        await preparation.getByTestId(`context-retained-${later.id}:1`).isChecked(),
        true,
      );
      await choose(native, f.domain);
      await choose(native, ok(f.human.readObject({ objectId: f.ids.fieldNotes })).object);
      await choose(native, ok(f.human.readObject({ objectId: f.ids.sample })).object);
      await choose(native, ok(f.human.readObject({ objectId: f.ids.repository })).object);
      await choose(native, ok(f.human.readObject({ objectId: f.ids.independent })).object);
      const before = ok(f.human.status()).authoritySequence;
      await preparation.getByTestId('copy-context-brief').click();
      await preparation.getByTestId('context-brief-copied').waitFor();
      const brief = JSON.parse(await clipboard.readText()) as Brief;
      for (const object of [f.domain, f.notes[1]!, f.notes[23]!, later])
        assert.ok(
          brief.references.some(
            (ref) =>
              ref.ref.objectId === object.id &&
              ref.ref.revision === object.revision &&
              ref.digest === object.digest,
          ),
        );
      assert.equal(brief.references.length, 9);
      assert.equal(
        new Set(brief.references.map((item) => `${item.ref.objectId}:${item.ref.revision}`)).size,
        9,
      );
      assert.ok(!JSON.stringify(brief).includes(f.root));
      assert.deepEqual(ok(f.human.listGrants()), []);
      await find(native, 'document', 'Cross material');
      await native.page.getByTestId(`context-space-${later.id}:2`).waitFor();
      for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
        await native.page.getByTestId(`context-space-${f.notes[index]!.id}:1`).check();
      const extra = native.page.getByTestId(`context-space-${f.notes[12]!.id}:1`);
      await extra.click();
      assert.equal(await extra.isChecked(), false);
      await preparation.getByText(t('en', 'contextPrep.selectionLimit'), { exact: true }).waitFor();
      await preparation.getByTestId('context-agent-access').click();
      const settings = native.page.getByTestId('settings-dialog');
      await settings.getByTestId('grant-label').waitFor();
      assert.equal(await settings.locator('.grant-objects input:checked').count(), 19);
      assert.deepEqual(ok(f.human.listGrants()), []);
      await native.page.keyboard.press('Escape');
      await preparation.waitFor();
      await preparation.getByTestId('context-import').click();
      await native.page.getByTestId('import-dialog').waitFor();
      await native.page.keyboard.press('Escape');
      await preparation.waitFor();
      assert.equal(await preparation.getByTestId('context-task').inputValue(), brief.task);
      await preparation.getByTestId('copy-context-brief').click();
      await preparation.getByTestId('context-brief-copied').waitFor();
      const complete = JSON.parse(await clipboard.readText()) as Brief;
      assert.equal(complete.references.length, 20);
      assert.equal(ok(f.human.status()).authoritySequence, before);
      assert.deepEqual(ok(f.human.readObject({ objectId: f.notes[1]!.id })).object, later);
      for (const object of f.notes.filter((object) => object.id !== later.id))
        assert.deepEqual(ok(f.human.readObject({ objectId: object.id })).object, object);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.page.evaluate(() => window.agentSpace.bootstrap()).catch(() => undefined);
      await clipboard.restore();
      await native.close();
      f.dispose();
    }
  },
);

test(
  'cross-space queries retain successful pages and exact selections through stale, failed and late responses',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = fixture(),
      native = await launchNative({
        entry: root,
        userData: join(f.root, 'Selection failure and layout profile'),
      });
    const clipboard = await installClipboardFixture(native, 'context-selection-failures');
    const observations: unknown[] = [];
    let installed = false;
    mkdirSync(out, { recursive: true });
    try {
      const preparation = await openPreparation(native, f.directory, f.ids.compass),
        query = preparation.getByTestId('context-space-query');
      await installQueryFaults(native);
      installed = true;
      await preparation
        .getByTestId('context-task')
        .fill('Keep fixed sources while changing the question.');
      await find(native, 'document', 'Cross material');
      await native.page.getByTestId(`context-space-${f.notes[1]!.id}:1`).check();
      await native.application.evaluate(() => {
        (globalThis as unknown as QueryFaults).__contextSelectionFault.failMore = true;
      });
      await preparation.getByTestId('context-query-more').click();
      const unknown = query
        .getByTestId('error-notice')
        .filter({ hasText: t('en', 'error.OPERATION_UNKNOWN') });
      await unknown.waitFor();
      assert.equal(await query.locator('input[data-testid^="context-space-"]').count(), 20);
      await unknown.getByRole('button', { name: t('en', 'common.retry'), exact: true }).click();
      await native.page.getByTestId(`context-space-${f.notes[23]!.id}:1`).waitFor();
      await preparation.getByTestId('context-query-refresh').click();
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="context-space-query"] input[data-testid^="context-space-"]',
          ).length === 20 &&
          !document.querySelector<HTMLButtonElement>('[data-testid="context-query-refresh"]')
            ?.disabled,
      );
      const later = ok(
        f.human.saveObject({
          operationKey: 'selection:stale-head',
          targetId: f.notes[1]!.id,
          expectedRevision: 1,
          content: { ...f.notes[1]!.content, body: 'A later saved head.' },
        }),
      ).object;
      await native.application.evaluate(() => {
        (globalThis as unknown as QueryFaults).__contextSelectionFault.failHomeAfterStale = true;
      });
      await preparation.getByTestId('context-query-more').click();
      await unknown.waitFor();
      assert.equal(await query.locator('input[data-testid^="context-space-"]').count(), 20);
      assert.equal(await query.getByTestId(`context-space-${f.notes[1]!.id}:1`).isChecked(), true);
      await query.getByText(t('en', 'error.CURSOR_STALE'), { exact: true }).waitFor();
      assert.equal(await preparation.getByTestId('context-query-more').count(), 0);
      await unknown.getByRole('button', { name: t('en', 'common.retry'), exact: true }).click();
      await native.page.getByTestId(`context-space-${later.id}:2`).waitFor();
      assert.equal(
        await preparation.getByTestId(`context-retained-${later.id}:1`).isChecked(),
        true,
      );
      await native.application.evaluate(() => {
        (globalThis as unknown as QueryFaults).__contextSelectionFault.holdText = 'Cross material';
      });
      await preparation.getByTestId('context-query-refresh').click();
      const until = Date.now() + 5_000;
      while (
        !(await native.application.evaluate(
          () => (globalThis as unknown as QueryFaults).__contextSelectionFault.held,
        ))
      ) {
        assert.ok(Date.now() < until, 'The original query response must be held.');
        await delay(20);
      }
      await preparation.getByTestId('context-query-text').fill('no matching saved material');
      await query.getByText(t('en', 'contextPrep.queryEmpty'), { exact: true }).waitFor();
      await native.application.evaluate(() =>
        (globalThis as unknown as QueryFaults).__contextSelectionFault.release(),
      );
      await native.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      assert.equal(await query.locator('input[data-testid^="context-space-"]').count(), 0);
      assert.equal(
        await preparation.getByTestId(`context-retained-${later.id}:1`).isChecked(),
        true,
      );
      await native.application.evaluate((_electron, id) => {
        (globalThis as unknown as QueryFaults).__contextSelectionFault.failRead = id;
      }, later.id);
      await preparation.getByTestId('copy-context-brief').click();
      const retained = preparation
        .getByTestId(`context-retained-${later.id}:1`)
        .locator('..')
        .locator('..');
      await retained.getByTestId('error-notice').waitFor();
      assert.equal(await preparation.getByTestId('copy-context-brief').isDisabled(), true);
      assert.equal(await preparation.getByTestId('context-agent-access').isDisabled(), true);
      assert.equal(await clipboard.readText(), '');
      await retained.getByRole('button', { name: t('en', 'common.retry'), exact: true }).click();
      await retained.getByTestId('error-notice').waitFor({ state: 'hidden' });
      await native.application.evaluate(() => {
        (globalThis as unknown as QueryFaults).__contextSelectionFault.failCopy = true;
      });
      await preparation.getByTestId('copy-context-brief').click();
      const copyError = preparation
        .getByTestId('error-notice')
        .filter({ hasText: t('en', 'error.OPERATION_UNKNOWN') });
      await copyError.waitFor();
      assert.equal(
        await preparation.getByTestId('context-task').inputValue(),
        'Keep fixed sources while changing the question.',
      );
      await copyError.getByRole('button', { name: t('en', 'common.retry'), exact: true }).click();
      await preparation.getByTestId('context-brief-copied').waitFor();
      const fixed = JSON.parse(await clipboard.readText()) as Brief;
      assert.ok(
        fixed.references.some(
          (item) =>
            item.ref.objectId === later.id &&
            item.ref.revision === 1 &&
            item.digest === f.notes[1]!.digest,
        ),
      );
      for (const locale of supportedLocales) {
        await native.page.keyboard.press('Escape');
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption('2');
        await native.page.keyboard.press('Escape');
        await native.setWindowBounds({ width: 980, height: locale === 'es' ? 681 : 688 });
        await native.page.getByTestId('prepare-document-context').click();
        await preparation.waitFor();
        const input = preparation.getByTestId('context-query-text');
        await tabToControl(native, input);
        observations.push({
          locale,
          input: await readableControl(input),
          geometry: await native.logWindow(`selection-${locale}`),
        });
        assert.equal(
          await preparation.getByTestId(`context-retained-${later.id}:1`).isChecked(),
          true,
        );
        const type = preparation.getByTestId('context-query-kind');
        await tabToControl(native, type);
        observations.push({ locale, type: await readableControl(type) });
      }
      const pages = await native.application.evaluate(
        () => (globalThis as unknown as QueryFaults).__contextSelectionFault.pages,
      );
      assert.ok(pages.length > 0);
      assert.ok(
        pages.every(
          (page) =>
            page.items <= 20 &&
            page.bytes <= 32_768 &&
            page.limit === 20 &&
            page.maxBytes === 32_768,
        ),
      );
      assert.deepEqual(ok(f.human.listGrants()), []);
      assert.deepEqual(ok(f.human.readObject({ objectId: later.id })).object, later);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      writeFileSync(
        join(out, 'query-failures-and-layout.json'),
        JSON.stringify(observations, null, 2),
      );
      if (installed)
        await native.application.evaluate(() =>
          (globalThis as unknown as QueryFaults).__contextSelectionFault.restore(),
        );
      await native.page.evaluate(() => window.agentSpace.bootstrap()).catch(() => undefined);
      await clipboard.restore();
      await native.close();
      f.dispose();
    }
  },
);
