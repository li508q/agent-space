import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ArtifactKind, RestorePreview, SnapshotIdentity } from '../../contracts/local.js';
import type { ErrorCode, Result } from '../../contracts/errors.js';
import type { TransferSession } from '../../contracts/local.js';
import { ArtifactOperation } from '../state/local.js';
import { bound } from '../state/binding.js';
import { formatNumber, t } from '../i18n/index.js';
import { ErrorNotice, Modal, Time, useLocale } from '../ui.js';

export type TransferEntry = {
  kind: ArtifactKind;
  sourceLabel: string;
  operation: ArtifactOperation;
};
export function DataTransferDialog({
  api,
  session,
  entries,
  onAdd,
  onPrepare,
  onOpenRestored,
  onCopyEdits,
  onClose,
}: {
  api: DesktopApi;
  session: SpaceSession | null;
  entries: TransferEntry[];
  onAdd: (entry: TransferEntry) => void;
  onPrepare: () => Promise<boolean>;
  onOpenRestored: (handle: string, expected: SnapshotIdentity) => Promise<boolean>;
  onCopyEdits: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [preview, setPreview] = useState<RestorePreview | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null),
    [prepareFailed, setPrepareFailed] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const stops = entries.map((entry) =>
      entry.operation.subscribe(() => setEpoch((value) => value + 1)),
    );
    return () => stops.forEach((stop) => stop());
  }, [entries]);
  void epoch;
  const unsettled = entries.some(
    ({ operation }) => operation.getSnapshot().busy || operation.getSnapshot().unknown,
  );
  async function chooseBackup() {
    setBusy(true);
    setError(null);
    const result = await api.chooseBackup().catch(() => null);
    if (result?.ok) setPreview(result.value);
    else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
    setBusy(false);
  }
  async function begin(kind: ArtifactKind) {
    setBusy(true);
    setPrepareFailed(false);
    setError(null);
    if (!(await onPrepare())) {
      setPrepareFailed(true);
      setBusy(false);
      return;
    }
    const operationId = crypto.randomUUID();
    let send: () => Promise<Result<TransferSession | null>>;
    if (kind === 'restored-space') {
      if (!preview) {
        setBusy(false);
        return;
      }
      const input = { operationId, handle: preview.handle };
      send = () => api.restoreBackup(input);
    } else {
      if (!session) {
        setBusy(false);
        return;
      }
      const request = bound(session, { operationId });
      send = () =>
        kind === 'sqlite-backup' ? api.backupSpace(request) : api.exportCurrent(request);
    }
    const operation = new ArtifactOperation(operationId, api, send, kind);
    onAdd({
      operation,
      kind,
      sourceLabel: kind === 'restored-space' ? '' : (session?.status.title ?? ''),
    });
    await operation.start();
    setBusy(false);
  }
  return (
    <Modal
      title={t(locale, 'transfer.title')}
      testId="data-transfer-dialog"
      onClose={() => {
        if (!busy && !unsettled) onClose();
      }}
    >
      {session && (
        <p>
          {session.status.title}
          {session.status.example && (
            <span className="example-badge">{t(locale, 'space.example')}</span>
          )}
        </p>
      )}
      <section className="transfer-section">
        <h3>{t(locale, 'backup.create')}</h3>
        <p>{t(locale, 'transfer.backupScope')}</p>
        <button
          data-testid="start-backup"
          disabled={!session || busy || unsettled}
          onClick={() => {
            void begin('sqlite-backup');
          }}
        >
          {t(locale, 'backup.chooseDestination')}
        </button>
      </section>
      <section className="transfer-section">
        <h3>{t(locale, 'export.current')}</h3>
        <p>{t(locale, 'transfer.exportScope')}</p>
        <button
          data-testid="start-export"
          disabled={!session || busy || unsettled}
          onClick={() => {
            void begin('readable-export');
          }}
        >
          {t(locale, 'export.current')}
        </button>
      </section>
      <p className="secondary">{t(locale, 'backup.externalExcluded')}</p>
      <section className="transfer-section">
        <h3>{t(locale, 'restore.title')}</h3>
        <p>{t(locale, 'restore.currentUnchanged')}</p>
        <button
          data-testid="choose-backup"
          disabled={busy || unsettled}
          onClick={() => {
            void chooseBackup();
          }}
        >
          {t(locale, 'transfer.chooseBackup')}
        </button>
        {preview && (
          <>
            <p>
              {t(locale, 'transfer.snapshotCounts', {
                objects: preview.counts.objects,
                revisions: preview.counts.revisions,
              })}
            </p>
            <button
              className="primary"
              data-testid="confirm-restore"
              disabled={busy || unsettled}
              onClick={() => {
                void begin('restored-space');
              }}
            >
              {t(locale, 'restore.chooseNewLocation')}
            </button>
            <details>
              <summary>{t(locale, 'common.technicalDetails')}</summary>
              <p className="as-wrap">
                {preview.snapshot.spaceId} / {preview.snapshot.instanceId}
              </p>
            </details>
          </>
        )}
      </section>
      <ErrorNotice code={error} />
      {prepareFailed && (
        <div className="attention">
          <p>{t(locale, 'transfer.prepareFailed')}</p>
          <button onClick={onCopyEdits}>{t(locale, 'editor.copyEdits')}</button>
        </div>
      )}
      {entries.map((entry) => (
        <TransferRow key={entry.operation.operationId} entry={entry} onOpen={onOpenRestored} />
      ))}
      {unsettled && <p className="secondary">{t(locale, 'transfer.waitBeforeClose')}</p>}
    </Modal>
  );
}

