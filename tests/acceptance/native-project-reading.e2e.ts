import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';
import { supportedLocales, t, type Locale } from '../../src/renderer/i18n/index.js';
import { bound } from '../../src/renderer/state/binding.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const uuid = (value: number) => `70000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const citedRelation = uuid(1),
  selfSource = uuid(2);
const k2Body = 'Current K2: retry only transient failures; retain explicit evidence.';

function readingFixture() {
  const fixture = createAcceptanceFixture();
  const k1 = requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object;
  requireSuccess(
    fixture.human.saveObject({
      operationKey: '7a:K2',
      targetId: k1.id,
      expectedRevision: k1.revision,
      content: {
        ...k1.content,
        body: k2Body,
        relations: [
          ...k1.content.relations,
          {
            id: selfSource,
            predicate: 'source',
            target: { mode: 'pinned', objectId: k1.id, revision: 1 },
          },
        ],
      },
    }),
  );
  const project = requireSuccess(
    fixture.human.readObject({ objectId: fixture.ids.compass }),
  ).object;
  requireSuccess(
    fixture.human.saveObject({
      operationKey: '7a:long-project',
      targetId: project.id,
      expectedRevision: project.revision,
      content: {
        ...project.content,
        body:
          '# Project goal\n\nKeep work inspectable.\n\n' +
          'A long authored working note.\n\n'.repeat(120),
        relations: [
          ...project.content.relations,
          {
            id: citedRelation,
            predicate: 'continues_from',
            target: { mode: 'pinned', objectId: k1.id, revision: 1 },
          },
        ],
      },
    }),
  );
  for (let index = 0; index < 22; index++)
    requireSuccess(
      fixture.human.createObject({
        operationKey: `7a:member:${index}`,
        id: uuid(100 + index),
        kind: 'document',
        content: {
          title: `Working evidence ${index + 1}`,
          body: 'Synthetic accumulated material.',
          properties: {},
          relations: [
            {
              id: uuid(200 + index),
              predicate: 'belongs_to',
              target: { mode: 'current', objectId: project.id },
            },
          ],
        },
      }),
    );
  const assetRefs = [];
  for (let index = 0; index < 11; index++) {
    const asset = requireSuccess(
      fixture.human.createObject({
        operationKey: `7a:asset:${index}`,
        id: uuid(300 + index),
        kind: 'asset',
        content: {
          title: `Reusable reference ${index + 1}`,
          body: '',
          properties: {},
          relations: [],
        },
      }),
    ).object;
    assetRefs.push({
      id: uuid(400 + index),
      predicate: 'uses' as const,
      target:
        index === 0
          ? { mode: 'pinned' as const, objectId: asset.id, revision: 1 }
          : { mode: 'current' as const, objectId: asset.id },
    });
  }
  const expandedProject = requireSuccess(fixture.human.readObject({ objectId: project.id })).object;
  requireSuccess(
    fixture.human.saveObject({
      operationKey: '7a:reference-pages',
      targetId: project.id,
      expectedRevision: expandedProject.revision,
      content: {
        ...expandedProject.content,
        relations: [
          ...expandedProject.content.relations,
          ...assetRefs,
          ...Array.from({ length: 11 }, (_, index) => ({
            id: uuid(450 + index),
            predicate: 'continues_from' as const,
            target: { mode: 'current' as const, objectId: uuid(100 + index) },
          })),
        ],
      },
    }),
  );
  const emptyProject = requireSuccess(
    fixture.human.createObject({
      operationKey: '7a:empty',
      id: uuid(500),
      kind: 'project',
      content: { title: 'Empty project', body: '', properties: {}, relations: [] },
    }),
  ).object;
  const issued = requireSuccess(
    fixture.human.createGrant({
      operationKey: '7a:grant',
      spec: {
        label: 'Synthetic evidence client',
        scope: { mode: 'space' },
        capabilities: { read: true, propose: true },
      },
    }),
  );
  const agent = requireSuccess(
    fixture.space.agent({
      grantId: issued.grant.id,
      token: issued.token!,
      instanceId: requireSuccess(fixture.human.status()).instanceId,
    }),
  );
  const proposal = requireSuccess(
    agent.propose({
      operationKey: '7a:pinned-proposal',
      action: 'update',
      targetId: fixture.ids.measurements,
      baseRevision: 1,
      patch: { body: 'A proposal supported by the historical K1.' },
      purpose: 'Inspect stable evidence',
      reason: 'The citation must not move after a human correction.',
      sources: [{ mode: 'pinned', objectId: k1.id, revision: 1 }],
    }),
  );
  return { ...fixture, k1, proposal, emptyProject };
}

async function openProject(native: NativeHarness, fixture: ReturnType<typeof readingFixture>) {
  await native.focus();
  await native.chooseNextFolder(fixture.directory);
  await native.page.getByTestId('open-space').click();
  await native.page.getByTestId('nav-projects').click();
  await native.page.getByTestId(`object-row-${fixture.ids.compass}`).click();
  await native.page.getByTestId('project-overview').waitFor();
}

async function settled(native: NativeHarness) {
  await native.page.waitForFunction(() =>
    document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
  );
}

