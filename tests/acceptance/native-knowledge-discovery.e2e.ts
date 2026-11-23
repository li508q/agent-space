import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { supportedLocales, t, type Locale } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(
  root,
  '.coordination/7C/followup',
  process.env.AGENTSPACE_FOLLOWUP_LABEL ?? 'after',
  process.env.AGENTSPACE_TEST_WINDOW_MAX ?? 'default',
);
type Fixture = ReturnType<typeof createAcceptanceFixture>;
type Fault = {
  method: string | null;
  states: string | null;
  objectId: string | null;
  held: boolean;
  failAfter: boolean;
  failSaves: boolean;
  queryCalls: number;
  queryCursors: string[];
  release: (() => void) | null;
};
type Main = typeof globalThis & { __knowledgeFault: Fault };
let tabSequence = 0;
async function installFault(native: NativeHarness) {
  await native.application.evaluate(({ ipcMain }) => {
    const registry = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (
            event: unknown,
            request: {
              input?: {
                filter?: { knowledgeReviewStates?: string[] };
                objectId?: string;
                revision?: number;
                cursor?: string;
              };
            },
          ) => Promise<unknown>
        >;
      }
    )._invokeHandlers;
    if (!(registry instanceof Map)) throw new Error('Unsupported actual IPC registry');
    const fault: Fault = {
      method: null,
      states: null,
      objectId: null,
      held: false,
      failAfter: false,
      failSaves: false,
      queryCalls: 0,
      queryCursors: [],
      release: null,
    };
    (globalThis as Main).__knowledgeFault = fault;
    for (const method of ['query', 'readObject', 'saveObject', 'markKnowledgeReviewed']) {
      const name = `agentspace:method:${method}`,
        handler = registry.get(name);
      if (!handler) throw new Error('Missing actual handler');
      ipcMain.removeHandler(name);
      ipcMain.handle(name, async (event, request) => {
        if (method === 'query') {
          fault.queryCalls++;
          fault.queryCursors.push(request.input?.cursor ?? '');
        }
        if (method === 'saveObject' && fault.failSaves)
          return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
        const result = await handler(event, request);
        if (
          fault.method === method &&
          (!fault.states ||
            request.input?.filter?.knowledgeReviewStates?.join(',') === fault.states) &&
          (!fault.objectId || request.input?.objectId === fault.objectId)
        ) {
          fault.method = null;
          fault.held = true;
          await new Promise<void>((resolve) => {
            fault.release = resolve;
          });
          fault.held = false;
          if (fault.failAfter)
            return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } };
        }
        return result;
      });
    }
  });
}
async function arm(
  native: NativeHarness,
  method: string,
  options: { states?: string; objectId?: string; failAfter?: boolean } = {},
) {
  await native.application.evaluate(
    (_, input) => {
      Object.assign((globalThis as Main).__knowledgeFault, {
        ...input,
        states: input.states ?? null,
        objectId: input.objectId ?? null,
        failAfter: input.failAfter ?? false,
        held: false,
        release: null,
      });
    },
    { method, ...options },
  );
}
async function held(native: NativeHarness) {
  for (let n = 0; n < 100; n++) {
    if (await native.application.evaluate(() => (globalThis as Main).__knowledgeFault.held)) return;
    await delay(30);
  }
  assert.fail('An actual Core reply must be held');
}
async function release(native: NativeHarness) {
  await native.application.evaluate(() => {
    const fault = (globalThis as Main).__knowledgeFault;
    fault.release?.();
    fault.release = null;
  });
}
async function open(native: NativeHarness, fixture: Fixture) {
  await native.focus();
  await native.chooseNextFolder(fixture.directory);
  await native.page.getByTestId('open-space').click();
  await native.page.getByTestId('workbench').waitFor();
  await native.page.getByTestId('settings-button').click();
  await native.page.getByTestId('locale-select').selectOption('en');
  await native.page.keyboard.press('Escape');
  await native.application.evaluate(() => {
    const fault = (globalThis as Partial<Main>).__knowledgeFault;
    if (fault) fault.queryCalls = 0;
  });
}
async function waitBody(native: NativeHarness, body: string) {
  await native.page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="markdown-input"]')?.textContent === expected,
    body,
  );
}
async function waitState(native: NativeHarness, value: string) {
  try {
    await native.page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="knowledge-review-state"]')?.textContent === expected,
      value,
    );
  } catch (error) {
    console.log(
      'review-state-observation',
      await native.page.getByTestId('knowledge-review-state').textContent(),
      await native.page.locator('html').getAttribute('lang'),
    );
    await capture(native, 'review-state-failure', { expected: value });
    throw error;
  }
}
async function tabTo(native: NativeHarness, id: string) {
  const sequence = ++tabSequence;
  const trace: unknown[] = [
    await native.page.evaluate(
      (target) => ({
        stage: 'before-Tab',
        targetPresent: !!document.querySelector(`[data-testid="${target}"]`),
        rows: Array.from(
          document.querySelectorAll('.list-scroll [data-testid^="object-row-"]'),
          (row) => row.getAttribute('data-testid'),
        ),
        loading: Array.from(
          document.querySelectorAll('.list-scroll [role="status"]'),
          (row) => row.textContent,
        ),
        transitioning: document.querySelector<HTMLElement>('[data-testid="workbench"]')?.dataset
          .transitioning,
        activeId: document.activeElement?.id,
        activeTestId: document.activeElement?.getAttribute('data-testid'),
      }),
      id,
    ),
  ];
  for (let n = 0; n < 90; n++) {
    await native.page.keyboard.press('Tab');
    const observation = await native.page.evaluate((target) => {
      const active = document.activeElement,
        element =
          document.querySelector<HTMLElement>(`[data-testid="${target}"]`) ??
          document.getElementById(target),
        list = document.querySelector('.list-scroll'),
        workbench = document.querySelector<HTMLElement>('[data-testid="workbench"]');
      return {
        matched:
          active?.id === target ||
          active?.getAttribute('data-testid') === target ||
          active?.textContent?.trim() === target,
        activeId: active?.id,
        activeTestId: active?.getAttribute('data-testid'),
        target: element
          ? {
              visible:
                element.getClientRects().length > 0 &&
                getComputedStyle(element).visibility !== 'hidden',
              disabled: element.matches(':disabled'),
              inert: !!element.closest('[inert]'),
              rect: element.getBoundingClientRect().toJSON(),
            }
          : null,
        rows: Array.from(list?.querySelectorAll('[data-testid^="object-row-"]') ?? [], (row) =>
          row.getAttribute('data-testid'),
        ),
        loading: Array.from(
          list?.querySelectorAll('[role="status"]') ?? [],
          (row) => row.textContent,
        ),
        filter: document.querySelector<HTMLSelectElement>('[data-testid="knowledge-review-filter"]')
          ?.value,
        transitioning: workbench?.dataset.transitioning,
        listOpen: workbench?.dataset.listOpen,
      };
    }, id);
    trace.push(observation);
    if (observation.matched) {
      if (id.startsWith('object-row-')) {
        mkdirSync(evidence, { recursive: true });
        writeFileSync(
          join(evidence, `tab-trace-${sequence}-${id}.json`),
          JSON.stringify(trace, null, 2),
        );
      }
      return;
    }
  }
  await capture(native, `tab-failure-${id}`, trace);
  assert.fail(`Keyboard did not reach ${id}`);
}
async function nativeViewport(native: NativeHarness) {
  return native.application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!,
      bounds = window.getContentBounds(),
      zoom = window.webContents.getZoomFactor();
    return { width: bounds.width / zoom, height: bounds.height / zoom };
  });
}
async function focusGeometry(native: NativeHarness, testId?: string) {
  const viewport = await nativeViewport(native);
  return native.page.evaluate(
    ({ viewport, testId }) => {
      const element = (
          testId ? document.querySelector(`[data-testid="${testId}"]`) : document.activeElement
        ) as HTMLElement,
        rect = element.getBoundingClientRect();
      const clip = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
      const ancestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        const bt = parseFloat(style.borderTopWidth) || 0,
          br = parseFloat(style.borderRightWidth) || 0,
          bb = parseFloat(style.borderBottomWidth) || 0,
          bl = parseFloat(style.borderLeftWidth) || 0;
        const sy =
          /auto|scroll/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight
            ? Math.max(0, parent.offsetWidth - parent.clientWidth - bl - br)
            : 0;
        const sx =
          /auto|scroll/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth
            ? Math.max(0, parent.offsetHeight - parent.clientHeight - bt - bb)
            : 0;
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, box.top + bt);
          clip.bottom = Math.min(clip.bottom, box.bottom - bb - sx);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, box.left + bl);
          clip.right = Math.min(clip.right, box.right - br - sy);
        }
        if (/auto|scroll/.test(style.overflowY))
          ancestors.push({
            className: parent.className,
            rect: box.toJSON(),
            clientHeight: parent.clientHeight,
            scrollHeight: parent.scrollHeight,
            scrollTop: parent.scrollTop,
            nominalMaxScrollTop: parent.scrollHeight - parent.clientHeight,
            padding: style.paddingBlock,
            scrollPadding: style.scrollPaddingBlock,
          });
      }
      const style = getComputedStyle(element),
        outset = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const glyphs = [];
      if (element.matches('.material-create > summary')) {
        const svg = element.querySelector('svg');
        if (svg) glyphs.push(svg.getBoundingClientRect().toJSON());
        for (const node of element.childNodes)
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            glyphs.push(...Array.from(range.getClientRects(), (box) => box.toJSON()));
          }
      }
      return {
        id: element.id,
        testId: element.dataset.testid,
        text: element.innerText,
        rect: rect.toJSON(),
        viewport: { ...viewport, innerWidth, innerHeight, dpr: devicePixelRatio },
        clip,
        ancestors,
        focusVisible: element.matches(':focus-visible'),
        outline: style.outline,
        scrollMargin: style.scrollMarginBlock,
        padding: style.paddingBlock,
        selected: element.classList.contains('selected'),
        focused: document.activeElement === element,
        glyphs,
        componentVisible:
          rect.left >= clip.left - 0.5 &&
          rect.top >= clip.top - 0.5 &&
          rect.right <= clip.right + 0.5 &&
          rect.bottom <= clip.bottom + 0.5,
        paintVisible:
          rect.left - outset >= clip.left - 0.5 &&
          rect.top - outset >= clip.top - 0.5 &&
          rect.right + outset <= clip.right + 0.5 &&
          rect.bottom + outset <= clip.bottom + 0.5,
        centerClear: !!hit && (element === hit || element.contains(hit)),
      };
    },
    { viewport, testId },
  );
}
function requireFocus(value: Awaited<ReturnType<typeof focusGeometry>>) {
  assert.ok(
    value.focusVisible && value.componentVisible && value.paintVisible && value.centerClear,
    JSON.stringify(value),
  );
}
async function caretGeometry(native: NativeHarness) {
  const viewport = await nativeViewport(native);
  return native.page.evaluate((viewport) => {
    const editor = document.querySelector<HTMLElement>('[data-testid="markdown-input"]')!;
    const selection = getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode))
      throw new Error('The actual editor selection is required');
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getClientRects()[0];
    if (!rect) throw new Error('The actual collapsed caret must have a rectangle');
    let top = 0,
      bottom = viewport.height,
      left = 0,
      right = viewport.width;
    for (let parent: HTMLElement | null = editor; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        top = Math.max(top, box.top + (parseFloat(style.borderTopWidth) || 0));
        bottom = Math.min(bottom, box.bottom - (parseFloat(style.borderBottomWidth) || 0));
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
    }
    return {
      rect: rect.toJSON(),
      clip: { top, bottom, left, right },
      focused: document.activeElement === editor,
      offset: selection.anchorOffset,
      text: selection.anchorNode?.textContent,
      fullVisible:
        rect.top >= top - 0.5 &&
        rect.bottom <= bottom + 0.5 &&
        rect.left >= left - 0.5 &&
        rect.right <= right + 0.5,
    };
  }, viewport);
}
async function capture(native: NativeHarness, name: string, data: unknown) {
  mkdirSync(evidence, { recursive: true });
  await native.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const window = await native.logWindow(name);
  const png = await native.application.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
  writeFileSync(join(evidence, `${name}.json`), JSON.stringify({ window, data }, null, 2));
}

