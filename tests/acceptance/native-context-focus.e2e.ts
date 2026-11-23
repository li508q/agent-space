import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { Locator } from 'playwright-core';
import { Space } from '../../src/core/index.js';
import type { Locale } from '../../src/renderer/i18n/index.js';
import {
  installClipboardFixture,
  snapshotClipboardSink as clipboardSink,
  type ClipboardFixture,
} from './clipboard-fixture.js';
import { requireSuccess as ok } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.AGENTSPACE_CONTEXT_FOCUS_RUN ?? 'latest';
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('Invalid native evidence directory.');
const out = join(root, '.coordination/7D/focus-followup/native', run);
const uuid = (value: number) => `7df00000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const title = '資料'.repeat(120);
const taskText = 'Inspect the saved references and propose a concise correction.';
const groups: { id: string; locale: Locale; width: number; height: number; scale: number }[] = [
  { id: 'en-normal', locale: 'en', width: 980, height: 720, scale: 1 },
  ...(['en', 'zh-CN', 'ja', 'ko', 'es'] as const).map((locale) => ({
    id: `${locale}-688`,
    locale,
    width: 980,
    height: 688,
    scale: 2,
  })),
  { id: 'es-681', locale: 'es', width: 980, height: 681, scale: 2 },
];

function fixture() {
  const directoryRoot = mkdtempSync(join(tmpdir(), 'agentspace-context-focus-'));
  const directory = join(directoryRoot, 'Synthetic focus space');
  const space = ok(Space.create(directory, { title: 'Synthetic context focus', example: true }));
  const human = space.human('context-focus-test');
  const asset = ok(
    human.createObject({
      operationKey: 'focus:asset',
      id: uuid(1),
      kind: 'asset',
      content: { title, body: 'Fixed asset K1.', properties: {}, relations: [] },
    }),
  ).object;
  const original = ok(
    human.createObject({
      operationKey: 'focus:original',
      id: uuid(2),
      kind: 'document',
      content: {
        title,
        body: 'Fixed original K1.',
        properties: {},
        relations: [
          {
            id: uuid(3),
            predicate: 'source',
            target: { mode: 'pinned', objectId: asset.id, revision: 1 },
          },
        ],
      },
    }),
  ).object;
  ok(
    human.saveObject({
      operationKey: 'focus:asset-k2',
      targetId: asset.id,
      expectedRevision: 1,
      content: { ...asset.content, title: 'Later asset K2', body: 'Later asset body.' },
    }),
  );
  ok(
    human.saveObject({
      operationKey: 'focus:original-k2',
      targetId: original.id,
      expectedRevision: 1,
      content: { ...original.content, body: 'Current human original K2.' },
    }),
  );
  return {
    directoryRoot,
    directory,
    space,
    human,
    asset,
    original,
    dispose() {
      space.close();
      rmSync(directoryRoot, { recursive: true, force: true });
    },
  };
}

function record(name: string, value: unknown) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(value, null, 2));
}
function fingerprints() {
  return Object.fromEntries(
    [
      'src/renderer/components/ContextPreparation.tsx',
      'src/renderer/components/AgentAccess.tsx',
      'tests/acceptance/native-context-focus.e2e.ts',
      'dist/desktop/main.cjs',
      'dist/desktop/preload.cjs',
      'dist/renderer/main.js',
      'dist/renderer/main.css',
    ].map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex'),
    ]),
  );
}
async function frames(n: NativeHarness) {
  await n.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function capture(n: NativeHarness, name: string) {
  const result = await n.application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const image = await window.webContents.capturePage();
    return {
      png: image.toPNG().toString('base64'),
      size: image.getSize(),
      content: window.getContentBounds(),
      bounds: window.getBounds(),
      zoom: window.webContents.getZoomFactor(),
    };
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.png`), Buffer.from(result.png, 'base64'));
  record(`${name}-capture`, {
    size: result.size,
    content: result.content,
    bounds: result.bounds,
    zoom: result.zoom,
  });
}
async function tabTo(n: NativeHarness, target: Locator, backwards = false) {
  for (let count = 0; count < 30; count++) {
    if (await target.evaluate((element) => document.activeElement === element)) {
      await frames(n);
      return;
    }
    await n.page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  assert.fail('Natural keyboard traversal did not reach the expected control.');
}

/** Strict zero-epsilon probe: real labels, same-dialog descriptions and every text glyph. */
async function measure(target: Locator) {
  return target.evaluate((element) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const dialog = input.closest('dialog')!;
    // Anonymous tuple helpers stay self-contained under tsx's keep-names transform.
    const [box] = [
      (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }),
    ] as const;
    const [clipFor] = [
      (part: Element) => {
        const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const chain = [];
        for (
          let parent: Element | null = part.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent),
            rect = parent.getBoundingClientRect();
          const x = /auto|scroll|hidden|clip/.test(style.overflowX),
            y = /auto|scroll|hidden|clip/.test(style.overflowY);
          if (x) {
            clip.left = Math.max(clip.left, rect.left + (parseFloat(style.borderLeftWidth) || 0));
            clip.right = Math.min(
              clip.right,
              rect.right - (parseFloat(style.borderRightWidth) || 0),
            );
          }
          if (y) {
            clip.top = Math.max(clip.top, rect.top + (parseFloat(style.borderTopWidth) || 0));
            clip.bottom = Math.min(
              clip.bottom,
              rect.bottom - (parseFloat(style.borderBottomWidth) || 0),
            );
          }
          if (x || y)
            chain.push({
              tag: parent.tagName,
              className: parent.className,
              rect: box(rect),
              clientHeight: parent.clientHeight,
              scrollHeight: parent.scrollHeight,
              scrollTop: parent.scrollTop,
            });
        }
        return { clip, chain };
      },
    ] as const;
    const [inside] = [
      (
        rect: { left: number; top: number; right: number; bottom: number },
        clip: { left: number; top: number; right: number; bottom: number },
      ) =>
        rect.left >= clip.left &&
        rect.top >= clip.top &&
        rect.right <= clip.right &&
        rect.bottom <= clip.bottom,
    ] as const;
    const [visible] = [
      (part: Element) =>
        part.getClientRects().length > 0 && getComputedStyle(part).visibility === 'visible',
    ] as const;
    const labels = Array.from(input.labels ?? []).filter(
      (part) => part.closest('dialog') === dialog && visible(part),
    );
    const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const descriptions = ids
      .map((id) => input.ownerDocument.getElementById(id))
      .filter(
        (part): part is HTMLElement => !!part && part.closest('dialog') === dialog && visible(part),
      );
    const parts = [
      ...labels.map((part) => ({ source: 'label', part })),
      ...descriptions.map((part) => ({ source: 'description', part })),
    ].map(({ source, part }) => {
      const { clip, chain } = clipFor(part),
        rect = box(part.getBoundingClientRect());
      const glyphs: { character: string; rect: ReturnType<typeof box>; inside: boolean }[] = [];
      let missing = 0;
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('textarea')) continue;
        let offset = 0;
        for (const character of node.textContent ?? '') {
          const end = offset + character.length;
          if (character.trim()) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, end);
            const rects = Array.from(range.getClientRects());
            if (!rects.length) missing++;
            glyphs.push(
              ...rects.map((glyph) => ({
                character,
                rect: box(glyph),
                inside: inside(glyph, clip),
              })),
            );
          }
          offset = end;
        }
      }
      return {
        source,
        id: part.id,
        rect,
        clip,
        chain,
        inside: inside(rect, clip),
        glyphs,
        missing,
        glyphsInside: missing === 0 && glyphs.every((glyph) => glyph.inside),
      };
    });
    const control = box(input.getBoundingClientRect()),
      { clip, chain } = clipFor(input),
      style = getComputedStyle(input);
    const outset = Math.max(
      0,
      (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
    );
    const paint = {
      left: control.left - outset,
      top: control.top - outset,
      right: control.right + outset,
      bottom: control.bottom + outset,
    };
    const semantic = {
      left: Math.min(paint.left, ...parts.map((part) => part.rect.left)),
      top: Math.min(paint.top, ...parts.map((part) => part.rect.top)),
      right: Math.max(paint.right, ...parts.map((part) => part.rect.right)),
      bottom: Math.max(paint.bottom, ...parts.map((part) => part.rect.bottom)),
    };
    return {
      testId: input.dataset.testid,
      focused: document.activeElement === input,
      focusVisible: input.matches(':focus-visible'),
      control,
      clip,
      chain,
      parts,
      ids,
      semantic,
      fits: semantic.bottom - semantic.top <= clip.bottom - clip.top,
      complete: parts.length > 0 && parts.every((part) => part.inside && part.glyphsInside),
      allDescriptionsPresent: descriptions.length === ids.length,
      titleCodepoints: Array.from(input.closest('label')?.querySelector('span')?.textContent ?? '')
        .length,
      paint: { rect: paint, outset, style: style.outlineStyle, inside: inside(paint, clip) },
      center:
        document.elementFromPoint(
          control.left + control.width / 2,
          control.top + control.height / 2,
        ) === input,
      textarea:
        input instanceof HTMLTextAreaElement
          ? {
              value: input.value,
              scrollHeight: input.scrollHeight,
              clientHeight: input.clientHeight,
              scrollWidth: input.scrollWidth,
              clientWidth: input.clientWidth,
              selectionStart: input.selectionStart,
              selectionEnd: input.selectionEnd,
            }
          : null,
      calibration: {
        exactBoundary: inside({ ...clip }, clip),
        quarterPixelOverflowRejected: !inside({ ...clip, bottom: clip.bottom + 0.25 }, clip),
        quarterPixelPaintRejected: !inside({ ...clip, top: clip.top - 0.25 }, clip),
      },
    };
  });
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
      if (fiber.memoizedProps?.editor) {
        const snapshot = fiber.memoizedProps.editor.getSnapshot();
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
    throw new Error('The actual EditorSession is required.');
  });
}