async function watchBackgroundFocus(native: NativeHarness) {
  await native.page.getByTestId('source-edit-current').evaluate((element) => {
    const button = element as HTMLElement,
      focus = button.focus;
    button.dataset.backgroundFocusAttempts = '0';
    Object.defineProperty(button, 'focus', {
      configurable: true,
      value(options?: FocusOptions) {
        button.dataset.backgroundFocusAttempts = String(
          Number(button.dataset.backgroundFocusAttempts) + 1,
        );
        focus.call(button, options);
      },
    });
  });
}

async function finishFocusFrames(native: NativeHarness) {
  await native.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

async function visibleControl(native: NativeHarness, id: string) {
  const button = native.page.getByTestId(id);
  await button.scrollIntoViewIfNeeded();
  const box = await button.evaluate((element) => {
    const bounds = element.getBoundingClientRect(),
      clip = element.closest('.document-header')?.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
      clipTop: clip?.top ?? 0,
      clipBottom: clip?.bottom ?? window.innerHeight,
    };
  });
  assert.ok(
    box.left >= -1 &&
      box.right <= box.width + 1 &&
      box.top >= Math.max(0, box.clipTop) - 1 &&
      box.bottom <= Math.min(box.height, box.clipBottom) + 1,
    `${id}: ${JSON.stringify(box)}`,
  );
  return { id, ...box };
}

type Fault = {
  saveFailure: boolean;
  draftFailure: boolean;
  readFailure: boolean;
  holdId: string | null;
  held: boolean;
  release: (() => void) | null;
  creates: number;
  holdSave: boolean;
  holdQuery: boolean;
  queryFailure: 'STORAGE_BUSY' | 'CURSOR_STALE' | null;
  queryCursors: string[];
};
type FaultMain = { __projectReadingFault: Fault };
async function installFault(native: NativeHarness) {
  await native.application.evaluate(({ ipcMain }) => {
    const registry = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (
            event: unknown,
            request: {
              input: {
                objectId?: string;
                revision?: number;
                cursor?: string;
                filter?: { projectId?: string };
              };
            },
          ) => Promise<{ ok: boolean }>
        >;
      }
    )._invokeHandlers;
    if (!(registry instanceof Map)) throw new Error('Unsupported trusted IPC test registry');
    const fault: Fault = {
      saveFailure: false,
      draftFailure: false,
      readFailure: false,
      holdId: null,
      held: false,
      release: null,
      creates: 0,
      holdSave: false,
      holdQuery: false,
      queryFailure: null,
      queryCursors: [],
    };
    (globalThis as unknown as FaultMain).__projectReadingFault = fault;
    for (const method of ['readObject', 'saveObject', 'saveDraft', 'createObject', 'query']) {
      const channel = `agentspace:method:${method}`,
        handler = registry.get(channel);
      if (typeof handler !== 'function') throw new Error(`Missing real handler ${method}`);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, request) => {
        if (method === 'createObject') fault.creates++;
        if (method === 'query' && request.input.cursor) {
          fault.queryCursors.push(request.input.cursor);
          if (fault.queryFailure)
            return { ok: false, error: { code: fault.queryFailure, retryable: true } };
        }
        if (
          (method === 'saveObject' && fault.saveFailure) ||
          (method === 'saveDraft' && fault.draftFailure)
        )
          return { ok: false, error: { code: 'STORAGE_BUSY', retryable: true } };
        if (
          method === 'readObject' &&
          request.input.objectId === fault.holdId &&
          request.input.revision === undefined
        ) {
          if (fault.readFailure)
            return { ok: false, error: { code: 'NOT_FOUND', retryable: false } };
          const result = await handler(event, request);
          fault.holdId = null;
          fault.held = true;
          await new Promise<void>((resolve) => {
            fault.release = resolve;
          });
          fault.held = false;
          return result;
        }
        const result = await handler(event, request);
        if (
          result.ok &&
          ((method === 'saveObject' && fault.holdSave) ||
            (method === 'query' && request.input.cursor && fault.holdQuery))
        ) {
          fault.holdSave = false;
          fault.holdQuery = false;
          fault.held = true;
          await new Promise<void>((resolve) => {
            fault.release = resolve;
          });
          fault.held = false;
        }
        return result;
      });
    }
  });
}