test(
  '7C one changed Library row retains its complete natural-Tab boundary at Spanish 681px',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const results = [];
    for (const width of [1024, 980]) {
      const f = createAcceptanceFixture();
      const original = requireSuccess(f.human.readObject({ objectId: f.ids.retryPolicy })).object;
      requireSuccess(
        f.human.markKnowledgeReviewed({
          operationKey: '7c:singleton:review',
          ref: { mode: 'pinned', objectId: original.id, revision: 1 },
        }),
      );
      requireSuccess(
        f.human.saveObject({
          operationKey: '7c:singleton:change',
          targetId: original.id,
          expectedRevision: 1,
          content: { ...original.content, body: 'One changed saved original.' },
        }),
      );
      const native = await launchNative({
        entry: root,
        userData: join(f.root, `Singleton ${width}`),
      });
      try {
        await open(native, f);
        await native.setWindowBounds({ width, height: 681 });
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption('es');
        await native.page.getByTestId('text-scale-select').selectOption('2');
        await native.page.keyboard.press('Escape');
        await native.page.getByTestId('nav-library').click();
        await native.page.getByTestId(`object-row-${f.ids.independent}`).click();
        for (const selected of [false, true]) {
          await native.page.getByTestId('nav-library').click();
          await tabTo(native, 'knowledge-review-filter');
          await native.page
            .getByTestId('knowledge-review-filter')
            .selectOption('changed-since-review');
          await native.page.waitForFunction((id) => {
            const list = document.querySelector('.list-scroll')!;
            return (
              list.querySelectorAll('[data-testid^="object-row-"]').length === 1 &&
              !!list.querySelector(`[data-testid="object-row-${id}"]`) &&
              !list.querySelector('[data-testid="library-more"], [role="status"], .list-empty')
            );
          }, original.id);
          const range = await native.page.locator('.list-scroll').evaluate((element) => {
            const top = element.scrollTop,
              row = element.querySelector('.material-row')!,
              rowBefore = row.getBoundingClientRect().toJSON();
            element.scrollTop = element.scrollHeight;
            const actualMax = element.scrollTop;
            element.scrollTop = top;
            return {
              top,
              actualMax,
              restoredTop: element.scrollTop,
              nominalMax: element.scrollHeight - element.clientHeight,
              rowBefore,
              rowRestored: row.getBoundingClientRect().toJSON(),
            };
          });
          assert.equal(range.restoredTop, range.top);
          assert.equal(range.rowRestored.top, range.rowBefore.top);
          const before = await focusGeometry(native, `object-row-${original.id}`);
          await capture(native, `singleton-${width}-${selected}-before-tab`, {
            range,
            row: before,
          });
          await native.page.keyboard.press('Tab');
          await native.page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          const after = await focusGeometry(native);
          assert.equal(after.testId, `object-row-${original.id}`);
          assert.equal(after.selected, selected);
          const result = { width, selected, range, before, after };
          results.push(result);
          await capture(native, `singleton-${width}-${selected}-after-tab`, result);
          writeFileSync(join(evidence, 'singleton-results.json'), JSON.stringify(results, null, 2));
          if (!selected) await native.page.keyboard.press('Enter');
        }
        assert.deepEqual(native.pageErrors, []);
      } finally {
        await native.close();
        f.dispose();
      }
    }
    assert.deepEqual(
      results.filter(
        ({ after }) =>
          !after.focusVisible ||
          !after.componentVisible ||
          !after.paintVisible ||
          !after.centerClear,
      ),
      [],
      'Each ordinary/selected singleton must fit after natural Tab; the journal retains failures.',
    );
  },
);

