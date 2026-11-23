import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { Locator } from 'playwright-core';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { AgentLaunchConfiguration } from '../../src/contracts/app.js';
import type { ReadPage } from '../../src/contracts/schema.js';
import type { Result } from '../../src/contracts/errors.js';
import { Space } from '../../src/core/index.js';
import { supportedLocales, t } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.AGENTSPACE_7D_RUN ?? 'latest';
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('Invalid native evidence directory.');
const out = join(root, '.coordination/7D/native-context-setup', run);
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'start-source.json'),
  JSON.stringify(
    Object.fromEntries(
      [
        'dist/desktop/main.cjs',
        'dist/desktop/preload.cjs',
        'dist/renderer/main.js',
        'dist/renderer/main.css',
        'src/renderer/Workbench.tsx',
        'src/renderer/components/ContextPreparation.tsx',
        'src/renderer/components/AgentAccess.tsx',
      ].map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(join(root, path)))
          .digest('hex'),
      ]),
    ),
    null,
    2,
  ),
);
const uuid = (value: number) => `7d000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const longTitle = '資料'.repeat(120);
const pinKey = (id: string, revision = 1) => `${id}:${revision}`;

function contextFixture() {
  const f = createAcceptanceFixture();
  const assets = Array.from(
    { length: 24 },
    (_, index) =>
      ok(
        f.human.createObject({
          operationKey: `context:asset:${index}`,
          id: uuid(8000 + index),
          kind: 'asset',
          content: {
            title: `Selected asset ${index}`,
            body: `Original asset ${index}`,
            properties: {},
            relations: [],
          },
        }),
      ).object,
  );
  const first = assets[0]!;
  const assetK2 = ok(
    f.human.saveObject({
      operationKey: 'context:asset-k2',
      targetId: first.id,
      expectedRevision: 1,
      content: { ...first.content, title: 'Selected asset current K2', body: 'Later asset body' },
    }),
  ).object;
  const project = ok(
    f.human.createObject({
      operationKey: 'context:project-k1',
      id: uuid(100),
      kind: 'project',
      content: {
        title: 'Context project K1',
        body: 'Original project goal. ' + '目標😀'.repeat(150),
        properties: {},
        relations: [
          ...assets.map((asset, index) => ({
            id: uuid(4000 + index),
            predicate: 'uses' as const,
            target: { mode: 'current' as const, objectId: asset.id },
          })),
          {
            id: uuid(4999),
            predicate: 'source',
            target: { mode: 'pinned', objectId: first.id, revision: 1 },
          },
        ],
      },
    }),
  ).object;
  const projectK2 = ok(
    f.human.saveObject({
      operationKey: 'context:project-k2',
      targetId: project.id,
      expectedRevision: 1,
      content: {
        ...project.content,
        title: 'Context project current K2',
        body: 'Current project goal after K1.',
      },
    }),
  ).object;
  const members = Array.from(
    { length: 23 },
    (_, index) =>
      ok(
        f.human.createObject({
          operationKey: `context:member:${index}`,
          id: uuid(300 + index),
          kind: 'document',
          content: {
            title: `Current project member ${index}`,
            body: `Current member ${index}`,
            properties: {},
            relations: [
              {
                id: uuid(500 + index),
                predicate: 'belongs_to',
                target: { mode: 'current', objectId: project.id },
              },
            ],
          },
        }),
      ).object,
  );
  for (let index = 0; index < 55; index++)
    ok(
      f.human.createObject({
        operationKey: `context:directory:${index}`,
        id: uuid(5000 + index),
        kind: 'document',
        content: { title: `Directory material ${index}`, body: '', properties: {}, relations: [] },
      }),
    );
  const long = ok(
    f.human.createObject({
      operationKey: 'context:long',
      id: uuid(9500),
      kind: 'document',
      content: { title: longTitle, body: 'A saved synthetic note.', properties: {}, relations: [] },
    }),
  ).object;
  return { ...f, project, projectK2, assets, assetK2, members, long };
}

async function openSpace(n: NativeHarness, directory: string) {
  await n.focus();
  await n.chooseNextFolder(directory);
  await n.page.getByTestId('open-space').click();
  await n.page.getByTestId('workbench').waitFor();
  await n.page.getByTestId('settings-button').click();
  await n.page.getByTestId('locale-select').selectOption('en');
  await n.page.getByTestId('text-scale-select').selectOption('1');
  await n.page.keyboard.press('Escape');
}
async function clipboard(n: NativeHarness) {
  return n.application.evaluate(({ clipboard }) => clipboard.readText());
}
async function capture(n: NativeHarness, name: string) {
  mkdirSync(out, { recursive: true });
  const png = await n.application.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'),
  );
  writeFileSync(join(out, `${name}.png`), Buffer.from(png, 'base64'));
}
async function tabTo(n: NativeHarness, target: Locator) {
  for (let tabs = 0; tabs < 100; tabs++) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await n.page.keyboard.press('Tab');
  }
  assert.fail('Natural Tab did not reach the expected control.');
}
async function completeLabel(target: Locator, associatedLabel = true) {
  return target.evaluate((element, useLabel) => {
    const input = element as HTMLElement,
      label = useLabel ? input.closest('label')! : input,
      rect = label.getBoundingClientRect(),
      control = input.getBoundingClientRect(),
      clip = { top: 0, bottom: innerHeight, left: 0, right: innerWidth },
      chain = [];
    for (let parent: HTMLElement | null = label; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, box.top + (parseFloat(style.borderTopWidth) || 0));
        clip.bottom = Math.min(
          clip.bottom,
          box.bottom - (parseFloat(style.borderBottomWidth) || 0),
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, box.left + (parseFloat(style.borderLeftWidth) || 0));
        clip.right = Math.min(clip.right, box.right - (parseFloat(style.borderRightWidth) || 0));
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY + style.overflowX))
        chain.push({
          tag: parent.tagName,
          className: parent.className,
          rect: box.toJSON(),
          scrollTop: parent.scrollTop,
          scrollHeight: parent.scrollHeight,
          clientHeight: parent.clientHeight,
        });
    }
    const glyphs: DOMRect[] = [],
      walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    while (walker.nextNode())
      if (walker.currentNode.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        glyphs.push(...range.getClientRects());
      }
    const style = getComputedStyle(input),
      outset = Math.max(
        0,
        (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
      );
    return {
      focused: document.activeElement === input,
      titleCodepoints: Array.from(label.textContent!.trim()).length,
      label: rect.toJSON(),
      input: control.toJSON(),
      glyphs: glyphs.map((box) => box.toJSON()),
      clip,
      chain,
      outset,
      complete:
        rect.top >= clip.top - 0.5 &&
        rect.bottom <= clip.bottom + 0.5 &&
        rect.left >= clip.left - 0.5 &&
        rect.right <= clip.right + 0.5,
      glyphsComplete: glyphs.every(
        (box) =>
          box.top >= clip.top - 0.5 &&
          box.bottom <= clip.bottom + 0.5 &&
          box.left >= clip.left - 0.5 &&
          box.right <= clip.right + 0.5,
      ),
      paint:
        control.top - outset >= clip.top - 0.5 &&
        control.bottom + outset <= clip.bottom + 0.5 &&
        control.left - outset >= clip.left - 0.5 &&
        control.right + outset <= clip.right + 0.5,
      center:
        document.elementFromPoint(
          control.left + control.width / 2,
          control.top + control.height / 2,
        ) === input,
    };
  }, associatedLabel);
}
async function connect(
  launch: Pick<AgentLaunchConfiguration, 'command' | 'args' | 'env'>,
  profile: string,
) {
  const client = new Client(
    { name: '7D synthetic configured client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(
    new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: { ...getDefaultEnvironment(), ...launch.env, AGENTSPACE_USER_DATA: profile },
      stderr: 'pipe',
    }),
  );
  return client;
}
async function read(client: Client, id: string, revision?: number) {
  const response = await client.callTool({
    name: 'object_read',
    arguments: {
      ref:
        revision === undefined
          ? { mode: 'current', objectId: id }
          : { mode: 'pinned', objectId: id, revision },
      section: 'body',
      maxBytes: 4096,
    },
  });
  return response.structuredContent as unknown as Result<ReadPage>;
}

type FaultPlan = {
  id: string;
  method: string;
  hold?: boolean;
  drop?: boolean;
  objectId?: string;
  revision?: number;
  limit?: number;
  text?: string;
};
type FaultState = {
  held: string[];
  calls: {
    method: string;
    key: string | null;
    id: string | null;
    done: boolean;
    objectId?: string;
    targetId?: string;
    revision?: number;
    errorCode?: string | null;
  }[];
};
type FaultControl = {
  arm(plan: FaultPlan): void;
  release(id: string): void;
  snapshot(): FaultState;
};
const faultInstaller = `
const registry = ipcMain._invokeHandlers;
if (!(registry instanceof Map)) throw new Error('Unsupported real Main registry');
const methods = ['readObject', 'query', 'copyText', 'createGrant', 'updateGrant', 'operationStatus', 'saveObject', 'agentConfiguration'];
const handlers = methods.map((method) => {
  const name = 'agentspace:method:' + method, handler = registry.get(name);
  if (typeof handler !== 'function') throw new Error('Missing original Main handler: ' + method);
  return { name, method, handler };
});
if (globalThis.__contextSetupFault) throw new Error('Fault installer already active');
const plans = [], held = new Map(), calls = [];
for (const { name, method, handler } of handlers) {
  ipcMain.removeHandler(name);
  ipcMain.handle(name, async (event, request) => {
    const index = plans.findIndex((plan) => plan.method === method &&
      (plan.objectId === undefined || plan.objectId === (request?.input?.objectId ?? request?.input?.targetId)) &&
      (plan.revision === undefined || plan.revision === request?.input?.revision) &&
      (plan.limit === undefined || plan.limit === request?.input?.limit) &&
      (plan.text === undefined || plan.text === request?.input?.filter?.text));
    const plan = index < 0 ? null : plans.splice(index, 1)[0];
    const call = { method, key: request?.input?.operationKey ?? null, id: plan?.id ?? null, done: false, objectId: request?.input?.objectId, targetId: request?.input?.targetId, revision: request?.input?.revision, errorCode: null };
    calls.push(call);
    const result = await handler(event, request);
    call.errorCode = result?.ok ? null : result?.error?.code ?? null;
    if (plan?.hold && result?.ok) await new Promise((resolve) => held.set(plan.id, resolve));
    call.done = true;
    if (plan?.drop && result?.ok) throw new Error('Synthetic lost reply after the real Main handler');
    return result;
  });
}
globalThis.__contextSetupFault = {
  arm(plan) { plans.push(plan); },
  release(id) { const resolve = held.get(id); held.delete(id); resolve?.(); },
  snapshot() { return { held: [...held.keys()], calls: calls.map((call) => ({ ...call })) }; }
};`;

async function installFaults(n: NativeHarness, label: string) {
  const handlers = await n.application.evaluate(({ ipcMain }) => {
    const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })
      ._invokeHandlers;
    return Object.fromEntries(
      [
        'readObject',
        'query',
        'copyText',
        'createGrant',
        'updateGrant',
        'operationStatus',
        'saveObject',
        'agentConfiguration',
      ].map((method) => {
        const handler = registry.get(`agentspace:method:${method}`);
        if (typeof handler !== 'function') throw new Error('Missing actual Main handler');
        return [method, Function.prototype.toString.call(handler)];
      }),
    );
  });
  writeFileSync(
    join(out, `${label}-original-handlers.json`),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(handlers).map(([name, source]) => [
          name,
          createHash('sha256').update(source).digest('hex'),
        ]),
      ),
      null,
      2,
    ),
  );
  await n.application.evaluate(({ ipcMain }, source) => {
    new Function('ipcMain', source)(ipcMain);
  }, faultInstaller);
}
async function arm(n: NativeHarness, plan: FaultPlan) {
  await n.application.evaluate(
    (_, input) =>
      (globalThis as unknown as { __contextSetupFault: FaultControl }).__contextSetupFault.arm(
        input,
      ),
    plan,
  );
}
async function release(n: NativeHarness, id: string) {
  await n.application.evaluate(
    (_, input) =>
      (globalThis as unknown as { __contextSetupFault: FaultControl }).__contextSetupFault.release(
        input,
      ),
    id,
  );
}
async function faultState(n: NativeHarness) {
  return n.application.evaluate(() =>
    (globalThis as unknown as { __contextSetupFault: FaultControl }).__contextSetupFault.snapshot(),
  );
}
async function waitFault(n: NativeHarness, id: string, held = true) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const state = await faultState(n);
    if (held ? state.held.includes(id) : state.calls.some((call) => call.id === id && call.done))
      return;
    await delay(20);
  }
  writeFileSync(join(out, `unreached-${id}.json`), JSON.stringify(await faultState(n), null, 2));
  assert.fail(`The real Main boundary did not reach ${id}.`);
}
async function frames(n: NativeHarness) {
  await n.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function editorState(n: NativeHarness) {
  return n.page.getByTestId('document-pane').evaluate((element) => {
    let fiber = (element as unknown as Record<string, unknown>)[
      Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!
    ] as {
      memoizedProps?: {
        editor?: {
          getSnapshot: () => {
            editorId: string;
            generation: number;
            revision: number | null;
            content: { body: string };
            saveState: string;
          };
        };
      };
      return?: unknown;
    } | null;
    while (fiber) {
      const editor = fiber.memoizedProps?.editor;
      if (editor) {
        const snapshot = editor.getSnapshot();
        const input = element.querySelector('[data-testid="markdown-input"]') as HTMLElement & {
          cmTile?: { view: { state: { selection: { main: { anchor: number; head: number } } } } };
        };
        const caret = input.cmTile?.view.state.selection.main;
        if (!caret) throw new Error('The actual CodeMirror caret is required.');
        return {
          id: snapshot.editorId,
          generation: snapshot.generation,
          revision: snapshot.revision,
          body: snapshot.content.body,
          saveState: snapshot.saveState,
          caret: { anchor: caret.anchor, head: caret.head },
        };
      }
      fiber = fiber.return as typeof fiber;
    }
    throw new Error('An actual EditorSession is required.');
  });
}
async function accessFormState(settings: Locator) {
  return settings.locator('form').evaluate((form) =>
    Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')).map(
      (element) => ({
        testId: element.dataset.testid ?? null,
        type: element.type,
        disabled: element.matches(':disabled'),
        ...(element instanceof HTMLInputElement
          ? { value: element.value, checked: element.checked }
          : {}),
      }),
    ),
  );
}

test(
  '7D read and clipboard response loss preserve a human draft, and unknown access operations keep their original retry keys',
  { skip: process.platform !== 'darwin', timeout: 120000 },
  async () => {
    const f = contextFixture();
    const otherDirectory = join(f.root, 'Other binding space');
    const other = ok(Space.create(otherDirectory, { title: 'Other binding', example: true }));
    const n = await launchNative({ entry: root, userData: join(f.root, '7D fault profile') });
    const freeze: unknown[] = [];
    try {
      await openSpace(n, f.directory);
      await installFaults(n, 'response-loss');
      await n.page.getByTestId('nav-projects').click();
      await n.page.getByTestId(`object-row-${f.project.id}`).click();
      await n.page.getByTestId('project-edit').click();
      await arm(n, { id: 'human-save', method: 'saveObject', objectId: f.project.id, hold: true });
      await n.page.getByTestId('markdown-input').click();
      await n.page.keyboard.press('Meta+End');
      await n.page.keyboard.type(' Retained human input.');
      await waitFault(n, 'human-save');
      await n.page.keyboard.press('ArrowLeft');
      const humanBefore = await editorState(n);
      assert.equal(humanBefore.saveState, 'saving');
      assert.ok(humanBefore.body.includes('Retained human input.'));
      await n.page.locator('#history-button').click();
      await n.page.locator('#history-r1').click();
      await n.page.getByTestId('prepare-source-context').click();
      let prep = n.page.getByTestId('context-preparation');
      await prep.getByTestId('context-direct-more').waitFor();
      await prep
        .getByTestId('context-task')
        .fill('Read historical K1 while my own writing is pending.');
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      assert.equal(JSON.parse(await clipboard(n)).references[0].ref.revision, 1);
      await n.page.keyboard.press('Escape');
      await n.page.getByTestId('source-back').click();
      assert.deepEqual(
        await editorState(n),
        humanBefore,
        'Preparation and reading return keep the exact human session.',
      );
      await release(n, 'human-save');
      await n.page.waitForFunction(() =>
        document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
      );
      const savedHuman = ok(f.human.readObject({ objectId: f.project.id })).object;
      await n.page.getByTestId('prepare-document-context').click();
      prep = n.page.getByTestId('context-preparation');
      await prep.getByTestId('context-direct-more').waitFor();
      await prep.getByTestId('context-task').fill('Old task');
      await arm(n, {
        id: 'old-selection',
        method: 'readObject',
        objectId: f.project.id,
        revision: savedHuman.revision,
        hold: true,
        drop: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await waitFault(n, 'old-selection');
      await prep.getByTestId('context-task').fill('New task');
      await arm(n, {
        id: 'new-selection',
        method: 'readObject',
        objectId: f.project.id,
        revision: savedHuman.revision,
        hold: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await waitFault(n, 'new-selection');
      await release(n, 'old-selection');
      await waitFault(n, 'old-selection', false);
      await frames(n);
      assert.equal(
        await prep.getByTestId('copy-context-brief').isDisabled(),
        true,
        'Old failure/finally cannot finish the newer read.',
      );
      assert.equal(await prep.getByTestId('error-notice').count(), 0);
      await release(n, 'new-selection');
      await prep.getByTestId('context-brief-copied').waitFor();
      assert.equal(JSON.parse(await clipboard(n)).task, 'New task');
      const copies = (await faultState(n)).calls.filter(
        (call) => call.method === 'copyText',
      ).length;
      await arm(n, {
        id: 'old-success',
        method: 'readObject',
        objectId: f.project.id,
        revision: savedHuman.revision,
        hold: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await waitFault(n, 'old-success');
      await prep.getByTestId('context-task').fill('Kept task');
      await release(n, 'old-success');
      await waitFault(n, 'old-success', false);
      await frames(n);
      assert.equal(
        (await faultState(n)).calls.filter((call) => call.method === 'copyText').length,
        copies,
      );
      assert.equal(await prep.getByTestId('context-brief-copied').count(), 0);
      await arm(n, { id: 'lost-copy', method: 'copyText', drop: true });
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('error-notice').waitFor();
      assert.equal(await prep.getByTestId('context-task').inputValue(), 'Kept task');
      await prep.getByTestId('error-notice').getByRole('button').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      assert.equal(JSON.parse(await clipboard(n)).task, 'Kept task');
      await arm(n, {
        id: 'lost-read',
        method: 'readObject',
        objectId: f.project.id,
        revision: savedHuman.revision,
        drop: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('error-notice').waitFor();
      assert.equal(await prep.getByTestId('copy-context-brief').isDisabled(), true);
      assert.equal(await prep.getByTestId('context-agent-access').isDisabled(), true);
      await prep.getByTestId('error-notice').getByRole('button').click();
      await prep.getByTestId('error-notice').waitFor({ state: 'hidden' });
      await prep.getByTestId('context-agent-access').click();
      const settings = n.page.getByTestId('settings-dialog');
      await settings.evaluate((element) => {
        const dialog = element as HTMLDialogElement;
        const events: unknown[] = [];
        dialog.addEventListener('cancel', (event) => {
          queueMicrotask(() => {
            events.push({
              cancelable: event.cancelable,
              defaultPrevented: event.defaultPrevented,
              open: dialog.open,
            });
            dialog.dataset.cancelEvents = JSON.stringify(events);
          });
        });
      });
      await settings.getByTestId('grant-label').fill('Original unknown request');
      await arm(n, { id: 'unknown-grant', method: 'createGrant', hold: true, drop: true });
      await settings.getByTestId('create-grant').click();
      await waitFault(n, 'unknown-grant');
      await n.page.keyboard.press('Escape');
      const pendingGrantDialog = (await settings.count())
        ? await settings.evaluate((element) => ({
            open: (element as HTMLDialogElement).open,
            cancelEvents: (element as HTMLElement).dataset.cancelEvents,
          }))
        : null;
      writeFileSync(
        join(out, 'pending-create-dialog.json'),
        JSON.stringify({ count: await settings.count(), dialog: pendingGrantDialog }, null, 2),
      );
      assert.equal(await settings.isVisible(), true);
      assert.equal(await settings.getByTestId('grant-label').isDisabled(), true);
      assert.equal(await settings.getByTestId('create-grant').isDisabled(), true);
      assert.equal(await settings.locator('.grant-objects input').first().isDisabled(), true);
      const pendingForm = await accessFormState(settings);
      assert.ok(pendingForm.every((control) => control.disabled));
      freeze.push({ phase: 'pending-create', form: pendingForm });
      writeFileSync(join(out, 'access-freeze.json'), JSON.stringify(freeze, null, 2));
      await release(n, 'unknown-grant');
      await settings.getByTestId('error-notice').waitFor();
      await n.page.keyboard.press('Escape');
      assert.equal(await settings.isVisible(), true);
      assert.equal(await settings.getByTestId('grant-label').isDisabled(), true);
      assert.equal(await settings.getByTestId('create-grant').isDisabled(), true);
      assert.equal(
        await settings.getByTestId('error-notice').getByRole('button').isEnabled(),
        true,
      );
      const unknownForm = await accessFormState(settings);
      assert.ok(unknownForm.every((control) => control.disabled));
      freeze.push({ phase: 'unknown-create', form: unknownForm });
      writeFileSync(join(out, 'access-freeze.json'), JSON.stringify(freeze, null, 2));
      await settings.getByTestId('error-notice').getByRole('button').click();
      await settings.getByText(t('en', 'access.tokenLost'), { exact: true }).waitFor();
      assert.equal(ok(f.human.listGrants()).length, 1);
      assert.equal(ok(f.human.listGrants())[0]!.label, 'Original unknown request');
      const created = (await faultState(n)).calls.filter((call) => call.method === 'createGrant');
      assert.equal(created.length, 2);
      assert.equal(created[0]!.key, created[1]!.key);
      assert.deepEqual(ok(f.human.listGrants())[0]!.scope, {
        mode: 'objects',
        objectIds: [f.project.id],
      });
      assert.equal(await settings.getByTestId('grant-label').isEnabled(), true);
      assert.equal(
        await settings.getByTestId('grant-label').inputValue(),
        'Original unknown request',
      );
      await settings.getByTestId('grant-label').fill('Later form edit');
      const grantRow = settings
        .locator('.grant-row')
        .filter({ hasText: 'Original unknown request' });
      await arm(n, { id: 'unknown-revoke', method: 'updateGrant', hold: true, drop: true });
      await grantRow.getByRole('button', { name: t('en', 'access.revoke'), exact: true }).click();
      await waitFault(n, 'unknown-revoke');
      await n.page.keyboard.press('Escape');
      assert.equal(await settings.isVisible(), true);
      assert.equal(await settings.getByTestId('grant-label').isDisabled(), true);
      assert.ok((await accessFormState(settings)).every((control) => control.disabled));
      await release(n, 'unknown-revoke');
      await settings.getByTestId('error-notice').waitFor();
      await n.page.keyboard.press('Escape');
      assert.equal(await settings.isVisible(), true);
      assert.ok((await accessFormState(settings)).every((control) => control.disabled));
      assert.equal(
        await settings.getByTestId('error-notice').getByRole('button').isEnabled(),
        true,
      );
      freeze.push({ phase: 'unknown-revoke', form: await accessFormState(settings) });
      writeFileSync(join(out, 'access-freeze.json'), JSON.stringify(freeze, null, 2));
      await settings.getByTestId('error-notice').getByRole('button').click();
      await grantRow
        .getByRole('button', { name: t('en', 'access.revoke'), exact: true })
        .waitFor({ state: 'hidden' });
      const revoked = (await faultState(n)).calls.filter((call) => call.method === 'updateGrant');
      assert.equal(revoked.length, 2);
      assert.equal(revoked[0]!.key, revoked[1]!.key);
      assert.equal(ok(f.human.listGrants())[0]!.revoked, true);
      assert.equal(await settings.getByTestId('grant-label').isEnabled(), true);
      await arm(n, { id: 'nested-reissue', method: 'createGrant', hold: true });
      await grantRow.getByRole('button', { name: t('en', 'access.reissue'), exact: true }).click();
      await waitFault(n, 'nested-reissue');
      await n.page.keyboard.press('Escape');
      assert.equal(await settings.isVisible(), true);
      assert.ok((await accessFormState(settings)).every((control) => control.disabled));
      freeze.push({ phase: 'nested-reissue', form: await accessFormState(settings) });
      writeFileSync(join(out, 'access-freeze.json'), JSON.stringify(freeze, null, 2));
      await release(n, 'nested-reissue');
      await settings.getByTestId('copy-codex-config').waitFor();
      await n.page.waitForFunction(() => {
        const label = document.querySelector<HTMLInputElement>('[data-testid="grant-label"]');
        return label && !label.disabled;
      });
      assert.equal(ok(f.human.listGrants()).length, 2);
      await settings.getByTestId('copy-codex-config').click();
      const retainedConfiguration = await clipboard(n);
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      await prep.getByTestId('context-agent-access').click();
      await settings.getByTestId('copy-codex-config').click();
      assert.equal(await clipboard(n), retainedConfiguration);
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      const beforeStale = (await faultState(n)).calls.length;
      const retainedMember = f.members[0]!;
      await prep.getByTestId(`context-member-${pinKey(retainedMember.id)}`).check();
      ok(
        f.human.saveObject({
          operationKey: 'context:member-head-after-selection',
          targetId: retainedMember.id,
          expectedRevision: 1,
          content: { ...retainedMember.content, body: 'A later current member version.' },
        }),
      );
      const copiesBeforeGroupChange = (await faultState(n)).calls.filter(
        (call) => call.method === 'copyText',
      ).length;
      await arm(n, {
        id: 'old-groups',
        method: 'readObject',
        objectId: f.project.id,
        revision: savedHuman.revision,
        hold: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await waitFault(n, 'old-groups');
      await prep.getByTestId('context-member-more').click();
      const untilFresh = Date.now() + 5000;
      while (
        !(await faultState(n)).calls
          .slice(beforeStale)
          .some((call) => call.errorCode === 'CURSOR_STALE')
      ) {
        assert.ok(Date.now() < untilFresh, 'The grants must stale the original member cursor.');
        await delay(20);
      }
      await n.page.waitForFunction(() => {
        const more = document.querySelector<HTMLButtonElement>(
          '[data-testid="context-member-more"]',
        );
        return (
          more &&
          !more.disabled &&
          document.querySelectorAll('input[data-testid^="context-member-"]').length === 20
        );
      });
      await release(n, 'old-groups');
      await waitFault(n, 'old-groups', false);
      await frames(n);
      assert.equal(
        (await faultState(n)).calls.filter((call) => call.method === 'copyText').length,
        copiesBeforeGroupChange,
      );
      assert.equal(await prep.getByTestId('context-brief-copied').count(), 0);
      const retainedChoice = prep.getByTestId(`context-retained-${pinKey(retainedMember.id)}`);
      assert.equal(await retainedChoice.isChecked(), true);
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      const regrouped = JSON.parse(await clipboard(n));
      assert.equal(regrouped.references.length, 2);
      assert.deepEqual(regrouped.referenceGroups.currentActiveProjectMaterialAsQueried, []);
      assert.deepEqual(regrouped.referenceGroups.earlierSelectedResults, [
        { mode: 'pinned', objectId: retainedMember.id, revision: 1 },
      ]);
      await retainedChoice.click();
      assert.equal(await retainedChoice.count(), 0);
      assert.equal(
        await prep
          .getByText(t('en', 'contextPrep.selected', { count: 1 }), { exact: true })
          .isVisible(),
        true,
      );
      await arm(n, { id: 'old-member-page', method: 'query', limit: 20, hold: true });
      await prep.getByTestId('context-member-more').click();
      await waitFault(n, 'old-member-page');
      await n.page.keyboard.press('Escape');
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId('space-search').fill(longTitle);
      await n.page.getByTestId(`object-row-${f.long.id}`).click();
      await n.page.getByTestId('prepare-document-context').click();
      await release(n, 'old-member-page');
      await waitFault(n, 'old-member-page', false);
      await frames(n);
      assert.equal(await prep.getByTestId('context-task').inputValue(), '');
      assert.equal(await prep.locator('[data-context-reference]').count(), 1);
      await prep.getByTestId('context-agent-access').click();
      await settings.getByTestId('use-prepared-access').waitFor();
      assert.equal(await settings.getByTestId('grant-label').inputValue(), 'Later form edit');
      await settings.getByTestId('use-prepared-access').click();
      assert.equal(await settings.getByTestId(`access-object-${f.long.id}`).isChecked(), true);
      assert.equal(await settings.locator('.grant-objects input:checked').count(), 1);
      assert.equal(ok(f.human.listGrants()).length, 2);
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      await arm(n, {
        id: 'old-binding',
        method: 'readObject',
        objectId: f.long.id,
        revision: 1,
        hold: true,
      });
      await prep.getByTestId('copy-context-brief').click();
      await waitFault(n, 'old-binding');
      await n.page.keyboard.press('Escape');
      await n.page.getByTestId('space-menu').click();
      await n.chooseNextFolder(otherDirectory);
      await n.page.getByTestId('open-space-menu').click();
      await n.page.waitForFunction(
        (id) =>
          window.agentSpace
            .bootstrap()
            .then((result) => result.ok && result.value.activeSpace?.status.spaceId === id),
        ok(other.human('7d-other').status()).spaceId,
      );
      await release(n, 'old-binding');
      await waitFault(n, 'old-binding', false);
      await frames(n);
      assert.equal(await prep.count(), 0);
      assert.equal(await n.page.getByTestId('settings-dialog').count(), 0);
      assert.equal(ok(other.human('7d-other').listGrants()).length, 0);
      writeFileSync(
        join(out, 'response-loss-main.json'),
        JSON.stringify(await faultState(n), null, 2),
      );
      assert.deepEqual(n.pageErrors, []);
    } finally {
      const remainingSettings = n.page.getByTestId('settings-dialog');
      const dialogState = (await remainingSettings.count())
        ? await remainingSettings.evaluate((element) => ({
            open: (element as HTMLDialogElement).open,
            cancelEvents: (element as HTMLElement).dataset.cancelEvents,
          }))
        : null;
      writeFileSync(
        join(out, 'last-settings-dialog.json'),
        JSON.stringify({ count: await remainingSettings.count(), dialogState }, null, 2),
      );
      const observed = await faultState(n).catch(() => null);
      if (observed)
        writeFileSync(
          join(out, 'response-loss-last-state.json'),
          JSON.stringify(observed, null, 2),
        );
      await n.close();
      other.close();
      f.dispose();
    }
  },
);

test(
  '7D import entry requires a current successful unfiltered Library result and returns through the real import flow',
  { skip: process.platform !== 'darwin', timeout: 90000 },
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'agentspace-7d-import-')),
      directory = join(scratch, 'Empty space'),
      originals = join(scratch, 'Original material');
    mkdirSync(originals);
    const original = '# Existing material\n\nOriginal bytes stay intact.\n';
    writeFileSync(join(originals, 'Existing material.md'), original);
    const space = ok(Space.create(directory, { title: 'Import entry check', example: true }));
    const n = await launchNative({ entry: root, userData: join(scratch, '7D import profile') });
    try {
      await openSpace(n, directory);
      await installFaults(n, 'import-entry');
      await n.page.getByTestId('continue-import').click();
      await n.page.getByTestId('import-dialog').waitFor();
      await n.page.keyboard.press('Escape');
      await arm(n, { id: 'initial-library', method: 'query', limit: 50, hold: true });
      await n.page.getByTestId('nav-library').click();
      await waitFault(n, 'initial-library');
      assert.equal(await n.page.getByTestId('library-empty-import').count(), 0);
      await release(n, 'initial-library');
      await n.page.getByTestId('library-empty-import').waitFor();
      await n.page.getByTestId('library-empty-import').click();
      await n.page.getByTestId('import-dialog').waitFor();
      await n.page.keyboard.press('Escape');
      await arm(n, { id: 'failed-library', method: 'query', limit: 50, drop: true });
      await n.page.getByTestId('lifecycle-filter').selectOption('all');
      await n.page.locator('.list-scroll').getByTestId('error-notice').waitFor();
      assert.equal(await n.page.getByTestId('library-empty-import').count(), 0);
      await n.page.locator('.list-scroll').getByTestId('error-notice').getByRole('button').click();
      await n.page.getByTestId('library-empty-import').waitFor();
      await arm(n, { id: 'old-filter', method: 'query', limit: 50, text: 'missing A', hold: true });
      await n.page.getByTestId('space-search').fill('missing A');
      await waitFault(n, 'old-filter');
      await n.page.getByTestId('space-search').fill('missing B');
      assert.equal(await n.page.getByTestId('library-empty-import').count(), 0);
      await n.page.getByTestId('space-search').fill('');
      await n.page.getByTestId('library-empty-import').waitFor();
      await release(n, 'old-filter');
      await waitFault(n, 'old-filter', false);
      await frames(n);
      assert.equal(await n.page.getByTestId('library-empty-import').isVisible(), true);
      await n.page.getByTestId('nav-continue').click();
      await n.page.getByTestId('continue-import').click();
      let importer = n.page.getByTestId('import-dialog');
      await importer.getByTestId('import-profile').selectOption('plain-files/v1');
      await n.chooseNextFolder(originals);
      await importer.getByTestId('choose-import-folder').click();
      await importer.getByTestId('confirm-import').click();
      await importer
        .getByTestId('import-run')
        .getByRole('button', {
          name: t('en', 'common.openNamed', { title: 'Existing material' }),
          exact: true,
        })
        .click();
      await n.page.getByTestId('source-reader').waitFor();
      await n.page.getByTestId('prepare-source-context').click();
      const prep = n.page.getByTestId('context-preparation');
      await prep
        .getByTestId('context-task')
        .fill('Keep this task while opening another imported result.');
      await prep.getByTestId('context-import').click();
      importer = n.page.getByTestId('import-dialog');
      await importer.locator('.import-history-row').first().click();
      await importer
        .getByTestId('import-run')
        .getByRole('button', {
          name: t('en', 'common.openNamed', { title: 'Existing material' }),
          exact: true,
        })
        .click();
      await frames(n);
      assert.equal(
        await prep.count(),
        0,
        'Explicitly opening an import result does not resurrect the old preparation.',
      );
      assert.equal(readFileSync(join(originals, 'Existing material.md'), 'utf8'), original);
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      space.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);

test(
  '7D a historical saved project prepares bounded exact references and explicitly configures two scoped clients',
  { skip: process.platform !== 'darwin', timeout: 120000 },
  async () => {
    const f = contextFixture();
    const n = await launchNative({ entry: root, userData: join(f.root, '7D context profile') });
    const clients: Client[] = [];
    try {
      await openSpace(n, f.directory);
      await n.page.getByTestId('nav-projects').click();
      await n.page.getByTestId(`object-row-${f.project.id}`).click();
      await n.page.locator('#history-button').click();
      await n.page.locator('#history-r1').click();
      await n.page.getByTestId('prepare-source-context').click();
      const prep = n.page.getByTestId('context-preparation');
      await prep.getByTestId('context-direct-more').waitFor();
      await prep.getByTestId('context-member-more').waitFor();
      assert.equal(await prep.locator('input[type="checkbox"]:checked').count(), 1);
      await prep.getByTestId('context-task').fill('😀'.repeat(1001));
      assert.equal(Array.from(await prep.getByTestId('context-task').inputValue()).length, 1000);
      const task = 'Compare the selected saved versions.';
      await prep.getByTestId('context-task').fill(task);
      await prep.getByTestId(`context-direct-${uuid(4000)}-${pinKey(f.assetK2.id, 2)}`).check();
      await prep.getByTestId('context-direct-more').click();
      await prep.getByTestId(`context-direct-${uuid(4999)}-${pinKey(f.assets[0]!.id)}`).check();
      await prep.getByTestId(`context-direct-${uuid(4023)}-${pinKey(f.assets[23]!.id)}`).check();
      await prep.getByTestId('context-member-more').click();
      await prep.getByTestId(`context-member-${pinKey(f.members[22]!.id)}`).check();
      for (const member of f.members.slice(0, 15))
        await prep.getByTestId(`context-member-${pinKey(member.id)}`).check();
      await prep.getByTestId(`context-member-${pinKey(f.members[15]!.id)}`).click();
      assert.equal(
        await prep.getByTestId(`context-member-${pinKey(f.members[15]!.id)}`).isChecked(),
        false,
      );
      assert.equal(
        await prep.getByText(t('en', 'contextPrep.selectionLimit'), { exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await prep
          .getByText(t('en', 'contextPrep.selected', { count: 20 }), { exact: true })
          .isVisible(),
        true,
      );
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      const maximum = JSON.parse(await clipboard(n));
      assert.equal(maximum.references.length, 20);
      writeFileSync(
        join(out, 'selection-limit.json'),
        JSON.stringify(
          {
            references: maximum.references.map((item: { ref: unknown }) => item.ref),
            rejected: f.members[15]!.id,
          },
          null,
          2,
        ),
      );
      for (const member of f.members.slice(0, 15))
        await prep.getByTestId(`context-member-${pinKey(member.id)}`).uncheck();
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      const copied = await clipboard(n),
        brief = JSON.parse(copied);
      assert.equal(brief.task, task);
      assert.equal(brief.references.length, 5);
      assert.equal(
        brief.references.find((item: { title: string }) => item.title === f.project.content.title)
          .digest,
        f.project.digest,
      );
      assert.equal(brief.scope.completeProjectSnapshot, false);
      assert.deepEqual(brief.referenceGroups.startingSavedVersion, [
        { mode: 'pinned', objectId: f.project.id, revision: 1 },
      ]);
      assert.equal(brief.referenceGroups.directLinksInStartingVersion.length, 3);
      assert.deepEqual(brief.referenceGroups.currentActiveProjectMaterialAsQueried, [
        { mode: 'pinned', objectId: f.members[22]!.id, revision: 1 },
      ]);
      assert.deepEqual(brief.referenceGroups.earlierSelectedResults, []);
      assert.equal(brief.projectGoalExcerpt.ref.revision, 1);
      assert.equal(Array.from(brief.projectGoalExcerpt.text).length, 280);
      assert.deepEqual(
        brief.references
          .filter((item: { ref: { objectId: string } }) => item.ref.objectId === f.assetK2.id)
          .map((item: { ref: { revision: number } }) => item.ref.revision)
          .sort(),
        [1, 2],
      );
      await prep
        .locator('summary')
        .filter({ hasText: t('en', 'contextPrep.preview') })
        .click();
      assert.equal(await prep.getByTestId('context-brief-preview').textContent(), copied);
      await prep.getByTestId(`context-seed-${pinKey(f.project.id)}`).uncheck();
      await prep.getByTestId('copy-context-brief').click();
      await prep.getByTestId('context-brief-copied').waitFor();
      const unchecked = await clipboard(n);
      assert.equal(JSON.parse(unchecked).projectGoalExcerpt, undefined);
      assert.deepEqual(JSON.parse(unchecked).referenceGroups.startingSavedVersion, []);
      assert.ok(!unchecked.includes(f.project.content.title));
      await prep.getByTestId(`context-seed-${pinKey(f.project.id)}`).check();
      await prep.getByTestId('context-agent-access').click();
      const settings = n.page.getByTestId('settings-dialog');
      await settings.waitFor();
      assert.equal(ok(f.human.listGrants()).length, 0);
      assert.equal(
        await settings.getByTestId(`access-object-${f.assets[23]!.id}`).isChecked(),
        true,
      );
      assert.equal(await settings.locator('.grant-objects input:checked').count(), 4);
      await settings.getByTestId('grant-label').fill('First prepared client');
      await settings.getByTestId(`access-object-${f.members[22]!.id}`).uncheck();
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      assert.equal(await prep.getByTestId('context-task').inputValue(), task);
      await prep.getByTestId('context-agent-access').click();
      assert.equal(await settings.getByTestId('grant-label').inputValue(), 'First prepared client');
      assert.equal(
        await settings.getByTestId(`access-object-${f.members[22]!.id}`).isChecked(),
        false,
      );
      assert.equal(ok(f.human.listGrants()).length, 0);
      await settings.getByTestId('create-grant').click();
      await settings.getByTestId('copy-codex-config').waitFor();
      assert.equal(ok(f.human.listGrants()).length, 1);
      await settings.getByTestId('copy-codex-config').click();
      const toml = await clipboard(n);
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      await prep.getByTestId('context-agent-access').click();
      await settings.getByTestId('copy-codex-config').click();
      assert.equal(
        await clipboard(n),
        toml,
        'A known one-time configuration survives overlay return.',
      );
      await settings.getByRole('button', { name: t('en', 'access.copyJson'), exact: true }).click();
      const launch = JSON.parse(await clipboard(n)) as AgentLaunchConfiguration;
      const firstClient = await connect(launch, join(f.root, 'First agent profile'));
      clients.push(firstClient);
      assert.equal(ok(await read(firstClient, f.project.id, 1)).ref.revision, 1);
      assert.equal(ok(await read(firstClient, f.assetK2.id, 2)).ref.revision, 2);
      const newMember = ok(
        f.human.createObject({
          operationKey: 'context:later-link',
          kind: 'document',
          content: {
            title: 'Later linked material',
            body: 'Not automatically authorized.',
            properties: {},
            relations: [
              {
                id: uuid(9901),
                predicate: 'belongs_to',
                target: { mode: 'current', objectId: f.project.id },
              },
            ],
          },
        }),
      ).object;
      const current = ok(f.human.readObject({ objectId: f.project.id })).object;
      const later = ok(
        f.human.saveObject({
          operationKey: 'context:new-project-link',
          targetId: current.id,
          expectedRevision: current.revision,
          content: {
            ...current.content,
            relations: [
              ...current.content.relations,
              {
                id: uuid(9902),
                predicate: 'related',
                target: { mode: 'current', objectId: newMember.id },
              },
            ],
          },
        }),
      ).object;
      assert.equal(ok(await read(firstClient, f.project.id)).ref.revision, later.revision);
      const denied = await read(firstClient, newMember.id);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN');
      while ((await settings.locator('.grant-objects input:checked').count()) > 0)
        await settings.locator('.grant-objects input:checked').first().uncheck();
      await settings.getByTestId(`access-object-${f.members[22]!.id}`).check();
      await settings.getByTestId('grant-label').fill('Second independent client');
      await settings.getByTestId('create-grant').click();
      await settings
        .getByTestId('issued-configuration')
        .getByRole('heading', { name: 'Second independent client', exact: true })
        .waitFor();
      await settings.getByTestId('copy-codex-config').waitFor();
      await settings.getByRole('button', { name: t('en', 'access.copyJson'), exact: true }).click();
      const secondClient = await connect(
        JSON.parse(await clipboard(n)),
        join(f.root, 'Second agent profile'),
      );
      clients.push(secondClient);
      assert.equal(ok(await read(secondClient, f.members[22]!.id)).ref.revision, 1);
      const separate = await read(secondClient, f.assetK2.id);
      assert.equal(separate.ok, false);
      if (!separate.ok) assert.equal(separate.error.code, 'FORBIDDEN');
      assert.equal(ok(f.human.listGrants()).length, 2);
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      await prep.getByTestId('context-import').click();
      await n.page.getByTestId('import-dialog').waitFor();
      await n.page.keyboard.press('Escape');
      await prep.waitFor();
      assert.equal(await prep.getByTestId('context-task').inputValue(), task);
      assert.equal(
        await prep.getByTestId(`context-seed-${pinKey(f.project.id)}`).isChecked(),
        true,
      );
      await n.page.keyboard.press('Escape');
      assert.equal(
        await n.page.getByTestId('source-reader').getByRole('heading', { level: 1 }).textContent(),
        f.project.content.title,
      );
      assert.deepEqual(n.pageErrors, []);
    } finally {
      for (const client of clients) await client.close();
      await n.close();
      f.dispose();
    }
  },
);

test(
  '7D complete 240-character labels and focus paint remain readable through natural Tab in five locales',
  { skip: process.platform !== 'darwin', timeout: 120000 },
  async () => {
    const f = contextFixture();
    const n = await launchNative({ entry: root, userData: join(f.root, '7D label profile') });
    const records: unknown[] = [];
    mkdirSync(out, { recursive: true });
    try {
      await openSpace(n, f.directory);
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId('space-search').fill(longTitle);
      await n.page.getByTestId(`object-row-${f.long.id}`).click();
      for (const locale of supportedLocales) {
        await n.setWindowBounds({ width: 1200, height: 850 });
        await n.page.getByTestId('settings-button').click();
        await n.page.getByTestId('locale-select').selectOption(locale);
        await n.page.getByTestId('text-scale-select').selectOption('1');
        await n.page.keyboard.press('Escape');
        const groups = [
          { width: 1200, height: 850, scale: 1 },
          ...[1024, 980].flatMap((width) =>
            [688, 681].map((height) => ({ width, height, scale: 2 })),
          ),
        ];
        for (const group of groups) {
          await n.setWindowBounds({ width: 1200, height: 850 });
          await n.page.getByTestId('settings-button').click();
          await n.page.getByTestId('text-scale-select').selectOption(String(group.scale));
          await n.page.keyboard.press('Escape');
          const geometry = await n.setWindowBounds(group);
          await n.page.getByTestId('prepare-document-context').click();
          const prep = n.page.getByTestId('context-preparation'),
            seed = prep.getByTestId(`context-seed-${pinKey(f.long.id)}`);
          await seed.waitFor();
          if (locale === 'en' && group.width === 980 && group.height === 681) {
            await seed.evaluate((element) => {
              const input = element as HTMLInputElement;
              input.addEventListener(
                'pointerdown',
                () => {
                  input.dataset.pointerDown = JSON.stringify(
                    input.getBoundingClientRect().toJSON(),
                  );
                },
                { once: true },
              );
              document.addEventListener(
                'pointerup',
                (event) => {
                  input.dataset.pointerUp = JSON.stringify({
                    rect: input.getBoundingClientRect().toJSON(),
                    targetIsInput: event.target === input,
                  });
                },
                { once: true },
              );
            });
            const before = await seed.isChecked();
            await seed.click();
            const after = await seed.isChecked();
            const pointer = await seed.evaluate((element) => ({
              down: (element as HTMLElement).dataset.pointerDown,
              up: (element as HTMLElement).dataset.pointerUp,
            }));
            writeFileSync(
              join(out, 'long-label-pointer.json'),
              JSON.stringify({ before, after, pointer }, null, 2),
            );
            await capture(n, 'long-label-pointer');
            assert.equal(after, !before, 'A real pointer click must change the checkbox.');
            await seed.click();
            await n.page.keyboard.press('Tab');
          }
          await tabTo(n, seed);
          const prepared = await completeLabel(seed);
          records.push({
            locale,
            group,
            geometry,
            component: 'ContextPreparation',
            measurement: prepared,
          });
          writeFileSync(join(out, 'label-geometry.json'), JSON.stringify(records, null, 2));
          if (group.width === 980 && group.height === 681)
            await capture(n, `${locale}-980x681-preparation`);
          assert.equal(prepared.titleCodepoints, 240);
          assert.ok(
            prepared.focused &&
              prepared.complete &&
              prepared.glyphsComplete &&
              prepared.paint &&
              prepared.center,
            JSON.stringify(prepared),
          );
          const keyboardGroup = locale === 'en' && group.width === 980 && group.height === 681;
          const keyboard: unknown[] = [];
          if (keyboardGroup) {
            await seed.press('Space');
            assert.equal(await seed.isChecked(), false);
            await seed.press('Space');
            assert.equal(await seed.isChecked(), true);
            for (const id of ['copy-context-brief', 'context-agent-access']) {
              const control = prep.getByTestId(id);
              await tabTo(n, control);
              const measured = await completeLabel(control, false);
              assert.ok(
                measured.focused &&
                  measured.complete &&
                  measured.glyphsComplete &&
                  measured.paint &&
                  measured.center,
                JSON.stringify(measured),
              );
              keyboard.push({ id, measurement: measured });
              await n.page.keyboard.press('Enter');
              if (id === 'copy-context-brief')
                await prep.getByTestId('context-brief-copied').waitFor();
            }
          } else await prep.getByTestId('context-agent-access').click();
          const access = n.page.getByTestId(`access-object-${f.long.id}`);
          await access.waitFor();
          await tabTo(n, access);
          const granted = await completeLabel(access);
          records.push({ locale, group, geometry, component: 'AgentAccess', measurement: granted });
          writeFileSync(join(out, 'label-geometry.json'), JSON.stringify(records, null, 2));
          if (group.width === 980 && group.height === 681)
            await capture(n, `${locale}-980x681-access`);
          assert.equal(granted.titleCodepoints, 240);
          assert.ok(
            granted.focused &&
              granted.complete &&
              granted.glyphsComplete &&
              granted.paint &&
              granted.center,
            JSON.stringify(granted),
          );
          if (keyboardGroup) {
            const settings = n.page.getByTestId('settings-dialog');
            await settings.getByTestId('grant-label').fill('Keyboard layout check');
            const scopes = settings.locator('input[type="radio"]');
            await tabTo(n, scopes.first());
            await n.page.keyboard.press('ArrowRight');
            assert.equal(await scopes.nth(1).isChecked(), true);
            await n.page.keyboard.press('ArrowLeft');
            assert.equal(await scopes.first().isChecked(), true);
            const create = settings.getByTestId('create-grant');
            await tabTo(n, create);
            const measured = await completeLabel(create, false);
            assert.ok(
              measured.focused &&
                measured.complete &&
                measured.glyphsComplete &&
                measured.paint &&
                measured.center,
              JSON.stringify(measured),
            );
            keyboard.push({ id: 'create-grant', measurement: measured });
            writeFileSync(join(out, 'keyboard-controls.json'), JSON.stringify(keyboard, null, 2));
          }
          await n.page.keyboard.press('Escape');
          await prep.waitFor();
          await n.page.keyboard.press('Escape');
        }
      }
      assert.equal(ok(f.human.listGrants()).length, 0);
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      f.dispose();
    }
  },
);

test(
  '7D a delayed configuration retry cannot replace a newer explicitly created grant',
  { skip: process.platform !== 'darwin', timeout: 60000 },
  async () => {
    const f = createAcceptanceFixture();
    const n = await launchNative({
      entry: root,
      userData: join(f.root, '7D configuration identity profile'),
    });
    try {
      await openSpace(n, f.directory);
      await installFaults(n, 'configuration-identity');
      await n.page.getByTestId('settings-button').click();
      const settings = n.page.getByTestId('settings-dialog');
      await settings.getByTestId('grant-label').fill('Configuration A');
      await settings.getByTestId(`access-object-${f.ids.independent}`).check();
      await arm(n, { id: 'initial-config-a', method: 'agentConfiguration', drop: true });
      await settings.getByTestId('create-grant').click();
      await settings.getByTestId('error-notice').waitFor();
      await n.page.waitForFunction(() => {
        const label = document.querySelector<HTMLInputElement>('[data-testid="grant-label"]');
        return label && !label.disabled;
      });
      const grantA = ok(f.human.listGrants()).find((grant) => grant.label === 'Configuration A')!;
      await arm(n, { id: 'retry-config-a', method: 'agentConfiguration', hold: true });
      await settings.getByTestId('error-notice').getByRole('button').click();
      await waitFault(n, 'retry-config-a');
      assert.equal(await settings.getByTestId('grant-label').isEnabled(), true);
      await settings.getByTestId('grant-label').fill('Configuration B');
      await settings.getByTestId(`access-object-${f.ids.independent}`).uncheck();
      await settings.getByTestId(`access-object-${f.ids.retryPolicy}`).check();
      await settings.getByTestId('create-grant').click();
      await settings
        .getByTestId('issued-configuration')
        .getByRole('heading', { name: 'Configuration B', exact: true })
        .waitFor();
      await settings.getByTestId('copy-codex-config').waitFor();
      await settings.getByRole('button', { name: t('en', 'access.copyJson'), exact: true }).click();
      const before = JSON.parse(await clipboard(n)) as AgentLaunchConfiguration;
      const beforeGrant = before.args[before.args.indexOf('--grant') + 1];
      const grantB = ok(f.human.listGrants()).find((grant) => grant.label === 'Configuration B')!;
      assert.equal(beforeGrant, grantB.id);
      await release(n, 'retry-config-a');
      await waitFault(n, 'retry-config-a', false);
      await frames(n);
      await settings.getByRole('button', { name: t('en', 'access.copyJson'), exact: true }).click();
      const after = JSON.parse(await clipboard(n)) as AgentLaunchConfiguration;
      const afterGrant = after.args[after.args.indexOf('--grant') + 1];
      writeFileSync(
        join(out, 'configuration-race.json'),
        JSON.stringify(
          {
            grantA: grantA.id,
            grantB: grantB.id,
            beforeGrant,
            afterGrant,
            visibleIssuedLabel: await settings
              .getByTestId('issued-configuration')
              .getByRole('heading')
              .textContent(),
          },
          null,
          2,
        ),
      );
      assert.equal(
        afterGrant,
        grantB.id,
        'A late A configuration must not replace the visible B configuration.',
      );
      assert.equal(ok(f.human.listGrants()).length, 2);
      assert.deepEqual(n.pageErrors, []);
    } finally {
      writeFileSync(
        join(out, 'configuration-last-state.json'),
        JSON.stringify(await faultState(n).catch(() => null), null, 2),
      );
      await n.close();
      f.dispose();
    }
  },
);
