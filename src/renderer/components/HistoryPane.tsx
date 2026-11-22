import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type {
  ObjectSnapshot,
  ObjectView,
  RevisionSummary,
  WriteResult,
} from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { t, titleText } from '../i18n/index.js';
import { ErrorNotice, Modal, newKey, pin, Time, useLocale, useTaskFactory } from '../ui.js';
import { ContentDiff } from './ContentDiff.js';
import { PolicySnapshot } from './ProposalPermissions.js';
import { AcceptedEvidence } from './AcceptedEvidence.js';

export function HistoryPane({
  api,
  session,
  objectId,
  refresh,
  onClose,
  onOpen,
  onCopied,
  onChanged,
  hidden,
}: {
  api: DesktopApi;
  session: SpaceSession;
  objectId: string;
  refresh: number;
  onClose: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onCopied: (view: ObjectView) => void;
  onChanged: () => void;
  hidden?: boolean;
}) {
  const locale = useLocale();
  const [items, setItems] = useState<RevisionSummary[]>([]),
    [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [preview, setPreview] = useState<ObjectView | null>(null);
  const gate = useRef(0);
  const [evidenceRevision, setEvidenceRevision] = useState<number | null>(null);
  async function load(beforeRevision?: number) {
    const ticket = ++gate.current;
    try {
      const result = await api.history(
        bound(session, { objectId, limit: 20, ...(beforeRevision ? { beforeRevision } : {}) }),
      );
      if (ticket !== gate.current) return;
      if (result.ok) {
        setItems((old) => (beforeRevision ? [...old, ...result.value.items] : result.value.items));
        setNext(result.value.nextBeforeRevision);
        setError(null);
      } else setError(result.error.code);
    } catch {
      if (ticket === gate.current) setError('OPERATION_UNKNOWN');
    }
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
    };
  }, [session.bindingId, objectId, refresh]);
  async function openPreview(revision: number) {
    const result = await api.readObject(bound(session, { objectId, revision })).catch(() => null);
    if (result?.ok) setPreview(result.value);
    else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  return (
    <aside
      className="context-pane"
      aria-label={t(locale, 'history.title')}
      data-testid="history-pane"
      hidden={hidden}
    >
      <header>
        <h2>{t(locale, 'history.title')}</h2>
        <button className="icon-button" aria-label={t(locale, 'common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="context-scroll as-scroll-region">
        <ErrorNotice
          code={error}
          onRetry={() => {
            void load();
          }}
        />
        {items.map((item) => (
          <div className="history-row" key={item.revision}>
            <button
              className="text-button"
              id={`history-r${item.revision}`}
              onClick={() => onOpen(pin(objectId, item.revision), `history-r${item.revision}`)}
            >
              {t(locale, 'source.version', { version: item.revision })}
            </button>
            <button
              data-testid={`version-evidence-r${item.revision}`}
              onClick={() =>
                setEvidenceRevision((old) => (old === item.revision ? null : item.revision))
              }
            >
              {t(locale, 'evidence.title')}
            </button>
            {evidenceRevision === item.revision && (
              <AcceptedEvidence
                api={api}
                session={session}
                objectId={objectId}
                revision={item.revision}
                changeId={item.changeId}
                onOpen={onOpen}
              />
            )}
            <span>{titleText(locale, item.title)}</span>
            <small>
              <Time value={item.createdAt} />
            </small>
            <small>
              {t(locale, item.actor.kind === 'human' ? 'ui.human' : 'ui.agent')}
              {item.lifecycle === 'archived' && ` · ${t(locale, 'ui.archived')}`}
            </small>
            <button
              onClick={() => {
                void openPreview(item.revision);
              }}
              data-testid={`preview-undo-r${item.revision}`}
            >
              {t(locale, 'history.previewUndo')}
            </button>
          </div>
        ))}
        {next && (
          <button
            onClick={() => {
              void load(next);
            }}
          >
            {t(locale, 'ui.moreResults')}
          </button>
        )}
      </div>
      {preview && (
        <UndoPreview
          api={api}
          session={session}
          selected={preview}
          onClose={() => setPreview(null)}
          onOpen={onOpen}
          onCopied={onCopied}
          onChanged={onChanged}
        />
      )}
    </aside>
  );
}

function UndoPreview({
  api,
  session,
  selected,
  onClose,
  onOpen,
  onCopied,
  onChanged,
}: {
  api: DesktopApi;
  session: SpaceSession;
  selected: ObjectView;
  onClose: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onCopied: (view: ObjectView) => void;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const [current, setCurrent] = useState<ObjectSnapshot | null>(null),
    [previous, setPrevious] = useState<ObjectSnapshot | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const task = useRef<OperationTask<WriteResult> | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.readObject(bound(session, { objectId: selected.object.id })),
      selected.object.parentRevision
        ? api.readObject(
            bound(session, {
              objectId: selected.object.id,
              revision: selected.object.parentRevision,
            }),
          )
        : Promise.resolve(null),
    ])
      .then(([now, old]) => {
        if (!active) return;
        if (now.ok) setCurrent(now.value.object);
        else setError(now.error.code);
        if (old?.ok) setPrevious(old.value.object);
        else if (old && !old.ok) setError(old.error.code);
      })
      .catch(() => {
        if (active) setError('OPERATION_UNKNOWN');
      });
    return () => {
      active = false;
    };
  }, [api, session.bindingId, selected]);
  const blocked = !!current && current.revision !== selected.object.revision;
  const originOnly =
    !!previous &&
    JSON.stringify(previous.origin) !== JSON.stringify(selected.object.origin) &&
    JSON.stringify(previous.content) === JSON.stringify(selected.object.content) &&
    JSON.stringify(previous.policy) === JSON.stringify(selected.object.policy) &&
    previous.lifecycle === selected.object.lifecycle;
  async function undo() {
    if (!current || blocked) return;
    if (!task.current) {
      const input = {
        operationKey: newKey('undo'),
        changeId: selected.object.changeId,
        expectedRevision: current.revision,
      };
      task.current = makeTask(input.operationKey, () => api.undoChange(bound(session, input)));
    }
    setBusy(true);
    setError(null);
    try {
      const result = await task.current.run();
      if (result.ok) {
        setDone(true);
        onChanged();
      } else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t(locale, 'history.previewUndo')}
      onClose={() => {
        if (!busy && !task.current?.unknown) onClose();
      }}
      testId="undo-preview"
    >
      <p>
        {titleText(locale, selected.object.content.title, selected.object.kind)} ·{' '}
        {t(locale, 'source.version', { version: selected.object.revision })}
      </p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          void undo();
        }}
      />
      {blocked || error === 'STALE_REVISION' ? (
        <p className="attention">{t(locale, 'history.laterChanges')}</p>
      ) : selected.object.parentRevision === null ? (
        <p className="attention">{t(locale, 'history.undoCreationNotice')}</p>
      ) : null}
      {previous && (
        <ContentDiff
          before={selected.object.content}
          after={previous.content}
          api={api}
          session={session}
          onOpen={onOpen}
        />
      )}
      {originOnly && previous && (
        <section>
          <p className="attention">{t(locale, 'relink.noUndo')}</p>
          <dl>
            <dt>{t(locale, 'relink.old')}</dt>
            <dd className="as-wrap">{previous.origin.locator ?? previous.origin.label}</dd>
            <dt>{t(locale, 'relink.new')}</dt>
            <dd className="as-wrap">
              {selected.object.origin.locator ?? selected.object.origin.label}
            </dd>
          </dl>
        </section>
      )}
      {previous && previous.lifecycle !== selected.object.lifecycle && (
        <p>
          {t(locale, previous.lifecycle === 'archived' ? 'ui.archived' : 'lifecycle.active')} →{' '}
          {t(locale, selected.object.lifecycle === 'archived' ? 'ui.archived' : 'lifecycle.active')}
        </p>
      )}
      {previous && JSON.stringify(selected.object.policy) !== JSON.stringify(previous.policy) && (
        <section className="policy-diff">
          <h3>{t(locale, 'policy.title')}</h3>
          <h4>− {t(locale, 'diff.removed')}</h4>
          <PolicySnapshot object={selected.object} />
          <h4>+ {t(locale, 'diff.added')}</h4>
          <PolicySnapshot object={previous} />
        </section>
      )}
      <div className="as-actions">
        {done ? (
          <p className="positive" role="status">
            {t(locale, 'history.undone')}
          </p>
        ) : (
          <button
            className="primary"
            data-testid="confirm-undo"
            disabled={
              !current ||
              blocked ||
              busy ||
              originOnly ||
              (!!selected.object.parentRevision && !previous)
            }
            onClick={() => {
              void undo();
            }}
          >
            {t(
              locale,
              selected.object.parentRevision === null
                ? 'history.undoCreation'
                : 'history.undoChange',
            )}
          </button>
        )}
        <button
          onClick={() => {
            onOpen(pin(selected.object.id, selected.object.revision));
            onClose();
          }}
        >
          {t(locale, 'history.viewPrevious')}
        </button>
        <button
          onClick={() => {
            onCopied(selected);
            onClose();
          }}
        >
          {t(locale, 'history.createNoteFromVersion')}
        </button>
        <button onClick={onClose} disabled={busy || !!task.current?.unknown}>
          {t(locale, 'common.close')}
        </button>
      </div>
    </Modal>
  );
}
