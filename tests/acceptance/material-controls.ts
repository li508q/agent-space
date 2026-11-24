import assert from 'node:assert/strict';
import type { Locator } from 'playwright-core';
import type { NativeHarness } from './native-harness.js';

export async function tabToControl(native: NativeHarness, target: Locator) {
  for (let count = 0; count < 160; count++) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await native.page.keyboard.press('Tab');
  }
  assert.fail('Natural Tab did not reach the material control.');
}

/** Measure complete text and focus paint against the actual scroll ancestors. */
export async function readableControl(target: Locator) {
  const result = await target.evaluate((element) => {
    const input = element as HTMLElement,
      label = input.closest('label') ?? input,
      parts = [
        label,
        ...(input.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id))
          .filter((part): part is HTMLElement => !!part),
      ],
      clip = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
    // Native control overflow clips its value, not its external label or focus ring.
    for (
      let parent: HTMLElement | null = input.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent),
        rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, rect.top + (parseFloat(style.borderTopWidth) || 0));
        clip.bottom = Math.min(
          clip.bottom,
          rect.bottom - (parseFloat(style.borderBottomWidth) || 0),
        );
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, rect.left + (parseFloat(style.borderLeftWidth) || 0));
        clip.right = Math.min(clip.right, rect.right - (parseFloat(style.borderRightWidth) || 0));
      }
    }
    const boxes = parts.map((part) => part.getBoundingClientRect()),
      glyphs: DOMRect[] = [];
    for (const part of parts) {
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
      while (walker.nextNode())
        if (walker.currentNode.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          glyphs.push(...range.getClientRects());
        }
    }
    const control = input.getBoundingClientRect(),
      style = getComputedStyle(input),
      outset = Math.max(
        0,
        (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
      ),
      hit = document.elementFromPoint(
        control.left + control.width / 2,
        control.top + control.height / 2,
      );
    const [inside] = [
      (r: DOMRect) =>
        r.top >= clip.top &&
        r.bottom <= clip.bottom &&
        r.left >= clip.left &&
        r.right <= clip.right,
    ];
    return {
      focused: document.activeElement === input,
      complete: boxes.every(inside),
      glyphsComplete: glyphs.every(inside),
      paint:
        control.top - outset >= clip.top &&
        control.bottom + outset <= clip.bottom &&
        control.left - outset >= clip.left &&
        control.right + outset <= clip.right,
      center: !!hit && (hit === input || input.contains(hit)),
      clip,
      boxes: boxes.map((r) => r.toJSON()),
      glyphs: glyphs.map((r) => r.toJSON()),
      control: control.toJSON(),
      outset,
    };
  });
  for (const key of ['focused', 'complete', 'glyphsComplete', 'paint', 'center'] as const)
    assert.equal(result[key], true, `Material control failed ${key}: ${JSON.stringify(result)}`);
  return result;
}

export async function writingState(native: NativeHarness) {
  return native.page.getByTestId('document-pane').evaluate((element) => {
    type Editor = {
      getSnapshot(): {
        editorId: string;
        generation: number;
        revision: number | null;
        content: { body: string };
        saveState: string;
        draftError: string | null;
        error: string | null;
      };
    };
    type Fiber = { memoizedProps?: { editor?: Editor }; return?: Fiber | null };
    let fiber = (element as unknown as Record<string, unknown>)[
      Object.keys(element).find((key) => key.startsWith('__reactFiber$'))!
    ] as Fiber | null;
    while (fiber) {
      if (fiber.memoizedProps?.editor) {
        const state = fiber.memoizedProps.editor.getSnapshot(),
          input = element.querySelector('[data-testid="markdown-input"]') as HTMLElement & {
            cmTile?: {
              view?: { state: { selection: { main: { anchor: number; head: number } } } };
              root?: {
                view?: { state: { selection: { main: { anchor: number; head: number } } } };
              };
            };
          };
        const view = input.cmTile?.view ?? input.cmTile?.root?.view;
        if (!view) throw new Error('Actual CodeMirror state is required.');
        return {
          id: state.editorId,
          generation: state.generation,
          revision: state.revision,
          body: state.content.body,
          saveState: state.saveState,
          draftError: state.draftError,
          error: state.error,
          caret: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
        };
      }
      fiber = fiber.return ?? null;
    }
    throw new Error('Actual EditorSession is required.');
  });
}
