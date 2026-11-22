import { useRef, useState, useSyncExternalStore } from 'react';
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

export function DetailsPane({
  api,
  session,
  editor,
  onClose,
  onOpen,
  onRefresh,
  onFields,
  onRelations,
}: {
  api: DesktopApi;
  session: SpaceSession;
  editor: EditorSession;
  onClose: () => void;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
  onRefresh: () => void;
  onFields: () => void;
  onRelations: () => void;
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const makeTask = useTaskFactory();
  const task = useRef<OperationTask<KnowledgeReview> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const reviewed = state.object?.knowledgeReview;
  const currentReviewed = reviewed?.reviewedRevision === state.revision && !editor.dirty;
  async function markReviewed() {
    if (!state.objectId || !state.revision || editor.dirty) return;
    if (!task.current || task.current.settled) {
      const input = { operationKey: newKey('knowledge'), ref: pin(state.objectId, state.revision) };
      task.current = makeTask(input.operationKey, () =>
        api.markKnowledgeReviewed(bound(session, input)),
      );
    }
    setBusy(true);
    setError(null);
    try {
      const result = await task.current.run();
      if (!result.ok) setError(result.error.code);
      else onRefresh();
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="context-pane" aria-label={t(locale, 'common.details')}>
      <header>
        <h2>{t(locale, 'common.details')}</h2>
        <button className="icon-button" aria-label={t(locale, 'common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="context-scroll as-scroll-region">
        <section>
          <h3>{t(locale, 'knowledge.knowledge')}</h3>
          <p className={currentReviewed ? 'positive' : 'secondary'}>
            {t(
              locale,
              currentReviewed
                ? 'knowledge.reviewed'
                : reviewed
                  ? 'knowledge.needsReview'
                  : 'knowledge.notReviewed',
            )}
          </p>
          {reviewed && (
            <small>
              <Time value={reviewed.reviewedAt} />
            </small>
          )}
          <p className="secondary">{t(locale, 'knowledge.reviewNotice')}</p>
          <button
            onClick={() => {
              void markReviewed();
            }}
            disabled={busy || editor.dirty || !state.objectId || currentReviewed}
          >
            {t(locale, 'knowledge.markReviewed')}
          </button>
          <ErrorNotice
            code={error}
            onRetry={() => {
              void markReviewed();
            }}
          />
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
        {state.object && state.object.lifecycle === 'active' && (
          <ProposalPermissions
            api={api}
            session={session}
            object={state.object}
            disabled={editor.dirty || state.composing || state.locked || busy}
            onChanged={onRefresh}
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