test(
  '7A review reader blocks nested references during current opening without an underlying editor',
  { skip: process.platform !== 'darwin', timeout: 30_000 },
  async () => {
    const fixture = readingFixture(),
      native = await launchNative({ entry: root, userData: join(fixture.root, 'Review reader') });
    try {
      await installFault(native);
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      assert.equal(await native.page.getByTestId('document-pane').count(), 0);
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${fixture.proposal.id}`).click();
      const trigger = `proposal-source-${fixture.proposal.id}-0`;
      await native.page.locator(`[id="${trigger}"]`).click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').waitFor();
      await native.application.evaluate((_electron, id) => {
        (globalThis as unknown as FaultMain).__projectReadingFault.holdId = id;
      }, fixture.k1.id);
      await reader.getByTestId('source-edit-current').click();
      await waitHeld(native);
      await reader.locator('.metadata .reference button').first().click();
      assert.equal(await native.page.getByTestId('source-reader').count(), 1);
      assert.equal(await reader.locator('header h1').innerText(), fixture.k1.content.title);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page
        .getByTestId('editor-transition')
        .getByRole('button', { name: t(locale, 'common.cancel'), exact: true })
        .click();
      await releaseFault(native);
      assert.equal(await native.page.getByTestId('document-pane').count(), 0);
      await reader.getByTestId('source-back').click();
      await native.page.getByTestId('proposal-review').waitFor();
      await native.page.waitForFunction((id) => document.activeElement?.id === id, trigger);
      assert.equal(await native.page.getByTestId('return-to-reading').count(), 0);
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await releaseFault(native).catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A delayed save and reading return preserve later input instead of reinstalling an older body',
  { skip: process.platform !== 'darwin', timeout: 30_000 },
  async () => {
    const fixture = readingFixture(),
      native = await launchNative({
        entry: root,
        userData: join(fixture.root, 'Delayed save reading'),
      });
    try {
      await installFault(native);
      await openProject(native, fixture);
      await native.page.getByTestId(`project-ref-${citedRelation}`).click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.holdSave = true;
      });
      await input.fill('Committed K3 with a delayed reply.');
      await native.page.getByTestId('save-now').click();
      await waitHeld(native);
      await input.fill('Later K4 input must survive the old K3 reply.');
      await native.page.getByTestId('return-to-reading').click();
      await reader.getByTestId('source-edit-current').click();
      await native.page.getByTestId('editor-transition').waitFor();
      await releaseFault(native);
      await input.waitFor();
      await settled(native);
      assert.equal(await input.textContent(), 'Later K4 input must survive the old K3 reply.');
      const current = requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object;
      assert.equal(current.revision, 4);
      assert.equal(current.content.body, 'Later K4 input must survive the old K3 reply.');
      assert.deepEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id, revision: 1 })).object,
        fixture.k1,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await releaseFault(native).catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A a failed handoff retains the original human draft and restores it through the reading checkpoint',
  { skip: process.platform !== 'darwin', timeout: 45_000 },
  async () => {
    const fixture = readingFixture();
    let native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Failed handoff'),
    });
    try {
      await installFault(native);
      await openProject(native, fixture);
      await native.application.evaluate(() => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.saveFailure = true;
        fault.draftFailure = true;
      });
      await native.page.getByTestId('project-edit').click();
      const input = native.page.getByTestId('markdown-input'),
        draft = 'Earlier project writing must remain available after every failure.';
      await input.fill(draft);
      await native.page.getByTestId('project-overview-button').click();
      await native.page.getByTestId(`project-ref-${citedRelation}`).click();
      const reader = native.page.getByTestId('source-reader');
      await watchBackgroundFocus(native);
      await reader.getByTestId('source-edit-current').click();
      const dialog = native.page.getByTestId('leave-dialog');
      await dialog.waitFor();
      await finishFocusFrames(native);
      const rescueFocus = await dialog.evaluate((element) => ({
        modal: element.matches(':modal'),
        focusInside: element.contains(document.activeElement),
        focusedText: document.activeElement?.textContent,
      }));
      assert.equal(rescueFocus.modal, true);
      assert.equal(rescueFocus.focusInside, true);
      const rescueAttempts = await reader
        .getByTestId('source-edit-current')
        .getAttribute('data-background-focus-attempts');
      writeFileSync(
        join(root, '.coordination/7A-focus-rescue-observation.json'),
        JSON.stringify(
          {
            ...rescueFocus,
            backgroundFocusAttempts: Number(rescueAttempts),
            sourceChangedForFocus: false,
          },
          null,
          2,
        ) + '\n',
      );
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await dialog.getByRole('button', { name: t(locale, 'ui.keepWorking'), exact: true }).click();
      await reader.getByTestId('source-back').click();
      await native.page.getByTestId('project-edit').click();
      assert.equal(await input.textContent(), draft);
      await native.page.getByTestId('project-overview-button').click();
      await native.page.getByTestId(`project-ref-${citedRelation}`).click();
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.draftFailure = false;
      });
      await reader.getByTestId('source-edit-current').click();
      await input.waitFor();
      assert.equal(await input.textContent(), k2Body);
      await native.page.waitForFunction(
        () => document.activeElement?.getAttribute('data-testid') === 'markdown-input',
      );
      await native.page.getByTestId('return-to-reading').click();
      await reader.getByTestId('source-back').click();
      await native.page.getByTestId('project-overview').waitFor();
      await native.page.getByTestId('project-section-assets').scrollIntoViewIfNeeded();
      assert.ok(
        (await native.page.getByTestId('project-goal-excerpt').innerText()).includes(draft),
      );
      await native.page.getByTestId('project-edit').click();
      assert.equal(await input.textContent(), draft);
      assert.equal(
        await native.page.getByTestId('save-state').innerText(),
        t(locale, 'editor.unsaved'),
      );
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const receipts = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.listDrafts(request),
          bound(session, { limit: 50 }),
        ),
      ).items;
      const receipt = receipts.find(
        (item) =>
          item.target.state === 'existing' &&
          item.target.objectId === fixture.ids.compass &&
          item.retained,
      );
      assert.ok(receipt);
      assert.equal(
        requireSuccess(
          await native.page.evaluate(
            (request) => window.agentSpace.readDraft(request),
            bound(session, { draftId: receipt.draftId }),
          ),
        ).content.body,
        draft,
      );
      assert.notEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.compass })).object.content
          .body,
        draft,
      );
      assert.deepEqual(native.pageErrors, []);
      await native.close();
      native = await launchNative({ entry: root, userData: join(fixture.root, 'Failed handoff') });
      await native.focus();
      await native.page.getByTestId('workbench').waitFor();
      await native.page.locator('.draft-list button').first().click();
      await native.page.getByTestId('project-edit').click();
      const resumed = native.page.getByTestId('markdown-input');
      await resumed.waitFor();
      assert.equal(await resumed.textContent(), draft);
      assert.notEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.compass })).object.content
          .body,
        draft,
      );
      await native.page.getByTestId('save-now').click();
      await settled(native);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.compass })).object.content
          .body,
        draft,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.application
        .evaluate(() => {
          const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
          fault.saveFailure = false;
          fault.draftFailure = false;
        })
        .catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A pagination retry and a later writing route invalidate a waiting reading-position restoration',
  { skip: process.platform !== 'darwin', timeout: 45_000 },
  async () => {
    const fixture = readingFixture(),
      native = await launchNative({
        entry: root,
        userData: join(fixture.root, 'Pagination return'),
      });
    try {
      await installFault(native);
      await openProject(native, fixture);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      const material = native.page.getByTestId('project-material');
      await native.page.getByTestId('project-section-material').click();
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.queryFailure = 'STORAGE_BUSY';
      });
      await material
        .getByRole('button', { name: t(locale, 'context.nextPage'), exact: true })
        .click();
      await material.getByText(t(locale, 'error.STORAGE_BUSY'), { exact: true }).waitFor();
      assert.equal(await material.locator('.linked-material-row').count(), 20);
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.queryFailure = null;
      });
      await material.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="project-material"] .linked-material-row')
            .length === 25,
      );
      const cursors = await native.application.evaluate(
        () => (globalThis as unknown as FaultMain).__projectReadingFault.queryCursors,
      );
      assert.equal(cursors[0], cursors[1]);
      await native.page.getByTestId('nav-projects').click();
      await native.page.getByTestId(`object-row-${fixture.ids.compass}`).click();
      await material.locator('.linked-material-row').first().waitFor();
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.queryFailure = 'CURSOR_STALE';
      });
      await material
        .getByRole('button', { name: t(locale, 'context.nextPage'), exact: true })
        .click();
      await material.getByText(t(locale, 'error.CURSOR_STALE'), { exact: true }).waitFor();
      assert.equal(await material.locator('.linked-material-row').count(), 20);
      assert.equal(
        await material
          .getByRole('button', { name: t(locale, 'context.nextPage'), exact: true })
          .count(),
        0,
      );
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.queryFailure = null;
      });
      await material.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await material
        .getByRole('button', { name: t(locale, 'context.nextPage'), exact: true })
        .click();
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="project-material"] .linked-material-row')
            .length === 25,
      );
      const last = native.page.locator(`[id="linked-${fixture.ids.compass}-${uuid(121)}"]`);
      await last.click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').click();
      await native.page.getByTestId('markdown-input').waitFor();
      await native.page.getByTestId('return-to-reading').click();
      await native.application.evaluate(() => {
        (globalThis as unknown as FaultMain).__projectReadingFault.holdQuery = true;
      });
      await reader.getByTestId('source-back').click();
      await native.page.getByTestId('project-overview').waitFor();
      await waitHeld(native);
      await native.page.getByTestId('project-edit').click();
      const input = native.page.getByTestId('markdown-input'),
        later = 'Further human writing. '.repeat(150);
      await input.fill(later);
      await native.page.getByTestId('save-now').click();
      await settled(native);
      await input.focus();
      await native.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
          ),
      );
      await native.page.locator('#document-scroll').evaluate((element) => {
        element.scrollTop = 0;
      });
      const position = await native.page
        .locator('#document-scroll')
        .evaluate((element) => element.scrollTop);
      assert.equal(position, 0);
      // The person deliberately returned to the writing surface's top.
      // CodeMirror can measure its viewport; a late route cannot move it away.
      await native.page.locator('#document-scroll').evaluate((element) => {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
        const node = element as HTMLElement;
        node.dataset.restorationWrites = '[]';
        Object.defineProperty(element, 'scrollTop', {
          configurable: true,
          get() {
            return descriptor.get!.call(element) as number;
          },
          set(value: number) {
            const writes = JSON.parse(node.dataset.restorationWrites!) as number[];
            writes.push(value);
            node.dataset.restorationWrites = JSON.stringify(writes);
            descriptor.set!.call(element, value);
          },
        });
      });
      await releaseFault(native);
      await delay(1700);
      assert.equal(await input.evaluate((element) => document.activeElement === element), true);
      assert.deepEqual(
        await native.page
          .locator('#document-scroll')
          .evaluate((element) =>
            (JSON.parse((element as HTMLElement).dataset.restorationWrites!) as number[]).filter(
              (value) => value !== 0,
            ),
          ),
        [],
      );
      assert.equal(
        await native.page.locator('#document-scroll').evaluate((element) => element.scrollTop),
        0,
      );
      assert.equal(await input.textContent(), later);
      await settled(native);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.compass })).object.content
          .body,
        later,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await releaseFault(native).catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A archived current originals and missing replies preserve the historical reader and version labels',
  { skip: process.platform !== 'darwin', timeout: 30_000 },
  async () => {
    const fixture = readingFixture();
    for (const objectId of [fixture.k1.id, fixture.ids.repository, uuid(300), uuid(301)]) {
      const current = requireSuccess(fixture.human.readObject({ objectId })).object;
      requireSuccess(
        fixture.human.setLifecycle({
          operationKey: `7a:archive:${objectId}`,
          objectId,
          expectedRevision: current.revision,
          lifecycle: 'archived',
        }),
      );
    }
    const project = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.compass }),
    ).object;
    requireSuccess(
      fixture.human.saveObject({
        operationKey: '7a:archive-pin',
        targetId: project.id,
        expectedRevision: project.revision,
        content: {
          ...project.content,
          relations: project.content.relations.map((relation) =>
            relation.id === uuid(401) && relation.predicate === 'uses'
              ? {
                  ...relation,
                  target: { mode: 'pinned' as const, objectId: uuid(301), revision: 2 },
                }
              : relation,
          ),
        },
      }),
    );
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Archived original'),
    });
    try {
      await installFault(native);
      await openProject(native, fixture);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page
        .getByTestId('project-assets')
        .getByText(t(locale, 'ui.archived'), { exact: true })
        .waitFor();
      const assets = native.page.getByTestId('project-assets');
      const historicalActive = assets.getByTestId(`project-ref-${uuid(400)}`).locator('..');
      await historicalActive.getByText('Reusable reference 1', { exact: true }).waitFor();
      assert.equal(
        await historicalActive
          .getByText(t(locale, 'project.archivedAtVersion'), { exact: true })
          .count(),
        0,
      );
      await assets
        .getByTestId(`project-ref-${uuid(401)}`)
        .locator('..')
        .getByText(t(locale, 'project.archivedAtVersion'), { exact: true })
        .waitFor();
      await native.application.evaluate((_electron, objectId) => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.holdId = objectId;
        fault.readFailure = true;
      }, uuid(302));
      await assets
        .getByRole('button', { name: t(locale, 'project.moreReferences'), exact: true })
        .click();
      const gap = assets.getByTestId(`project-ref-${uuid(402)}`).locator('..');
      await gap.getByText(t(locale, 'error.NOT_FOUND'), { exact: true }).waitFor();
      await native.application.evaluate(() => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.readFailure = false;
        fault.holdId = null;
      });
      await gap.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await gap.getByText('Reusable reference 3', { exact: true }).waitFor();
      await native.page.getByTestId(`project-ref-${citedRelation}`).click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').click();
      await reader.getByText(t(locale, 'source.currentArchived'), { exact: true }).waitFor();
      assert.ok((await reader.innerText()).includes('Retry transient failures.'));
      assert.equal(await native.page.getByTestId('return-to-reading').count(), 0);
      const current = requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object;
      requireSuccess(
        fixture.human.setLifecycle({
          operationKey: '7a:unarchive',
          objectId: current.id,
          expectedRevision: current.revision,
          lifecycle: 'active',
        }),
      );
      await native.application.evaluate((_electron, objectId) => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.holdId = objectId;
        fault.readFailure = true;
      }, fixture.k1.id);
      await reader.getByTestId('source-edit-current').click();
      await reader.getByText(t(locale, 'error.NOT_FOUND'), { exact: true }).waitFor();
      assert.ok((await reader.innerText()).includes('Retry transient failures.'));
      await native.application.evaluate(() => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.readFailure = false;
        fault.holdId = null;
      });
      await reader.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      assert.equal(await input.textContent(), k2Body);
      assert.equal(
        await native.application.evaluate(
          () => (globalThis as unknown as FaultMain).__projectReadingFault.creates,
        ),
        0,
      );
      assert.deepEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id, revision: 1 })).object,
        fixture.k1,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await releaseFault(native).catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A five locales expose project and original-edit controls at 980px and enlarged native text',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const fixture = readingFixture(),
      native = await launchNative({ entry: root, userData: join(fixture.root, 'Project locales') });
    const evidence = join(root, '.coordination/screenshots/7A/locales'),
      results = [];
    mkdirSync(evidence, { recursive: true });
    try {
      await openProject(native, fixture);
      await native.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 980, height: 850 }),
      );
      for (const locale of supportedLocales)
        for (const scale of [1, 1.5, 2] as const) {
          await native.page.getByTestId('settings-button').click();
          await native.page.getByTestId('locale-select').selectOption(locale);
          await native.page.getByTestId('text-scale-select').selectOption(String(scale));
          await native.page.waitForFunction(
            ({ expectedLocale, expectedScale }) =>
              document.documentElement.lang === expectedLocale &&
              document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
                expectedScale,
            { expectedLocale: locale, expectedScale: String(scale) },
          );
          await native.page.keyboard.press('Escape');
          const controls = [];
          for (const id of ['project-edit', 'project-section-material', 'project-section-assets'])
            controls.push(await visibleControl(native, id));
          await native.page.getByTestId(`project-ref-${citedRelation}`).click();
          const reader = native.page.getByTestId('source-reader'),
            edit = reader.getByTestId('source-edit-current');
          await edit.waitFor();
          assert.equal(await edit.innerText(), t(locale, 'source.editCurrent'));
          controls.push(await visibleControl(native, 'source-edit-current'));
          await edit.focus();
          await native.page.keyboard.press('Enter');
          const input = native.page.getByTestId('markdown-input');
          await input.waitFor();
          assert.equal(await input.textContent(), k2Body);
          await native.page.waitForFunction(
            () => document.activeElement?.getAttribute('data-testid') === 'markdown-input',
          );
          const back = native.page.getByTestId('return-to-reading');
          controls.push(await visibleControl(native, 'return-to-reading'));
          await back.focus();
          await native.page.keyboard.press('Enter');
          await reader.waitFor();
          await native.page.waitForFunction(
            () => document.activeElement?.getAttribute('data-testid') === 'source-edit-current',
          );
          await reader.getByTestId('source-back').focus();
          await native.page.keyboard.press('Enter');
          await native.page.getByTestId('project-overview').waitFor();
          controls.push(await visibleControl(native, 'project-section-assets'));
          const overflow = await native.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 1, `${locale}/${scale}: overflow ${overflow}`);
          // Native capture must follow the header's scroll paint, not the previous frame.
          await native.page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          const capture = await native.application.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]!,
              image = await window.capturePage();
            return {
              png: image.toPNG().toString('base64'),
              size: image.getSize(),
              contentBounds: window.getContentBounds(),
              zoom: window.webContents.getZoomFactor(),
            };
          });
          assert.equal(capture.zoom, scale);
          writeFileSync(
            join(evidence, `${locale}-${scale}x.png`),
            Buffer.from(capture.png, 'base64'),
          );
          results.push({
            locale,
            scale,
            overflow,
            size: capture.size,
            contentBounds: capture.contentBounds,
            zoom: capture.zoom,
            controls,
            keyboardOriginalEditAndReturn: true,
          });
        }
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object.content.body,
        k2Body,
      );
      assert.deepEqual(native.pageErrors, []);
      writeFileSync(
        join(root, '.coordination/verification-7A-locales.json'),
        JSON.stringify(
          { fixture: 'synthetic', sourceMode: 'development build', results },
          null,
          2,
        ) + '\n',
      );
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);

async function waitHeld(native: NativeHarness) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      await native.application.evaluate(
        () => (globalThis as unknown as FaultMain).__projectReadingFault.held,
      )
    )
      return;
    await delay(20);
  }
  assert.fail('The intended real IPC result was not held.');
}

async function releaseFault(native: NativeHarness) {
  await native.application.evaluate(() => {
    const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
    fault.release?.();
    fault.release = null;
  });
}

test(
  '7A project overview exposes accumulation and edits K1 through current K2 into the same K3',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = readingFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Project reading'),
    });
    const original = readFileSync(join(fixture.originals, 'knowledge', 'Retry policy.md'));
    const grantsBefore = requireSuccess(fixture.human.listGrants());
    const sharedAssetBefore = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.repository }),
    ).object;
    try {
      await installFault(native);
      await native.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1380, height: 900 }),
      );
      const nativeWindow = await native.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        return {
          bounds: window.getBounds(),
          contentBounds: window.getContentBounds(),
          zoomFactor: window.webContents.getZoomFactor(),
        };
      });
      await openProject(native, fixture);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      const overview = native.page.getByTestId('project-overview');
      assert.equal(await native.page.getByTestId('markdown-input').isVisible(), false);
      assert.ok(
        Array.from(await overview.getByTestId('project-goal-excerpt').innerText()).length <= 281,
      );
      for (const target of [
        'project-section-continuation',
        'project-section-assets',
        'project-section-material',
      ])
        assert.equal(await native.page.getByTestId(target).isVisible(), true);
      const positions = await native.page.evaluate(() => ({
        assets: document.querySelector('[data-testid="project-assets"]')!.getBoundingClientRect()
          .top,
        material: document
          .querySelector('[data-testid="project-material"]')!
          .getBoundingClientRect().top,
        viewport: window.innerHeight,
      }));
      assert.ok(positions.assets < positions.material);
      assert.ok(
        positions.material < positions.viewport,
        'Accumulation starts in the default window without scrolling the full body.',
      );
      const evidence = join(root, '.coordination/screenshots/7A');
      mkdirSync(evidence, { recursive: true });
      const initialPng = await native.application.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
      );
      writeFileSync(
        join(evidence, 'project-overview-default.png'),
        Buffer.from(initialPng, 'base64'),
      );
      const trigger = native.page.getByTestId(`project-ref-${citedRelation}`);
      await trigger.click();
      const reader = native.page.getByTestId('source-reader');
      await reader
        .locator('header')
        .getByText(t(locale, 'source.version', { version: 1 }), { exact: true })
        .first()
        .waitFor();
      assert.ok((await reader.innerText()).includes('Retry transient failures.'));
      const countBefore = requireSuccess(
        fixture.human.query({ filter: {}, limit: 50, maxBytes: 65536 }),
      ).items.length;
      await reader.getByTestId('source-edit-current').click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      assert.equal(await input.textContent(), k2Body);
      await input.fill('Human K3 correction from a historical citation.');
      await native.page.getByTestId('save-now').click();
      await settled(native);
      const saved = requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object;
      assert.equal(saved.revision, 3);
      assert.equal(saved.content.body, 'Human K3 correction from a historical citation.');
      assert.deepEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id, revision: 1 })).object,
        fixture.k1,
      );
      assert.equal(
        requireSuccess(fixture.human.query({ filter: {}, limit: 50, maxBytes: 65536 })).items
          .length,
        countBefore,
      );
      assert.equal(
        await native.application.evaluate(
          () => (globalThis as unknown as FaultMain).__projectReadingFault.creates,
        ),
        0,
      );
      await native.page.getByTestId('return-to-reading').click();
      await reader.waitFor();
      assert.ok((await reader.innerText()).includes('Retry transient failures.'));
      await native.page.waitForFunction(
        () => document.activeElement?.getAttribute('data-testid') === 'source-edit-current',
      );
      await reader.getByTestId('source-back').click();
      await overview.waitFor();
      await native.page
        .waitForFunction((id) => document.activeElement?.id === id, `project-ref-${citedRelation}`)
        .catch(async () =>
          assert.fail(
            JSON.stringify(
              await native.page.evaluate(() => ({
                active: document.activeElement?.id || document.activeElement?.tagName,
                editorId: document
                  .querySelector('[data-testid="document-pane"]')
                  ?.getAttribute('data-editor-id'),
                triggers: [...document.querySelectorAll('[data-testid^="project-ref-"]')].map(
                  (element) => ({ id: element.id, visible: element.getClientRects().length > 0 }),
                ),
              })),
            ),
          ),
        );
      await native.page.getByTestId('project-section-material').click();
      const material = native.page.getByTestId('project-material');
      assert.equal(await material.locator('.linked-material-row').count(), 20);
      await material
        .getByRole('button', { name: t(locale, 'context.nextPage'), exact: true })
        .click();
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="project-material"] .linked-material-row')
            .length === 25,
      );
      assert.deepEqual(
        requireSuccess(fixture.human.getProposal({ proposalId: fixture.proposal.id })).proposal
          .payload.sources,
        [{ mode: 'pinned', objectId: fixture.k1.id, revision: 1 }],
      );
      const assets = native.page.getByTestId('project-assets');
      assert.equal(await assets.locator('.project-reference-row').count(), 3);
      await assets
        .getByRole('button', { name: t(locale, 'project.moreReferences'), exact: true })
        .click();
      assert.equal(await assets.locator('.project-reference-row').count(), 10);
      await assets
        .getByRole('button', { name: t(locale, 'project.moreReferences'), exact: true })
        .click();
      assert.equal(await assets.locator('.project-reference-row').count(), 12);
      const lastAssetTrigger = `project-ref-${uuid(410)}`;
      await assets.getByTestId(lastAssetTrigger).click();
      await reader.getByTestId('source-edit-current').click();
      await input.waitFor();
      await native.page.getByTestId('return-to-reading').click();
      await reader.getByTestId('source-back').click();
      await overview.waitFor();
      await native.page.waitForFunction(
        (id) => document.activeElement?.id === id,
        lastAssetTrigger,
      );
      assert.equal(await assets.locator('.project-reference-row').count(), 12);
      assert.deepEqual(
        readFileSync(join(fixture.originals, 'knowledge', 'Retry policy.md')),
        original,
      );
      await native.page.getByTestId('project-section-assets').click();
      const png = await native.application.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
      );
      writeFileSync(join(evidence, 'project-overview.png'), Buffer.from(png, 'base64'));
      await native.page.getByTestId('nav-projects').click();
      await native.page.getByTestId(`object-row-${fixture.emptyProject.id}`).click();
      await native.page.getByTestId('project-edit-goal').click();
      await input.fill('An explicit goal for an empty project.');
      await native.page.getByTestId('save-now').click();
      await settled(native);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.emptyProject.id })).object
          .content.body,
        'An explicit goal for an empty project.',
      );
      assert.deepEqual(requireSuccess(fixture.human.listGrants()), grantsBefore);
      assert.deepEqual(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.repository })).object,
        sharedAssetBefore,
      );
      writeFileSync(
        join(root, '.coordination/verification-7A-project.json'),
        JSON.stringify(
          {
            fixture: 'synthetic',
            sourceMode: process.env.AGENTSPACE_TEST_EXECUTABLE
              ? 'packaged executable'
              : 'development build',
            requestedWindow: { width: 1380, height: 900 },
            nativeWindow,
            initialLayoutCss: positions,
            originalObjectId: fixture.k1.id,
            k1Digest: fixture.k1.digest,
            savedRevision: saved.revision,
            savedDigest: saved.digest,
            sameObjectId: saved.id === fixture.k1.id,
            k1Unchanged: true,
            proposalPinUnchanged: true,
            externalOriginalUnchanged: true,
            grantsUnchanged: true,
            sharedAssetUnchanged: true,
            loadedMaterial: 25,
            directAssetReferences: 12,
            expandedReferenceReturnFocused: true,
          },
          null,
          2,
        ) + '\n',
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7A same-object human draft survives editing current and a cancelled late reply',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = readingFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Same object draft'),
    });
    try {
      await installFault(native);
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId(`object-row-${fixture.k1.id}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const editorId = await native.page
        .getByTestId('document-pane')
        .getAttribute('data-editor-id');
      assert.ok(editorId);
      const humanDraft = 'A complete earlier human draft must stay in this editor.';
      await input.fill(humanDraft);
      const k2 = requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object;
      requireSuccess(
        fixture.human.saveObject({
          operationKey: '7a:remote-K3',
          targetId: k2.id,
          expectedRevision: k2.revision,
          content: { ...k2.content, body: 'Another writer current K3.' },
        }),
      );
      await native.page.locator('#details-button').click();
      await native.page.locator(`[id$="-${selfSource}"]`).click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').click();
      await input.waitFor();
      assert.equal(
        await native.page.getByTestId('document-pane').getAttribute('data-editor-id'),
        editorId,
      );
      assert.equal(await input.textContent(), humanDraft);
      const localeAtConflict = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page
        .getByTestId('document-pane')
        .getByText(t(localeAtConflict, 'error.STALE_REVISION'), { exact: true })
        .waitFor();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.k1.id })).object.content.body,
        'Another writer current K3.',
      );
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const drafts = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.listDrafts(request),
          bound(session, { limit: 50 }),
        ),
      ).items;
      const receipt = drafts.find(
        (item) =>
          item.retained &&
          item.target.state === 'existing' &&
          item.target.objectId === fixture.k1.id,
      );
      assert.ok(receipt);
      assert.equal(
        requireSuccess(
          await native.page.evaluate(
            (request) => window.agentSpace.readDraft(request),
            bound(session, { draftId: receipt.draftId }),
          ),
        ).content.body,
        humanDraft,
      );
      await native.page.getByTestId('return-to-reading').click();
      await native.application.evaluate((_electron, objectId) => {
        (globalThis as unknown as FaultMain).__projectReadingFault.holdId = objectId;
      }, fixture.k1.id);
      await reader.getByTestId('source-edit-current').click();
      await native.page.waitForFunction(
        () => document.querySelector('[data-testid="editor-transition"]') !== null,
      );
      let held = false;
      for (let attempt = 0; attempt < 100 && !held; attempt++) {
        held = await native.application.evaluate(
          () => (globalThis as unknown as FaultMain).__projectReadingFault.held,
        );
        if (!held) await delay(20);
      }
      assert.equal(held, true);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page
        .getByTestId('editor-transition')
        .getByRole('button', { name: t(locale, 'common.cancel'), exact: true })
        .click();
      await reader.waitFor();
      await native.page.getByTestId('settings-button').click();
      const settings = native.page.getByTestId('settings-dialog');
      await settings.waitFor();
      const settingControl = settings.getByTestId('text-scale-select');
      await settingControl.focus();
      assert.equal(
        await settingControl.evaluate((element) => document.activeElement === element),
        true,
      );
      await watchBackgroundFocus(native);
      await releaseFault(native);
      await delay(100);
      await finishFocusFrames(native);
      const settingsFocus = await settingControl.evaluate((element) => ({
        sameControlFocused: document.activeElement === element,
        modal: element.closest('dialog')?.matches(':modal'),
        controlTestId: element.getAttribute('data-testid'),
      }));
      assert.equal(settingsFocus.modal, true);
      assert.equal(settingsFocus.sameControlFocused, true);
      const settingsAttempts = await reader
        .getByTestId('source-edit-current')
        .getAttribute('data-background-focus-attempts');
      writeFileSync(
        join(root, '.coordination/7A-focus-settings-observation.json'),
        JSON.stringify(
          {
            ...settingsFocus,
            backgroundFocusAttempts: Number(settingsAttempts),
            sourceChangedForFocus: false,
          },
          null,
          2,
        ) + '\n',
      );
      await native.page.keyboard.press('Escape');
      await reader.getByTestId('source-back').click();
      await input.waitFor();
      await input.fill('Later input after cancellation.');
      await native.application.evaluate(() => {
        const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
        fault.release?.();
        fault.release = null;
      });
      await delay(100);
      assert.equal(await input.textContent(), 'Later input after cancellation.');
      assert.equal(
        await native.page.getByTestId('document-pane').getAttribute('data-editor-id'),
        editorId,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.application
        .evaluate(() => {
          const fault = (globalThis as unknown as FaultMain).__projectReadingFault;
          fault.release?.();
          fault.saveFailure = false;
          fault.draftFailure = false;
        })
        .catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);