test(
  '7C Library review/save/reopen and Continue MRU use real current objects and keep fixed activity evidence',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = createAcceptanceFixture();
    const original = requireSuccess(f.human.readObject({ objectId: f.ids.retryPolicy })).object;
    requireSuccess(
      f.human.markKnowledgeReviewed({
        operationKey: '7c:review1',
        ref: { mode: 'pinned', objectId: original.id, revision: 1 },
      }),
    );
    requireSuccess(
      f.human.saveObject({
        operationKey: '7c:advance',
        targetId: original.id,
        expectedRevision: 1,
        content: { ...original.content, body: 'Current saved K2.' },
      }),
    );
    const profile = join(f.root, 'Knowledge discovery');
    let native = await launchNative({ entry: root, userData: profile });
    try {
      await installFault(native);
      await open(native, f);
      assert.equal(await native.page.locator('[data-testid^="object-row-"]').count(), 0);
      assert.equal(
        await native.application.evaluate(() => (globalThis as Main).__knowledgeFault.queryCalls),
        0,
      );
      await native.page.getByTestId('continue-changes').click();
      await native.page.getByTestId(`change-row-${original.changeId}`).waitFor();
      const cachedChanges = await native.page
        .locator('[data-testid^="change-row-"]')
        .evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.sequence)));
      assert.ok(cachedChanges.length > 0);
      const cachedThrough = Math.max(...cachedChanges);
      await native.page.getByTestId('activity-prepared').click();
      await native.page.keyboard.press('Escape');
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId('knowledge-review-filter').selectOption('changed-since-review');
      await native.page.getByTestId(`object-row-${original.id}`).click();
      await native.page.locator('#details-button').click();
      await waitState(native, t('en', 'knowledge.needsReview'));
      assert.equal(
        await native.page.getByTestId('knowledge-head-revision').innerText(),
        t('en', 'knowledge.headVersion', { version: 2 }),
      );
      assert.equal(
        await native.page.getByTestId('knowledge-reviewed-revision').innerText(),
        t('en', 'knowledge.reviewedVersion', { version: 1 }),
      );
      await native.page.getByTestId('mark-knowledge-reviewed').click();
      await waitState(native, t('en', 'knowledge.reviewed'));
      assert.equal(
        requireSuccess(f.human.readObject({ objectId: original.id })).object.knowledgeReview
          ?.reviewedRevision,
        2,
      );
      await native.page.waitForFunction(
        (id) => !document.querySelector(`[data-testid="object-row-${id}"]`),
        original.id,
      );
      await native.page.getByRole('button', { name: t('en', 'common.close'), exact: true }).click();
      await native.page.getByTestId('markdown-input').fill('K3 saved after review.');
      await native.page.getByTestId('save-now').click();
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId('knowledge-review-filter').selectOption('changed-since-review');
      await native.page.getByTestId(`object-row-${original.id}`).waitFor();
      await native.page.getByTestId('nav-continue').click();
      await native.page.getByTestId(`recent-row-${original.id}`).waitFor();
      assert.equal(await native.page.locator('[data-testid^="object-row-"]').count(), 0);
      await native.page.getByTestId('continue-changes').click();
      await native.page.getByTestId('activity-changes').waitFor();
      const latest = requireSuccess(f.human.readObject({ objectId: original.id })).object;
      await native.page.getByTestId(`change-row-${latest.changeId}`).waitFor();
      assert.equal(
        await native.page.getByTestId('activity-changes').getAttribute('aria-pressed'),
        'true',
      );
      const latestWindow = await native.page
        .locator('[data-testid^="change-row-"]')
        .evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.sequence)));
      assert.ok(Math.max(...latestWindow) > cachedThrough);
      const sourceTrigger = `change-version-${original.changeId}`;
      await native.page.locator(`[id="${sourceTrigger}"]`).scrollIntoViewIfNeeded();
      const activityTop = await native.page
        .getByTestId('activity-pane')
        .evaluate((element) => element.scrollTop);
      await native.page.locator(`[id="${sourceTrigger}"]`).click();
      await native.page
        .getByTestId('source-reader')
        .getByText('Retry transient failures. Investigate persistent failures.', { exact: true })
        .waitFor();
      assert.equal(
        requireSuccess(f.human.readObject({ objectId: original.id, revision: 1 })).object.content
          .body,
        original.content.body,
      );
      const other = requireSuccess(f.human.readObject({ objectId: f.ids.independent })).object;
      const afterReader = requireSuccess(
        f.human.saveObject({
          operationKey: '7c:after-reader',
          targetId: other.id,
          expectedRevision: other.revision,
          content: { ...other.content, body: 'A later authority event must wait for a new entry.' },
        }),
      ).object;
      await native.page.getByTestId('source-back').click();
      await native.page.getByTestId('activity-pane').waitFor();
      assert.deepEqual(
        await native.page
          .locator('[data-testid^="change-row-"]')
          .evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.sequence))),
        latestWindow,
      );
      assert.equal(await native.page.getByTestId(`change-row-${afterReader.changeId}`).count(), 0);
      await native.page.waitForFunction((id) => document.activeElement?.id === id, sourceTrigger);
      assert.ok(
        Math.abs(
          (await native.page
            .getByTestId('activity-pane')
            .evaluate((element) => element.scrollTop)) - activityTop,
        ) <= 1,
      );
      await native.page.keyboard.press('Escape');
      await capture(native, 'current-review-continue', {
        head: requireSuccess(f.human.readObject({ objectId: original.id })).currentRevision,
      });
      await native.close();
      native = await launchNative({ entry: root, userData: profile });
      await native.page.getByTestId('workbench').waitFor();
      await native.page.getByTestId('nav-continue').click();
      await native.page.getByTestId(`recent-row-${original.id}`).waitFor();
      await native.page.getByTestId(`recent-row-${original.id}`).click();
      await waitBody(native, 'K3 saved after review.');
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C A-B-A late query success and failure cannot replace current rows, error or loading',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const f = createAcceptanceFixture();
    const native = await launchNative({ entry: root, userData: join(f.root, 'Query races') });
    try {
      await open(native, f);
      await installFault(native);
      await native.page.getByTestId('nav-library').click();
      for (const [index, failAfter] of [false, true].entries()) {
        const objectId = index ? f.ids.independent : f.ids.measurements;
        await native.page.getByTestId('knowledge-review-filter').selectOption('');
        await native.page.getByTestId(`object-row-${objectId}`).waitFor();
        await arm(native, 'query', { states: 'never-reviewed', failAfter });
        await native.page.getByTestId('knowledge-review-filter').selectOption('never-reviewed');
        await held(native);
        requireSuccess(
          f.human.markKnowledgeReviewed({
            operationKey: `7c:race:${index}`,
            ref: { mode: 'pinned', objectId, revision: 1 },
          }),
        );
        await native.page.getByTestId('knowledge-review-filter').selectOption('current-reviewed');
        await native.page.getByTestId(`object-row-${objectId}`).waitFor();
        await native.page.getByTestId('knowledge-review-filter').selectOption('never-reviewed');
        await native.page.waitForFunction(
          (id) =>
            !document.querySelector(`[data-testid="object-row-${id}"]`) &&
            !document.querySelector('.material-list [role="status"]'),
          objectId,
        );
        const rows = await native.page
          .locator('[data-testid^="object-row-"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-testid')),
          );
        await release(native);
        await delay(100);
        assert.deepEqual(
          await native.page
            .locator('[data-testid^="object-row-"]')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('data-testid')),
            ),
          rows,
        );
        assert.equal(await native.page.locator('.material-list [role="alert"]').count(), 0);
        assert.equal(await native.page.locator('.material-list [role="status"]').count(), 0);
      }
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => {});
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C dirty same-H review and late metadata error preserve input and show actual H/R',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const f = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(f.root, 'Dirty current head'),
    });
    try {
      await open(native, f);
      await installFault(native);
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${f.ids.independent}`).click();
      await native.application.evaluate(() => {
        (globalThis as Main).__knowledgeFault.failSaves = true;
      });
      await native.page.getByTestId('markdown-input').fill('Retained human draft and caret.');
      await native.page.keyboard.press('Meta+Home');
      const caret = await caretGeometry(native);
      assert.ok(caret.focused && caret.fullVisible, JSON.stringify(caret));
      await arm(native, 'readObject', { objectId: f.ids.independent, failAfter: true });
      await native.page.locator('#details-button').click();
      await held(native);
      requireSuccess(
        f.human.markKnowledgeReviewed({
          operationKey: '7c:dirty-review',
          ref: { mode: 'pinned', objectId: f.ids.independent, revision: 1 },
        }),
      );
      await waitState(native, t('en', 'knowledge.reviewed'));
      assert.equal(
        await native.page.getByTestId('knowledge-head-revision').innerText(),
        t('en', 'knowledge.headVersion', { version: 1 }),
      );
      assert.equal(
        await native.page.getByTestId('knowledge-reviewed-revision').innerText(),
        t('en', 'knowledge.reviewedVersion', { version: 1 }),
      );
      assert.equal(await native.page.getByTestId('mark-knowledge-reviewed').isDisabled(), true);
      await release(native);
      await delay(100);
      assert.equal(
        await native.page.getByTestId('knowledge-review-state').innerText(),
        t('en', 'knowledge.reviewed'),
      );
      await native.page.getByRole('button', { name: t('en', 'common.close'), exact: true }).click();
      await waitBody(native, 'Retained human draft and caret.');
      await native.page.getByTestId('markdown-input').focus();
      const after = await caretGeometry(native);
      assert.equal(after.offset, caret.offset);
      assert.equal(after.text, caret.text);
      await native.page.getByTestId('nav-continue').click();
      await native.page
        .getByRole('button', { name: new RegExp(t('en', 'editor.resumeDraft')) })
        .click();
      await waitBody(native, 'Retained human draft and caret.');
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => {});
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C an old successful review receipt cannot label a later human save reviewed',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const f = createAcceptanceFixture();
    const native = await launchNative({ entry: root, userData: join(f.root, 'Review receipt') });
    try {
      await open(native, f);
      await installFault(native);
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${f.ids.retryPolicy}`).click();
      await native.page.locator('#details-button').click();
      await waitState(native, t('en', 'knowledge.notReviewed'));
      await arm(native, 'markKnowledgeReviewed');
      await native.page.getByTestId('mark-knowledge-reviewed').click();
      await held(native);
      await native.page.getByRole('button', { name: t('en', 'common.close'), exact: true }).click();
      await native.page
        .getByTestId('markdown-input')
        .fill('A later human save after the original review committed.');
      await native.page.getByTestId('save-now').click();
      await native.page.locator('#details-button').click();
      await waitState(native, t('en', 'knowledge.needsReview'));
      await release(native);
      await waitState(native, t('en', 'knowledge.needsReview'));
      assert.equal(
        await native.page.getByTestId('knowledge-head-revision').innerText(),
        t('en', 'knowledge.headVersion', { version: 2 }),
      );
      assert.equal(
        await native.page.getByTestId('knowledge-reviewed-revision').innerText(),
        t('en', 'knowledge.reviewedVersion', { version: 1 }),
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => {});
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C five locales keep the in-flow review filter, full list focus and real writing caret usable at native zoom',
  { skip: process.platform !== 'darwin', timeout: 180_000 },
  async () => {
    const f = createAcceptanceFixture();
    const native = await launchNative({ entry: root, userData: join(f.root, 'Knowledge locales') });
    const results = [];
    try {
      await open(native, f);
      const combinations: (readonly [Locale, 1 | 2, number, number])[] = [
        ['en', 1, 1380, 900],
        ['en', 2, 1024, 688],
        ...supportedLocales.flatMap((locale) =>
          ([1, 2] as const).map((scale) => [locale, scale, 980, 850] as const),
        ),
      ];
      for (const [index, [locale, scale, width, height]] of combinations.entries()) {
        await native.setWindowBounds({ width, height });
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption(String(scale));
        await native.page.waitForFunction(
          ({ locale, scale }) =>
            document.documentElement.lang === locale &&
            document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
              String(scale),
          { locale, scale },
        );
        await native.page.keyboard.press('Escape');
        await native.page.getByTestId('nav-library').click();
        await tabTo(native, 'knowledge-review-filter');
        const filter = await focusGeometry(native);
        await capture(native, `filter-${locale}-${width}-${scale}x`, filter);
        requireFocus(filter);
        await native.page.getByTestId('knowledge-review-filter').selectOption('never-reviewed');
        const target = index % 2 ? f.ids.handoff : f.ids.measurements;
        await native.page.waitForFunction(
          ({ target }) => {
            const list = document.querySelector('.list-scroll');
            return (
              document.querySelector<HTMLSelectElement>('[data-testid="knowledge-review-filter"]')
                ?.value === 'never-reviewed' &&
              !!list?.querySelector(`[data-testid="object-row-${target}"]`) &&
              !list.querySelector('[role="status"]') &&
              document.querySelector<HTMLElement>('[data-testid="workbench"]')?.dataset
                .transitioning === 'false'
            );
          },
          { target },
        );
        await tabTo(native, `object-row-${target}`);
        const ordinary = await focusGeometry(native);
        requireFocus(ordinary);
        await native.page.keyboard.press('Enter');
        await native.page.getByTestId('markdown-input').waitFor();
        await tabTo(native, 'markdown-input');
        await native.page.keyboard.press('Meta+Home');
        const caret = await caretGeometry(native);
        assert.ok(caret.focused && caret.fullVisible, JSON.stringify(caret));
        if ((locale === 'en' && width === 1380) || (locale === 'es' && scale === 2)) {
          await native.page.keyboard.type(`${locale} keyboard `);
          await native.page.keyboard.press('Meta+s');
          await native.page.waitForFunction(
            () =>
              document.querySelector('[data-testid="save-state"]')?.textContent?.includes('…') ===
              false,
          );
        }
        await native.page.getByTestId('nav-library').click();
        await native.page.waitForFunction(
          ({ target }) => {
            const list = document.querySelector('.list-scroll');
            return (
              document.querySelector<HTMLSelectElement>('[data-testid="knowledge-review-filter"]')
                ?.value === '' &&
              !!list?.querySelector(`[data-testid="object-row-${target}"]`) &&
              !list.querySelector('[role="status"]') &&
              document.querySelector<HTMLElement>('[data-testid="workbench"]')?.dataset
                .transitioning === 'false'
            );
          },
          { target },
        );
        await tabTo(native, `object-row-${target}`);
        const selected = await focusGeometry(native);
        requireFocus(selected);
        const overflow = await native.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1);
        const observation = { locale, scale, filter, ordinary, selected, caret, overflow };
        results.push(observation);
        await capture(native, `locale-${locale}-${width}-${scale}x`, observation);
      }
      writeFileSync(join(evidence, 'locale-results.json'), JSON.stringify(results, null, 2));
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C the existing material disclosure and four creation actions remain in the same keyboard scroll flow',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const f = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(f.root, 'Create from scroll flow'),
    });
    try {
      await open(native, f);
      const combinations: (readonly [Locale, 1 | 2, number, number])[] = [
        ['en', 1, 1380, 841],
        ...supportedLocales.map((locale) => [locale, 2, 1024, 688] as const),
      ];
      for (const [locale, scale, width, height] of combinations) {
        await native.setWindowBounds({ width, height });
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption(String(scale));
        await native.page.keyboard.press('Escape');
        const controls = [];
        for (const kind of ['document', 'project', 'record', 'asset'] as const) {
          await native.page.getByTestId('nav-library').click();
          await tabTo(native, 'new-material');
          const closed = await focusGeometry(native);
          requireFocus(closed);
          assert.ok(closed.glyphs.length >= 2);
          assert.ok(
            closed.glyphs.every(
              (glyph) =>
                glyph.left >= closed.rect.left + 4 &&
                glyph.right <= closed.rect.right - 4 &&
                glyph.top >= closed.rect.top + 4 &&
                glyph.bottom <= closed.rect.bottom - 4,
            ),
            JSON.stringify(closed),
          );
          if (kind === 'document')
            await capture(native, `create-closed-${locale}-${width}-${scale}x`, closed);
          await native.page.keyboard.press('Enter');
          await tabTo(native, `new-${kind}`);
          const expanded = await focusGeometry(native);
          requireFocus(expanded);
          if (kind === 'document')
            await capture(native, `create-open-${locale}-${width}-${scale}x`, expanded);
          const before = requireSuccess(
            f.human.query({ filter: { kind }, limit: 50, maxBytes: 65_536 }),
          ).items.length;
          const previous = (await native.page.locator('[data-testid="document-pane"]').count())
            ? await native.page.getByTestId('document-pane').getAttribute('data-editor-id')
            : null;
          await native.page.keyboard.press('Enter');
          await native.page.waitForFunction((old) => {
            const pane = document.querySelector('[data-testid="document-pane"]');
            return (
              !!pane &&
              pane.getAttribute('data-editor-id') !== old &&
              document
                .querySelector('[data-testid="workbench"]')
                ?.getAttribute('data-transitioning') === 'false'
            );
          }, previous);
          assert.equal(
            requireSuccess(f.human.query({ filter: { kind }, limit: 50, maxBytes: 65_536 })).items
              .length,
            before + 1,
          );
          controls.push({ kind, closed, expanded });
        }
        await capture(native, `new-material-${locale}-${width}-${scale}x`, controls);
      }
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      f.dispose();
    }
  },
);

