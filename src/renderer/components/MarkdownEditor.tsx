import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { EditorSession } from '../state/editor.js';
import { t, type Locale } from '../i18n/index.js';

const phraseKeys = {
  Find: 'cm.find',
  Replace: 'cm.replace',
  next: 'cm.next',
  previous: 'cm.previous',
  all: 'cm.all',
  'match case': 'cm.matchCase',
  regexp: 'cm.regexp',
  'by word': 'cm.byWord',
  replace: 'cm.replace',
  'replace all': 'cm.replaceAll',
  close: 'cm.close',
  'current match': 'cm.currentMatch',
  'on line': 'cm.onLine',
  'Go to line': 'cm.goToLine',
  go: 'cm.go',
  'replaced match on line $': 'cm.replacedLine',
  'replaced $ matches': 'cm.replacedMatches',
  'Control character': 'cm.controlCharacter',
} as const;
const phrases = (locale: Locale) =>
  Object.fromEntries(Object.entries(phraseKeys).map(([key, value]) => [key, t(locale, value)]));

export function MarkdownEditor({ editor, locale }: { editor: EditorSession; locale: Locale }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const editing = useRef(new Compartment());
  const syncing = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const initial = editor.getSnapshot().content.body;
    let locked = editor.getSnapshot().locked;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          EditorState.lineSeparator.of(initial.includes('\r\n') ? '\r\n' : '\n'),
          history(),
          drawSelection(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          editing.current.of([
            EditorState.readOnly.of(editor.getSnapshot().locked),
            EditorView.editable.of(!editor.getSnapshot().locked),
          ]),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...markdownKeymap]),
          language.current.of([
            EditorState.phrases.of(phrases(locale)),
            EditorView.contentAttributes.of({
              'aria-label': t(locale, 'diff.body'),
              'data-testid': 'markdown-input',
              spellcheck: 'true',
            }),
          ]),
          EditorView.domEventHandlers({
            compositionstart: () => {
              editor.setComposing(true);
              return false;
            },
            compositionend: () => {
              queueMicrotask(() => editor.setComposing(false));
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current) editor.setBody(update.state.sliceDoc());
          }),
        ],
      }),
    });
    view.current = instance;
    const unsubscribe = editor.subscribe(() => {
      const state = editor.getSnapshot();
      if (state.locked !== locked) {
        locked = state.locked;
        instance.dispatch({
          effects: editing.current.reconfigure([
            EditorState.readOnly.of(locked),
            EditorView.editable.of(!locked),
          ]),
        });
      }
      if (state.composing || instance.composing) return;
      const next = state.content.body;
      if (instance.state.sliceDoc() !== next) {
        syncing.current = true;
        instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: next } });
        syncing.current = false;
      }
    });
    return () => {
      unsubscribe();
      instance.destroy();
      view.current = null;
    };
    // Editor identity alone owns document initialization. Locale does not remount the buffer.
  }, [editor]);
  useEffect(() => {
    let active = true;
    void editor.afterComposition().then(() => {
      if (active)
        view.current?.dispatch({
          effects: language.current.reconfigure([
            EditorState.phrases.of(phrases(locale)),
            EditorView.contentAttributes.of({
              'aria-label': t(locale, 'diff.body'),
              'data-testid': 'markdown-input',
              spellcheck: 'true',
            }),
          ]),
        });
    });
    return () => {
      active = false;
    };
  }, [editor, locale]);
  return <div className="markdown-editor" ref={host} data-testid="markdown-editor" />;
}
