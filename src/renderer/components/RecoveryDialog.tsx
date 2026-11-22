import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type {
  RecoveryDraftCopy,
  RecoveryDraftSummary,
  RecoveryDraftView,
} from '../../contracts/local.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { recoveryText } from '../state/local.js';
import { t } from '../i18n/index.js';
import {
  ErrorNotice,
  fieldText,
  Modal,
  newKey,
  SafeMarkdown,
  Time,
  useLocale,
  useTaskFactory,
} from '../ui.js';

export function RecoveryDialog({
  api,
  session,
  onResume,
  onClose,
}: {
  api: DesktopApi;
  session: SpaceSession;
  onResume: (draftId: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory(),
    gate = useRef(0),
    readGate = useRef(0);
  const [rows, setRows] = useState<RecoveryDraftSummary[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [view, setView] = useState<RecoveryDraftView | null>(null),
    [copy, setCopy] = useState<RecoveryDraftCopy | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const task = useRef<OperationTask<RecoveryDraftCopy> | null>(null);
  const reading = useRef(false);
  const retry = useRef<() => Promise<void>>(async () => {});
  async function load(cursor?: string) {
    retry.current = () => load(cursor);
    const ticket = ++gate.current;
    const result = await api
      .listRecoverableDrafts(bound(session, { limit: 20, ...(cursor ? { cursor } : {}) }))
      .catch(() => null);
    if (ticket !== gate.current) return;
    if (result?.ok) {
      setRows((old) => (cursor ? [...old, ...result.value.items] : result.value.items));
      setNext(result.value.nextCursor);
      setError(null);
      setLoaded(true);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
      readGate.current++;
    };
  }, [session.bindingId]);
  async function read(row: RecoveryDraftSummary) {
    if (busy || reading.current || task.current?.unknown) return;
    reading.current = true;
    retry.current = () => read(row);
    const ticket = ++readGate.current;
    setBusy(true);
    setError(null);
    const result = await api
      .readRecoverableDraft(bound(session, { recoveryRef: row.recoveryRef }))
      .catch(() => null);
    if (ticket !== readGate.current) return;
    if (result?.ok) {
      setView(result.value);
      setCopy(null);
      setTextCopied(false);
      task.current = null;
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
    setBusy(false);
    reading.current = false;
  }
  async function retain() {
    if (!view) return;
    retry.current = retain;
    if (!task.current) {
      const input = {
        operationKey: newKey('recover'),
        recoveryRef: view.recoveryRef,
        newDraftId: crypto.randomUUID(),
      };
      task.current = makeTask(input.operationKey, () =>
        api.copyRecoverableDraft(bound(session, input)),
      );
    }
    setBusy(true);
    setError(null);
    try {
      const result = await task.current.run();
      if (result.ok && result.value.retained) setCopy(result.value);
      else {
        setError(result.ok ? 'INTEGRITY_FAILURE' : result.error.code);
        task.current = null;
      }
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  async function copyText() {
    if (!view) return;
    retry.current = copyText;
    const text = recoveryText(view);
    const result = await api.copyText({ text }).catch(() => null);
    if (result?.ok) {
      setTextCopied(true);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  return (
    <Modal
      title={t(locale, 'recovery.title')}
      testId="recovery-dialog"
      onClose={() => {
        if (!busy && !task.current?.unknown) onClose();
      }}
    >
      <p className="secondary">{t(locale, 'recovery.notice')}</p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          if (task.current?.unknown) void retain();
          else void retry.current();
        }}
      />
      <div className="recovery-list">
        {rows.map((row) => (
          <button
            key={row.recoveryRef}
            disabled={busy || !!task.current?.unknown}
            onClick={() => {
              void read(row);
            }}
          >
            <span>{t(locale, 'recovery.otherInstallation')}</span>
            <small>
              <Time value={row.updatedAt} />
            </small>
            <small>{t(locale, 'recovery.generation', { generation: row.generation })}</small>
          </button>
        ))}
      </div>
      {loaded && !rows.length && <p>{t(locale, 'recovery.empty')}</p>}
      {next && (
        <button
          disabled={busy || !!task.current?.unknown}
          onClick={() => {
            void load(next);
          }}
        >
          {t(locale, 'context.nextPage')}
        </button>
      )}
      {view && (
        <section className="recovered-preview">
          <h3>{view.content.title || t(locale, 'ui.newDraft')}</h3>
          <p className="attention">{t(locale, copy ? 'recovery.kept' : 'recovery.viewingOnly')}</p>
          <button
            data-testid="copy-recovery-text"
            disabled={busy}
            onClick={() => {
              void copyText();
            }}
          >
            {t(locale, 'recovery.copyText')}
          </button>
          {textCopied && <p role="status">{t(locale, 'recovery.textCopied')}</p>}
          <article className="as-prose">
            <SafeMarkdown api={api} text={view.content.body} />
          </article>
          <dl>
            {Object.entries(view.content.properties).map(([key, field]) => (
              <div key={key}>
                <dt>{field.label}</dt>
                <dd>{fieldText(locale, field)}</dd>
              </div>
            ))}
          </dl>
          <div className="as-actions">
            {copy ? (
              <button
                className="primary"
                data-testid="resume-recovered-draft"
                onClick={() => onResume(copy.draftId)}
              >
                {t(locale, 'editor.resumeDraft')}
              </button>
            ) : (
              <button
                className="primary"
                data-testid="retain-recovered-draft"
                disabled={busy}
                onClick={() => {
                  void retain();
                }}
              >
                {t(locale, 'recovery.copyDraft')}
              </button>
            )}
          </div>
        </section>
      )}
    </Modal>
  );
}
