import { useRef, useState, useSyncExternalStore } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { WriteResult } from '../../contracts/core.js';
import type { RelinkSession } from '../../contracts/local.js';
import type { ErrorCode, Result } from '../../contracts/errors.js';
import type { EditorSession, EditorSnapshot } from '../state/editor.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, Modal, newKey, useLocale, useTaskFactory } from '../ui.js';

export function ObjectActionsDialog({
  api,
  session,
  editor,
  mode,
  onExecute,
  onChoose,
  onClose,
}: {
  api: DesktopApi;
  session: SpaceSession;
  editor: EditorSession;
  mode: 'lifecycle' | 'relink';
  onExecute: (
    perform: (state: EditorSnapshot) => Promise<Result<WriteResult>>,
  ) => Promise<Result<WriteResult> | null>;
  onChoose: () => Promise<Result<RelinkSession | null> | null>;
  onClose: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const targetLifecycle = useRef(
    state.object?.lifecycle === 'archived' ? ('active' as const) : ('archived' as const),
  );
  const [preview, setPreview] = useState<RelinkSession | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const task = useRef<OperationTask<WriteResult> | null>(null);
  async function choose() {
    setBusy(true);
    setError(null);
    const result = await onChoose();
    if (result?.ok) {
      setPreview(result.value);
      task.current = null;
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
    setBusy(false);
  }
  async function commit() {
    setBusy(true);
    setError(null);
    const result = await onExecute(async (current) => {
      if (!current.objectId || !current.revision)
        return { ok: false, error: { code: 'NOT_FOUND', retryable: false } };
      if (!task.current) {
        const operationKey = newKey(mode);
        if (mode === 'relink') {
          if (!preview) return { ok: false, error: { code: 'INVALID_INPUT', retryable: false } };
          const input = {
            handle: preview.handle,
            operationKey,
            expectedRevision: preview.expectedRevision,
          };
          task.current = makeTask(operationKey, () => api.confirmRelink(bound(session, input)));
        } else {
          const input = {
            operationKey,
            objectId: current.objectId,
            expectedRevision: current.revision,
            lifecycle: targetLifecycle.current,
          };
          task.current = makeTask(operationKey, () => api.setLifecycle(bound(session, input)));
        }
      }
      return task.current.run();
    });
    if (result?.ok) onClose();
    else {
      setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      if (result && !result.ok) task.current = null;
    }
    setBusy(false);
  }
  const title = t(
    locale,
    mode === 'relink'
      ? 'relink.choose'
      : targetLifecycle.current === 'active'
        ? 'lifecycle.restore'
        : 'lifecycle.archive',
  );
  return (
    <Modal
      title={title}
      testId="object-actions"
      onClose={() => {
        if (!busy && !task.current?.unknown) onClose();
      }}
    >
      <p>{t(locale, mode === 'relink' ? 'relink.notice' : 'lifecycle.notice')}</p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          if (mode === 'relink' && !preview) void choose();
          else void commit();
        }}
      />
      {mode === 'relink' && (
        <>
          <button
            disabled={busy || !!task.current?.unknown}
            data-testid="choose-relink"
            onClick={() => {
              void choose();
            }}
          >
            {t(locale, 'relink.choose')}
          </button>
          {preview && (
            <dl>
              <dt>{t(locale, 'relink.old')}</dt>
              <dd className="as-wrap">{preview.oldLabel}</dd>
              <dt>{t(locale, 'relink.new')}</dt>
              <dd className="as-wrap">{preview.newLabel}</dd>
            </dl>
          )}
          <p className="secondary">{t(locale, 'relink.noUndo')}</p>
        </>
      )}
      <div className="as-actions">
        <button
          className="primary"
          data-testid="confirm-object-action"
          disabled={busy || (mode === 'relink' && !preview)}
          onClick={() => {
            void commit();
          }}
        >
          {t(
            locale,
            mode === 'relink'
              ? 'relink.confirm'
              : targetLifecycle.current === 'active'
                ? 'lifecycle.restore'
                : 'lifecycle.archive',
          )}
        </button>
        <button disabled={busy || !!task.current?.unknown} onClick={onClose}>
          {t(locale, 'common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