test(
  '7C a failed Library append keeps its loaded rows and keyboard Retry continues the same filtered cursor',
  { skip: process.platform !== 'darwin', timeout: 90_000 },
  async () => {
    const f = createAcceptanceFixture();
    for (let n = 1; n <= 72; n++)
      requireSuccess(
        f.human.createObject({
          operationKey: `7c:page:${n}`,
          id: `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
          kind: 'document',
          content: {
            title: `Paged material ${n}`,
            body: 'A normal unreveiwed note.',
            properties: {},
            relations: [],
          },
        }),
      );
    const native = await launchNative({ entry: root, userData: join(f.root, 'Library paging') });
    try {
      await open(native, f);
      await installFault(native);
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId('knowledge-review-filter').selectOption('never-reviewed');
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="object-row-"]').length === 50,
      );
      await arm(native, 'query', { states: 'never-reviewed', failAfter: true });
      await tabTo(native, 'library-more');
      requireFocus(await focusGeometry(native));
      await native.page.keyboard.press('Enter');
      await held(native);
      await release(native);
      await native.page.locator('.material-list [role="alert"]').waitFor();
      assert.equal(await native.page.locator('[data-testid^="object-row-"]').count(), 50);
      await tabTo(native, t('en', 'common.retry'));
      requireFocus(await focusGeometry(native));
      await native.page.keyboard.press('Enter');
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="object-row-"]').length === 80,
      );
      const cursors = await native.application.evaluate(() =>
        (globalThis as Main).__knowledgeFault.queryCursors.filter(Boolean),
      );
      assert.equal(cursors.length, 2);
      assert.equal(cursors[0], cursors[1]);
      const ids = await native.page
        .locator('[data-testid^="object-row-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
      assert.equal(new Set(ids).size, 80);
      assert.equal(await native.page.getByTestId('library-more').count(), 0);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => {});
      await native.close();
      f.dispose();
    }
  },
);
