import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronLeft, History, Link2, PanelRight, Save } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectContent, ObjectRef } from '../../contracts/schema.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectSnapshot } from '../../contracts/core.js';
import type { EditorSession } from '../state/editor.js';
import { t, titleText } from '../i18n/index.js';
import { ErrorNotice, fieldText, ObjectMetadata, SafeMarkdown, useLocale } from '../ui.js';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor.js';
import { CopySavedContext } from './CopySavedContext.js';
import { LinkedMaterial } from './LinkedMaterial.js';
import { ProjectOverview, projectSection } from './ProjectOverview.js';

export function DocumentPane({
  editor,
  api,
  session,
  onOpen,
  onPrepare,
  onHistory,
  onDetails,
  onBrowse,
  compact,
  onProjectMaterial,
  onFields,
  onReuseFields,
  refresh,
  writingRequest = 0,
  onReturnReading,
  existingDraft = false,
  restoreMaterialCount,
  restoreReferenceCounts,
}: {
  editor: EditorSession;
  api: DesktopApi;
  session: SpaceSession;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
  onPrepare: (object: ObjectSnapshot, trigger: string) => void;
  onHistory: () => void;
  onDetails: () => void;
  onBrowse: () => void;
  compact: boolean;
  onProjectMaterial: (id: string) => void;
  onFields: () => void;
  onReuseFields: (properties: ObjectContent['properties']) => void;
  refresh: number;
  writingRequest?: number;
  onReturnReading?: () => void;
  existingDraft?: boolean;
  restoreMaterialCount?: number;
  restoreReferenceCounts?: { continuation: number; assets: number };
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [preview, setPreview] = useState(false);
  const [projectWriting, setProjectWriting] = useState(() => writingRequest > 0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyError, setCopyError] = useState<ErrorCode | null>(null);
  const markdown = useRef<MarkdownEditorHandle>(null);
  const writable = state.object?.lifecycle !== 'archived';
  const overview = state.kind === 'project' && !projectWriting;
  function writeProject() {
    const origin = document.activeElement,
      generation = editor.getSnapshot().generation;
    setProjectWriting(true);
    setPreview(false);
    requestAnimationFrame(() => {
      if (document.activeElement === origin && editor.getSnapshot().generation === generation)
        document
          .querySelector<HTMLElement>(
            `[data-editor-id="${state.editorId}"] [data-testid="markdown-input"]`,
          )
          ?.focus();
    });
  }
  useEffect(() => {
    if (writingRequest > 0) {
      setProjectWriting(true);
      setPreview(false);
      const origin = document.activeElement,
        snapshot = editor.getSnapshot();
      // A person may already have moved to another control after the route mounted.
      if (
        origin instanceof HTMLElement &&
        origin.closest('.document-pane')?.getAttribute('data-editor-id') === snapshot.editorId &&
        origin.getClientRects().length
      )
        return;
      const frame = requestAnimationFrame(() => {
        const active = document.activeElement,
          sourceLostFocus =
            active === document.body &&
            origin instanceof HTMLElement &&
            !!origin.closest('.source-reader') &&
            !origin.getClientRects().length;
        if (
          (active === origin || sourceLostFocus) &&
          editor.getSnapshot().generation === snapshot.generation &&
          !document.querySelector('dialog[open]')
        ) {
          const input = document.querySelector<HTMLElement>(
            `[data-editor-id="${snapshot.editorId}"] [data-testid="markdown-input"]`,
          );
          if (input?.getClientRects().length) input.focus();
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editor, writingRequest]);
  const placeholder = {
    document: 'object.untitledNote',
    project: 'object.untitledProject',
    record: 'object.untitledRecord',
    asset: 'object.untitledAsset',
  } as const;
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
    <section
      className="document-pane"
      data-testid="document-pane"
      data-editor-id={state.editorId}
      data-project-view={state.kind === 'project' ? (overview ? 'overview' : 'write') : undefined}
    >
      <header className="document-header">
        <div className="document-tools as-actions">
          {onReturnReading && (
            <button
              data-testid="return-to-reading"
              onClick={onReturnReading}
              disabled={state.locked}
            >
              <ChevronLeft size={16} />
              {t(locale, 'source.returnReading')}
            </button>
          )}
          {compact && (
            <button onClick={onBrowse} disabled={state.locked}>
              <ChevronLeft size={16} />
              {t(locale, 'ui.browse')}
            </button>
          )}
          <span className="kind-label">
            {state.kind === 'document'
              ? t(locale, 'object.note')
              : state.kind === 'project'
                ? t(locale, 'org.project')
                : t(locale, state.kind === 'record' ? 'object.record' : 'object.asset')}
          </span>
          <div className="push as-actions">
            <button
              id="history-button"
              onClick={onHistory}
              disabled={!state.objectId || state.locked}
            >
              <History size={16} />
              {t(locale, 'history.title')}
            </button>
            <button id="details-button" onClick={onDetails} disabled={state.locked}>
              <PanelRight size={16} />
              {t(locale, 'common.details')}
            </button>
          </div>
        </div>
        {writable && !overview ? (
          <input
            className="document-title"
            aria-label={t(locale, 'object.title')}
            data-testid="document-title"
            value={state.content.title}
            readOnly={state.locked}
            placeholder={t(locale, placeholder[state.kind])}
            maxLength={240}
            onChange={(event) => editor.setTitle(event.target.value)}
            onCompositionStart={() => editor.setComposing(true)}
            onCompositionEnd={() => editor.setComposing(false)}
          />
        ) : (
          <h1 tabIndex={-1}>{titleText(locale, state.content.title, state.kind)}</h1>
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
            {state.kind === 'project' && (
              <>
                <button
                  data-testid="project-overview-button"
                  aria-pressed={overview}
                  disabled={state.locked}
                  onClick={() => setProjectWriting(false)}
                >
                  {t(locale, 'project.overview')}
                </button>
                <button
                  data-testid="project-edit"
                  aria-pressed={!overview}
                  disabled={state.locked}
                  onClick={writeProject}
                >
                  {t(locale, writable ? 'project.editBody' : 'project.readBody')}
                </button>
              </>
            )}
            {writable && !overview && (
              <>
                <button
                  aria-pressed={!preview}
                  onClick={() => setPreview(false)}
                  disabled={state.locked}
                >
                  {t(locale, 'editor.write')}
                </button>
                <button
                  aria-pressed={preview}
                  onClick={() => setPreview(true)}
                  disabled={state.locked}
                >
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
                disabled={state.saveState === 'saving' || state.locked}
              >
                <Save size={16} />
                {t(locale, 'editor.saveNow')}
              </button>
            )}
            <button
              id={`prepare-context-${state.editorId}`}
              data-testid="prepare-document-context"
              disabled={!state.object || editor.dirty || state.composing || state.locked}
              title={t(locale, 'contextPrep.savedOnly')}
              onClick={() => {
                const current = editor.getSnapshot();
                if (
                  state.object &&
                  current.generation === state.generation &&
                  !editor.dirty &&
                  !current.composing &&
                  !current.locked
                )
                  onPrepare(state.object, `prepare-context-${state.editorId}`);
              }}
            >
              {t(locale, 'contextPrep.title')}
            </button>
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
        <CopySavedContext
          api={api}
          session={session}
          object={state.object}
          disabled={editor.dirty || state.composing || state.locked}
          selection={() => markdown.current?.selectedText() ?? null}
          stillCurrent={() =>
            editor.getSnapshot().generation === state.generation &&
            !editor.dirty &&
            !editor.getSnapshot().composing
          }
        />
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
        {existingDraft && editor.dirty && (
          <p className="attention" role="status">
            {t(locale, 'source.existingDraft', { version: state.revision ?? 0 })}
          </p>
        )}
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
        {overview && (
          <nav
            className="project-section-nav as-actions"
            aria-label={t(locale, 'project.overview')}
          >
            {(['goal', 'continuation', 'material', 'assets'] as const).map((section) => (
              <button
                key={section}
                data-testid={`project-section-${section}`}
                onClick={() => projectSection(section)}
              >
                {t(
                  locale,
                  section === 'assets'
                    ? 'project.assets'
                    : section === 'material'
                      ? 'project.material'
                      : section === 'continuation'
                        ? 'project.continuation'
                        : 'project.goal',
                )}
              </button>
            ))}
          </nav>
        )}
      </header>
      <div className="document-scroll as-scroll-region" id="document-scroll">
        <div className="document-sheet">
          {state.kind === 'project' && state.objectId && (
            <div hidden={!overview}>
              <ProjectOverview
                api={api}
                session={session}
                objectId={state.objectId}
                content={state.content}
                refresh={refresh}
                writable={writable}
                locked={state.locked}
                onEdit={writeProject}
                onOpen={onOpen}
                onProjectMaterial={() => onProjectMaterial(state.objectId!)}
                restoreMaterialCount={restoreMaterialCount}
                restoreReferenceCounts={restoreReferenceCounts}
              />
            </div>
          )}
          {state.kind === 'record' && (
            <section className="record-fields" data-testid="record-fields">
              <h2>{t(locale, 'diff.properties')}</h2>
              {Object.entries(state.content.properties).map(([key, field]) => (
                <dl className="property-row" key={key}>
                  <dt>{field.label}</dt>
                  <dd>{fieldText(locale, field)}</dd>
                </dl>
              ))}
              {!Object.keys(state.content.properties).length && (
                <p className="secondary">{t(locale, 'fields.emptyFields')}</p>
              )}
              <div className="as-actions">
                {writable && (
                  <button
                    data-testid="record-edit-fields"
                    disabled={state.locked}
                    onClick={onFields}
                  >
                    {t(locale, 'fields.edit')}
                  </button>
                )}
                <button
                  data-testid="record-reuse-fields"
                  disabled={state.locked}
                  onClick={() => onReuseFields(state.content.properties)}
                >
                  {t(locale, 'records.reuse')}
                </button>
              </div>
              <small className="secondary reuse-notice">{t(locale, 'records.reuseNotice')}</small>
            </section>
          )}
          {state.kind === 'asset' && state.object?.origin.mode === 'managed' && (
            <p className="secondary">{t(locale, 'org.assetHint')}</p>
          )}
          {writable ? (
            <>
              <div hidden={preview || overview}>
                <MarkdownEditor ref={markdown} editor={editor} locale={locale} />
              </div>
              {preview && !overview && (
                <article className="as-prose markdown-preview">
                  <SafeMarkdown text={state.content.body} api={api} />
                </article>
              )}
            </>
          ) : (
            <div hidden={overview}>
              <article className="as-prose">
                <SafeMarkdown text={state.content.body} api={api} />
              </article>
              <ObjectMetadata content={state.content} api={api} session={session} onOpen={onOpen} />
            </div>
          )}
          {state.objectId && state.kind === 'asset' && (
            <LinkedMaterial
              api={api}
              session={session}
              objectId={state.objectId}
              mode={state.kind}
              refresh={refresh}
              onOpen={onOpen}
            />
          )}
        </div>
      </div>
    </section>
  );
}