async function pointer(n: NativeHarness, target: Locator, name: string) {
  await target.evaluate((element) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const [state] = [
      () => ({
        rect: input.getBoundingClientRect().toJSON(),
        scrollTop: input.closest('dialog')!.scrollTop,
        checked: input instanceof HTMLInputElement ? input.checked : null,
        caret:
          input instanceof HTMLTextAreaElement
            ? { start: input.selectionStart, end: input.selectionEnd }
            : null,
      }),
    ] as const;
    const log: unknown[] = [];
    input.addEventListener('pointerdown', () => log.push({ event: 'down', ...state() }), {
      once: true,
    });
    document.addEventListener(
      'pointerup',
      (event) => {
        log.push({ event: 'up', targetIsInput: event.target === input, ...state() });
        input.dataset.pointerEvidence = JSON.stringify(log);
      },
      { once: true },
    );
  });
  const before = await target.evaluate((element) => ({
    rect: element.getBoundingClientRect().toJSON(),
    checked: element instanceof HTMLInputElement ? element.checked : null,
  }));
  const hit = await target.boundingBox();
  assert.ok(hit);
  await n.page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await n.page.mouse.down();
  await frames(n);
  const held = await target.evaluate((element) => ({
    rect: element.getBoundingClientRect().toJSON(),
    focusVisible: element.matches(':focus-visible'),
    caret:
      element instanceof HTMLTextAreaElement
        ? { start: element.selectionStart, end: element.selectionEnd }
        : null,
  }));
  await n.page.mouse.up();
  const after = await target.evaluate((element) => ({
    rect: element.getBoundingClientRect().toJSON(),
    checked: element instanceof HTMLInputElement ? element.checked : null,
    caret:
      element instanceof HTMLTextAreaElement
        ? { start: element.selectionStart, end: element.selectionEnd }
        : null,
    evidence: JSON.parse((element as HTMLElement).dataset.pointerEvidence ?? 'null') as {
      event: string;
      targetIsInput?: boolean;
      rect: unknown;
    }[],
  }));
  record(name, { before, held, after });
  assert.deepEqual(
    held.rect,
    before.rect,
    'Pointer focus must not move its target during the press.',
  );
  assert.deepEqual(after.rect, before.rect);
  assert.ok(after.evidence.find((event) => event.event === 'up')?.targetIsInput);
  if (after.checked !== null) assert.equal(after.checked, !before.checked);
  else {
    assert.equal(
      held.focusVisible,
      true,
      'Textarea pointer focus also paints a focus-visible outline.',
    );
    assert.deepEqual(after.caret, held.caret);
    assert.equal(after.caret?.start, after.caret?.end);
    const value = await target.inputValue(),
      caret = after.caret!.start;
    await n.page.keyboard.type('!');
    assert.equal(await target.inputValue(), value.slice(0, caret) + '!' + value.slice(caret));
    await n.page.keyboard.press('Backspace');
    assert.equal(await target.inputValue(), value);
  }
  await capture(n, name);
}

