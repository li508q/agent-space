import { useState, useSyncExternalStore } from 'react';
import { Check, ChevronLeft, History, Link2, PanelRight, Save } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectRef } from '../../contracts/schema.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { EditorSession } from '../state/editor.js';
import { t, titleText } from '../i18n/index.js';
import { ErrorNotice, ObjectMetadata, SafeMarkdown, useLocale } from '../ui.js';
import { MarkdownEditor } from './MarkdownEditor.js';

export function DocumentPane({
  editor,
  api,
  session,
  onOpen,
  onHistory,
  onDetails,
  onBrowse,
  compact,
  onProjectMaterial,
}: {
  editor: EditorSession;
  api: DesktopApi;
  session: SpaceSession;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
  onHistory: () => void;
  onDetails: () => void;
  onBrowse: () => void;
  compact: boolean;
  onProjectMaterial: (id: string) => void;
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [preview, setPreview] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyError, setCopyError] = useState<ErrorCode | null>(null);
  const writable = state.kind === 'document' && state.object?.lifecycle !== 'archived';
  const sourceCount = state.content.relations.filter(
    (relation) => relation.predicate === 'source',
  ).length;
  const relationCount = state.content.relations.length - sourceCount;
  const saveKeys = {
    saved: 'editor.saved',
    dirty: 'editor.unsaved',
    saving: 'editor.saving',
    checking: 'editor.checking',
    conflict: 'editor.notSaved',
    error: 'editor.notSaved',
  } as const;
  return (
    <section className="document-pane" data-testid="document-pane">
      <header className="document-header">
        <div className="document-tools as-actions">
          {compact && (
            <button onClick={onBrowse}>
              <ChevronLeft size={16} />
              {t(locale, 'ui.browse')}
            </button>
          )}
          <span className="kind-label">
            {state.kind === 'document'
              ? t(locale, 'object.note')
              : state.kind === 'project'
                ? t(locale, 'nav.projects')
                : t(locale, state.kind === 'record' ? 'object.record' : 'object.asset')}
          </span>
          <div className="push as-actions">
            <button id="history-button" onClick={onHistory} disabled={!state.objectId}>
              <History size={16} />
              {t(locale, 'history.title')}
            </button>
            <button id="details-button" onClick={onDetails}>
              <PanelRight size={16} />
              {t(locale, 'common.details')}
            </button>
          </div>
        </div>
        {writable ? (
          <input
            className="document-title"
            aria-label={t(locale, 'object.title')}
            data-testid="document-title"
            value={state.content.title}
            readOnly={state.locked}
            placeholder={t(locale, 'object.untitledNote')}
            maxLength={240}
            onChange={(event) => editor.setTitle(event.target.value)}
            onCompositionStart={() => editor.setComposing(true)}
            onCompositionEnd={() => editor.setComposing(false)}
          />
        ) : (
          <h1>{titleText(locale, state.content.title, state.kind)}</h1>
        )}
        <div className="save-row as-actions">
          <span
            role="status"
            aria-live="polite"
            data-testid="save-state"
            className={`save-state ${state.saveState}`}
          >
            {state.saveState === 'saved' && <Check size={14} />}{' '}
            {t(locale, saveKeys[state.saveState])}
          </span>
          {state.draft?.retained && state.draft.generation === state.generation && (
            <span className="draft-state">{t(locale, 'editor.draftKept')}</span>
          )}
          {state.revision && (
            <small>{t(locale, 'source.version', { version: state.revision })}</small>
          )}
          <div className="push as-actions">
            {writable && (
              <>
                <button aria-pressed={!preview} onClick={() => setPreview(false)}>
                  {t(locale, 'editor.write')}
                </button>
                <button aria-pressed={preview} onClick={() => setPreview(true)}>
                  {t(locale, 'editor.preview')}
                </button>
              </>
            )}
            {(writable || editor.dirty) && (
              <button
                data-testid="save-now"
                onClick={() => {
                  void editor.saveNow();
                }}
                disabled={state.saveState === 'saving'}
              >
                <Save size={16} />
                {t(locale, 'editor.saveNow')}
              </button>
            )}
          </div>
        </div>
        {(sourceCount > 0 || relationCount > 0) && (
          <div className="connection-summary as-actions" data-testid="connection-summary">
            <Link2 size={14} aria-hidden="true" />
            {sourceCount > 0 && (
              <button className="text-button" onClick={onDetails} data-testid="note-sources">
                {t(locale, 'ui.sourcesCount', { count: sourceCount })}
              </button>
            )}
            {relationCount > 0 && (
              <button className="text-button" onClick={onDetails} data-testid="note-relations">
                {t(locale, 'ui.relationsCount', { count: relationCount })}
              </button>
            )}
          </div>
        )}
        <ErrorNotice
          code={state.error}
          onRetry={() => {
            void editor.saveNow();
          }}
        />
        {state.draftError && (
          <ErrorNotice
            code={state.draftError}
            onRetry={() => {
              void editor.keepDraft();
            }}
          />
        )}
        <ErrorNotice code={copyError} />
        {(state.error || state.draftError) && (
          <div className="as-actions">
            <button
              onClick={() => {
                void api
                  .copyText({ text: state.content.body })
                  .then((result) => {
                    if (result.ok) setCopyFeedback(true);
                    else setCopyError(result.error.code);
                  })
                  .catch(() => setCopyError('OPERATION_UNKNOWN'));
              }}
            >
              {t(locale, 'editor.copyEdits')}
            </button>
            {copyFeedback && <span role="status">{t(locale, 'common.copied')}</span>}
          </div>
        )}
        {state.remote && (
          <p className="attention" role="status">
            {t(locale, 'editor.conflict')}{' '}
            <button
              className="text-button"
              onClick={() => onOpen({ mode: 'current', objectId: state.remote!.object.id })}
            >
              {t(locale, 'source.viewCurrent')}
            </button>
          </p>
        )}
        {state.savedGeneration < 0 && (
          <p className="attention">{t(locale, 'ui.resumeDraftNotice')}</p>
        )}
        {state.object?.lifecycle === 'archived' && (
          <p className="attention">{t(locale, 'ui.archiveOutcome')}</p>
        )}
      </header>
      <div className="document-scroll as-scroll-region" id="document-scroll">
        <div className="document-sheet">
          {writable ? (
            <>
              <div hidden={preview}>
                <MarkdownEditor editor={editor} locale={locale} />
              </div>
              {preview && (
                <article className="as-prose markdown-preview">
                  <SafeMarkdown text={state.content.body} api={api} />
                </article>
              )}
            </>
          ) : (
            <>
              <p className="secondary">{t(locale, 'ui.readOnlyKind')}</p>
              <article className="as-prose">
                <SafeMarkdown text={state.content.body} api={api} />
              </article>
              <ObjectMetadata content={state.content} api={api} session={session} onOpen={onOpen} />
              {state.kind === 'project' && state.objectId && (
                <button onClick={() => onProjectMaterial(state.objectId!)}>
                  {t(locale, 'ui.projectMaterial')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
