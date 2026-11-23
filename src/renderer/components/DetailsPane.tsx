import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectRef } from '../../contracts/schema.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { KnowledgeReview } from '../../contracts/core.js';
import type { OperationTask } from '../state/operation.js';
import type { EditorSession } from '../state/editor.js';
import { t } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import {
  ErrorNotice,
  newKey,
  ObjectMetadata,
  pin,
  Time,
  useLocale,
  useTaskFactory,
} from '../ui.js';
import { ProposalPermissions } from './ProposalPermissions.js';
import { IncomingLinks } from './IncomingLinks.js';

export function DetailsPane({
  api,
  session,
  editor,
  onClose,
  onOpen,
  onRefresh,
  onMutationStarting,
  onFields,
  onRelations,
  hidden,
  refresh,
  onLifecycle,
  onRelink,
}: {
  api: DesktopApi;
  session: SpaceSession;
  editor: EditorSession;
  onClose: () => void;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
  onRefresh: () => Promise<void>;
  onMutationStarting: () => void;
  onFields: () => void;
  onRelations: () => void;
  hidden?: boolean;
  refresh: number;
  onLifecycle: () => void;
  onRelink: () => void;
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const makeTask = useTaskFactory();
  const task = useRef<OperationTask<KnowledgeReview> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const active = useRef(true),
    epoch = useRef(0);
  const refreshCurrent = useRef(onRefresh);
  refreshCurrent.current = onRefresh;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      epoch.current++;
    };
  }, [editor]);
  const head = state.headReview;
  const reviewed = head.data;
  const currentReviewed = head.fresh && reviewed?.knowledgeReviewState === 'current-reviewed';
  const canMark =
    head.fresh &&
    !!reviewed &&
    !!state.objectId &&
    state.revision === reviewed.currentRevision &&
    !editor.dirty &&
    !state.composing &&
    !state.locked &&
    !currentReviewed;
  async function markReviewed(retryOriginal = false) {
    if ((!retryOriginal || !task.current || task.current.settled) && !canMark) return;
    if (!task.current || task.current.settled) {
      if (!state.objectId || !reviewed) return;
      const input = {
        operationKey: newKey('knowledge'),
        ref: pin(state.objectId, reviewed.currentRevision),
      };
      task.current = makeTask(input.operationKey, () =>
        api.markKnowledgeReviewed(bound(session, input)),
      );
    }
    const selected = task.current,
      ticket = ++epoch.current;
    const current = () => active.current && ticket === epoch.current && selected === task.current;
    onMutationStarting();
    setBusy(true);
    setError(null);
    try {
      const result = await selected.run();
      if (!current()) return;
      if (!result.ok) setError(result.error.code);
      await refreshCurrent.current();
    } catch {
      if (current()) {
        setError('OPERATION_UNKNOWN');
        await refreshCurrent.current();
      }
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <aside className="context-pane" aria-label={t(locale, 'common.details')} hidden={hidden}>
      <header>
        <h2>{t(locale, 'common.details')}</h2>
        <button className="icon-button" aria-label={t(locale, 'common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="context-scroll as-scroll-region">
        <section>
          <h3>{t(locale, 'knowledge.versionReview')}</h3>
          <p
            className={currentReviewed ? 'positive' : 'secondary'}
            data-testid="knowledge-review-state"
            role={head.loading ? 'status' : undefined}
          >
            {t(
              locale,
              !head.fresh
                ? head.loading
                  ? 'knowledge.refreshing'
                  : 'knowledge.headUnknown'
                : currentReviewed
                  ? 'knowledge.reviewed'
                  : reviewed?.knowledgeReviewedRevision !== null
                    ? 'knowledge.needsReview'
                    : 'knowledge.notReviewed',
            )}
          </p>
          {head.fresh && reviewed && (
            <p className="secondary" data-testid="knowledge-review-versions">
              <span data-testid="knowledge-head-revision">
                {t(locale, 'knowledge.headVersion', { version: reviewed.currentRevision })}
              </span>
              {' · '}
              <span data-testid="knowledge-reviewed-revision">
                {reviewed.knowledgeReviewedRevision === null
                  ? t(locale, 'knowledge.noReviewedVersion')
                  : t(locale, 'knowledge.reviewedVersion', {
                      version: reviewed.knowledgeReviewedRevision,
                    })}
              </span>
            </p>
          )}
          {head.fresh && reviewed?.reviewedAt && (
            <small>
              <Time value={reviewed.reviewedAt} />
            </small>
          )}
          <p className="secondary">{t(locale, 'knowledge.reviewNotice')}</p>
          {editor.dirty && <p className="secondary">{t(locale, 'knowledge.dirtyNotice')}</p>}
          <button
            onClick={() => {
              void markReviewed();
            }}
            data-testid="mark-knowledge-reviewed"
            disabled={busy || !canMark || (!!task.current && !task.current.settled)}
          >
            {t(locale, 'knowledge.markReviewed')}
          </button>
          <ErrorNotice
            code={error}
            onRetry={() => {
              void markReviewed(true);
            }}
          />
          <ErrorNotice
            code={head.error}
            onRetry={() => {
              void onRefresh();
            }}
          />
          {!head.fresh && !head.loading && !head.error && (
            <button
              onClick={() => {
                void onRefresh();
              }}
            >
              {t(locale, 'knowledge.refresh')}
            </button>
          )}
        </section>
        {state.object?.lifecycle !== 'archived' && (
          <div className="as-actions metadata-edit-actions">
            <button data-testid="edit-fields" disabled={state.locked} onClick={onFields}>
              {t(locale, 'fields.edit')}
            </button>
            <button data-testid="edit-relationships" disabled={state.locked} onClick={onRelations}>
              {t(locale, 'relations.edit')}
            </button>
          </div>
        )}
        <ObjectMetadata content={state.content} api={api} session={session} onOpen={onOpen} />
        {state.objectId && (
          <IncomingLinks
            api={api}
            session={session}
            objectId={state.objectId}
            refresh={refresh}
            onOpen={onOpen}
          />
        )}
        {state.object && (
          <section>
            <button data-testid="set-lifecycle" disabled={state.locked} onClick={onLifecycle}>
              {t(
                locale,
                state.object.lifecycle === 'archived' ? 'lifecycle.restore' : 'lifecycle.archive',
              )}
            </button>
            <p className="secondary">{t(locale, 'lifecycle.notice')}</p>
            {state.object.kind === 'asset' && state.object.origin.mode === 'external-reference' && (
              <button
                data-testid="relink-asset"
                disabled={state.locked || state.object.lifecycle === 'archived'}
                onClick={onRelink}
              >
                {t(locale, 'relink.choose')}
              </button>
            )}
          </section>
        )}
        {state.object && state.object.lifecycle === 'active' && (
          <ProposalPermissions
            api={api}
            session={session}
            object={state.object}
            disabled={editor.dirty || state.composing || state.locked || busy}
            onChanged={() => {
              void onRefresh();
            }}
          />
        )}
        {state.object && (
          <section>
            <h3>{t(locale, 'source.sources')}</h3>
            <p>{state.object.origin.label || t(locale, 'space.local')}</p>
            <details>
              <summary>{t(locale, 'common.technicalDetails')}</summary>
              <dl>
                <dt>{t(locale, 'ui.type')}</dt>
                <dd>{state.object.kind}</dd>
                <dt>{t(locale, 'source.version', { version: state.object.revision })}</dt>
                <dd className="as-wrap">{state.object.id}</dd>
              </dl>
            </details>
          </section>
        )}
      </div>
    </aside>
  );
}