test(
  'context focus reveals the complete task and exact version descriptions in seven native groups without moving pointer targets',
  { skip: process.platform !== 'darwin', timeout: 120000 },
  async () => {
    const f = fixture(),
      beforeHashes = fingerprints();
    const n = await launchNative({
      entry: root,
      userData: join(f.directoryRoot, 'Private focus profile'),
    });
    const observations: unknown[] = [],
      issues: unknown[] = [];
    let clipboardDevice: ClipboardFixture | undefined;
    record('start-source', beforeHashes);
    const check = async (target: Locator, group: string, direction: string) => {
      const result = await measure(target);
      observations.push({ group, direction, result });
      record('observations', observations);
      assert.ok(Object.values(result.calibration).every(Boolean));
      assert.equal(result.allDescriptionsPresent, true);
      if (!(
        result.focused &&
        result.focusVisible &&
        result.fits &&
        result.complete &&
        result.paint.inside &&
        result.center
      ))
        issues.push({
          group,
          direction,
          testId: result.testId,
          complete: result.complete,
          paint: result.paint.inside,
          fits: result.fits,
        });
      if (result.textarea)
        assert.ok(
          result.textarea.scrollHeight <= result.textarea.clientHeight &&
            result.textarea.scrollWidth <= result.textarea.clientWidth,
        );
      else assert.equal(result.titleCodepoints, 240);
    };
    try {
      clipboardDevice = await installClipboardFixture(n, 'context-focus');
      assert.deepEqual(await clipboardSink(n), []);
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.page.getByTestId('workbench').waitFor();
      await n.page.getByTestId('settings-button').click();
      await n.page.getByTestId('locale-select').selectOption('en');
      await n.page.getByTestId('text-scale-select').selectOption('1');
      await n.page.keyboard.press('Escape');
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId('space-search').fill(title);
      await n.page.getByTestId(`object-row-${f.original.id}`).click();
      await n.page.getByTestId('markdown-input').click();
      await n.page.keyboard.press('Meta+End');
      await n.page.keyboard.type(' Preserved human writing.');
      await n.page.waitForFunction(() =>
        document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
      );
      await n.page.keyboard.press('ArrowLeft');
      const humanBefore = await editorState(n);
      await n.page.locator('#history-button').click();
      await n.page.locator('#history-r1').click();
      for (const group of groups) {
        await n.setWindowBounds({ width: 1200, height: 850 });
        await n.page.getByTestId('settings-button').click();
        await n.page.getByTestId('locale-select').selectOption(group.locale);
        await n.page.getByTestId('text-scale-select').selectOption(String(group.scale));
        await n.page.keyboard.press('Escape');
        const geometry = await n.setWindowBounds(group);
        const controlledRequest = {
          width: Math.min(group.width, geometry.controlledMaximum?.width ?? group.width),
          height: Math.min(group.height, geometry.controlledMaximum?.height ?? group.height),
        };
        record(`${group.id}-geometry`, { ...geometry, controlledRequest });
        for (const dimension of ['width', 'height'] as const) {
          assert.equal(geometry.requestedWindow?.[dimension], group[dimension]);
          const requested = controlledRequest[dimension],
            actual = geometry.bounds[dimension],
            available = geometry.workArea[dimension];
          // Native window managers may clamp an oversized request to the work area.
          assert.ok(
            actual === requested || (requested > available && actual === available),
            `${dimension}: native ${actual}, controlled request ${requested}, work area ${available}`,
          );
        }
        assert.equal(geometry.zoomFactor, group.scale);
        await n.page.getByTestId('prepare-source-context').click();
        const prep = n.page.getByTestId('context-preparation'),
          task = prep.getByTestId('context-task');
        await n.page.waitForFunction(
          () =>
            document.querySelectorAll('[data-testid="context-preparation"] input[type="checkbox"]')
              .length === 2,
        );
        if (group.id === 'en-688') {
          await pointer(n, task, 'task-pointer');
          await n.page.keyboard.press('Shift+Tab');
        }
        await tabTo(n, task);
        if (group.id === 'en-normal') await n.page.keyboard.type(taskText);
        assert.equal(await task.inputValue(), taskText);
        await check(task, group.id, 'Tab');
        await capture(n, `${group.id}-task`);
        const choices = await prep.locator('input[type="checkbox"]').all();
        for (const [index, choice] of choices.entries()) {
          await tabTo(n, choice);
          await check(choice, group.id, 'Tab');
          await capture(n, `${group.id}-choice-${index}`);
        }
        if (group.id === 'en-688') {
          // Blur through real dialog padding while the keyboard-exposed checkbox stays visible.
          const exposed = await measure(choices[1]!);
          await n.page.mouse.click(
            exposed.clip.left + 1,
            exposed.control.top + exposed.control.height / 2,
          );
          assert.equal(
            await choices[1]!.evaluate((element) => document.activeElement === element),
            false,
          );
          await pointer(n, choices[1]!, 'checkbox-pointer');
          await n.page.keyboard.press('Space');
          assert.equal(await choices[1]!.isChecked(), false);
        }
        for (const choice of [...choices].reverse()) {
          await tabTo(n, choice, true);
          await check(choice, group.id, 'Shift+Tab');
        }
        await tabTo(n, task, true);
        await check(task, group.id, 'Shift+Tab');
        if (group.id === 'es-681') {
          await tabTo(n, choices[1]!);
          await n.page.keyboard.press('Space');
          assert.equal(await choices[1]!.isChecked(), true);
          const copy = prep.getByTestId('copy-context-brief');
          await tabTo(n, copy);
          await n.page.keyboard.press('Enter');
          await prep.getByTestId('context-brief-copied').waitFor();
          const copied = await clipboardSink(n);
          record('clipboard-device-sink-writes', copied);
          assert.equal(copied.length, 1);
          assert.equal(copied[0]!.type, null);
          const brief = JSON.parse(copied[0]!.text);
          assert.equal(brief.task, taskText);
          assert.deepEqual(
            brief.references.map((reference: { ref: unknown }) => reference.ref),
            [
              { mode: 'pinned', objectId: f.original.id, revision: 1 },
              { mode: 'pinned', objectId: f.asset.id, revision: 1 },
            ],
          );
          assert.deepEqual(
            brief.references.map((reference: { title: string }) => reference.title),
            [title, title],
          );
          record(
            'exact-pins',
            brief.references.map((reference: { ref: unknown; title: string }) => ({
              ref: reference.ref,
              title: reference.title,
            })),
          );
          await tabTo(n, prep.getByTestId('context-agent-access'));
          await n.page.keyboard.press('Enter');
          await n.page.getByTestId('settings-dialog').waitFor();
          assert.equal(ok(f.human.listGrants()).length, 0);
          await n.page.keyboard.press('Escape');
          await prep.waitFor();
        }
        await n.page.keyboard.press('Escape');
        const reader = n.page.getByTestId('source-reader');
        assert.equal(await reader.getByRole('heading', { level: 1 }).textContent(), title);
      }
      await n.page.getByTestId('source-back').click();
      const humanAfter = await editorState(n);
      record('postconditions', {
        humanBefore,
        humanAfter,
        grants: ok(f.human.listGrants()),
        fixedOriginal: ok(f.human.readObject({ objectId: f.original.id, revision: 1 })).object,
        fixedAsset: ok(f.human.readObject({ objectId: f.asset.id, revision: 1 })).object,
      });
      assert.deepEqual(humanAfter, humanBefore);
      assert.equal(
        ok(f.human.readObject({ objectId: f.original.id, revision: 1 })).object.content.body,
        'Fixed original K1.',
      );
      assert.equal(
        ok(f.human.readObject({ objectId: f.asset.id, revision: 1 })).object.content.body,
        'Fixed asset K1.',
      );
      assert.equal(ok(f.human.listGrants()).length, 0);
      assert.deepEqual(n.pageErrors, []);
      record('strict-failures', issues);
      assert.deepEqual(
        issues,
        [],
        'Every fitting semantic unit and its paint must fit at strict zero epsilon.',
      );
    } finally {
      try {
        record('last-window', await n.logWindow('context-focus-last').catch(() => null));
        record('page-errors', n.pageErrors);
      } finally {
        try {
          if (clipboardDevice) {
            const restored = await clipboardDevice.restore();
            record('clipboard-device-sink-cleanup', restored);
            assert.equal(restored.writeTextRestored, true);
            assert.equal(restored.handlerSameAsInstalled, true);
          }
        } finally {
          await n.close();
          const afterHashes = fingerprints();
          record('end-source', afterHashes);
          f.dispose();
          assert.deepEqual(afterHashes, beforeHashes);
        }
      }
    }
  },
);