function TransferRow({
  entry,
  onOpen,
}: {
  entry: TransferEntry;
  onOpen: (handle: string, expected: SnapshotIdentity) => Promise<boolean>;
}) {
  const locale = useLocale(),
    state = useSyncExternalStore(entry.operation.subscribe, entry.operation.getSnapshot);
  const [opening, setOpening] = useState(false),
    [openFailed, setOpenFailed] = useState(false);
  const progress = state.progress;
  useEffect(() => {
    if (!state.session || progress?.stage === 'complete' || progress?.stage === 'failed') return;
    const timer = setInterval(() => {
      void entry.operation.refresh();
    }, 750);
    return () => clearInterval(timer);
  }, [entry.operation, state.session, progress?.stage]);
  return (
    <section className="transfer-row" data-testid={`transfer-${state.operationId}`}>
      <h3>
        {t(
          locale,
          entry.kind === 'sqlite-backup'
            ? 'backup.create'
            : entry.kind === 'readable-export'
              ? 'export.current'
              : 'restore.title',
        )}
      </h3>
      {entry.sourceLabel && <p className="secondary">{entry.sourceLabel}</p>}
      {state.session && <p>{state.session.destinationLabel}</p>}
      <ErrorNotice
        code={state.error}
        onRetry={() => {
          void entry.operation.start();
        }}
      />
      {state.unknown && <p className="attention">{t(locale, 'transfer.unknown')}</p>}
      {state.cancelled && <p className="secondary">{t(locale, 'transfer.cancelled')}</p>}
      {progress && (
        <>
          <p role="status">{t(locale, `progress.${progress.stage}`)}</p>
          <p>
            {progress.total === null
              ? t(locale, 'transfer.processedUnknown', { count: progress.completed })
              : t(locale, 'transfer.processed', {
                  count: progress.completed,
                  total: progress.total,
                })}
          </p>
          {progress.total !== null && progress.total > 0 && (
            <progress
              max={progress.total}
              value={progress.completed}
              aria-label={t(locale, `progress.${progress.stage}`)}
            />
          )}
          {progress.bytes !== null && (
            <small>
              {t(locale, 'transfer.bytes', { bytes: formatNumber(locale, progress.bytes) })}
            </small>
          )}
          {progress.stage === 'complete' && progress.receipt && (
            <div className="positive">
              <p>{t(locale, 'transfer.verified')}</p>
              <Time value={progress.receipt.completedAt} />
              <p>{t(locale, 'transfer.objectCount', { count: progress.receipt.counts.objects })}</p>
              {entry.kind === 'restored-space' && state.session && (
                <button
                  data-testid="open-restored-space"
                  disabled={opening}
                  onClick={() => {
                    setOpening(true);
                    setOpenFailed(false);
                    void onOpen(state.session!.handle, progress.receipt!.snapshot).then(
                      (opened) => {
                        setOpenFailed(!opened);
                        setOpening(false);
                      },
                    );
                  }}
                >
                  {t(locale, 'restore.open')}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {openFailed && <p className="attention">{t(locale, 'transfer.openFailed')}</p>}
      {state.session && (
        <button
          disabled={state.busy}
          onClick={() => {
            void entry.operation.refresh();
          }}
        >
          {t(locale, 'transfer.check')}
        </button>
      )}
      {!state.session && state.unknown && (
        <button
          disabled={state.busy}
          onClick={() => {
            void entry.operation.start();
          }}
        >
          {t(locale, 'transfer.retryOriginal')}
        </button>
      )}
      <details>
        <summary>{t(locale, 'common.technicalDetails')}</summary>
        <dl>
          <dt>{t(locale, 'transfer.operation')}</dt>
          <dd className="as-wrap">{state.operationId}</dd>
          {progress?.receipt && (
            <>
              <dt>{t(locale, 'transfer.digest')}</dt>
              <dd className="as-wrap">{progress.receipt.artifactDigest}</dd>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}
