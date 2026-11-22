import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ErrorCode, Result } from '../../contracts/errors.js';
import type {
  ImportPreviewPage,
  ImportRunPage,
  ArtifactKind,
  PreviewEntry,
  PreviewSession,
  ConfirmImportInput,
  LocalProgress,
  TransferSession,
  RecoveryDraftView,
} from '../../contracts/local.js';
import type { AcceptedChangeSummary, ObjectSnapshot } from '../../contracts/core.js';
import { bound } from './binding.js';

export type ImportChoice = ConfirmImportInput['choices'][number];

/** A read-only rescue path: no draft write is needed to take the original authored content away. */
export function recoveryText(view: Pick<RecoveryDraftView, 'content'>): string {
  return [
    view.content.title,
    view.content.body,
    Object.keys(view.content.properties).length || view.content.relations.length
      ? JSON.stringify(
          { properties: view.content.properties, relations: view.content.relations },
          null,
          2,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Direct human versions have no agent declaration; absence is a neutral reading result. */
export async function readAcceptedSummary(
  api: Pick<DesktopApi, 'readAcceptedChange'>,
  session: SpaceSession,
  changeId: string,
  objectId: string,
  revision: number,
): Promise<Result<AcceptedChangeSummary | null>> {
  const result = await api
    .readAcceptedChange(bound(session, { changeId, section: 'summary', maxBytes: 65_536 }))
    .catch(() => null);
  if (!result) return { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } };
  if (!result.ok) return result.error.code === 'NOT_FOUND' ? { ok: true, value: null } : result;
  if (
    result.value.section !== 'summary' ||
    result.value.target.objectId !== objectId ||
    result.value.target.revision !== revision
  )
    return { ok: false, error: { code: 'INTEGRITY_FAILURE', retryable: false } };
  return { ok: true, value: result.value };
}
export function defaultImportChoice(entry: PreviewEntry): ImportChoice {
  return {
    itemId: entry.id,
    action:
      entry.kind === 'text' && entry.suggestedAction === 'managed-copy' ? 'managed-copy' : 'skip',
    title: entry.title,
    project: entry.groupId ? { mode: 'group', groupId: entry.groupId } : { mode: 'none' },
    useAssetIds: [],
  };
}
export async function loadImportPreview(
  api: Pick<DesktopApi, 'readImportPreview'>,
  session: SpaceSession,
  initial: PreviewSession,
  changed?: (loaded: number) => void,
): Promise<Result<ImportPreviewPage>> {
  const entries = [...initial.page.entries],
    ids = new Set(entries.map((entry) => entry.id)),
    cursors = new Set<string>();
  const groups = new Map(initial.page.groups.map((group) => [group.id, group]));
  let page = initial.page;
  changed?.(entries.length);
  while (page.nextCursor) {
    if (cursors.has(page.nextCursor) || entries.length > 1_000 || cursors.size > 1_024)
      return { ok: false, error: { code: 'INTEGRITY_FAILURE', retryable: false } };
    cursors.add(page.nextCursor);
    const result = await api
      .readImportPreview(
        bound(session, { handle: initial.handle, cursor: page.nextCursor, maxBytes: 65_536 }),
      )
      .catch(() => null);
    if (!result?.ok)
      return result ?? { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } };
    page = result.value;
    if (
      page.planId !== initial.page.planId ||
      page.planDigest !== initial.page.planDigest ||
      page.profileId !== initial.page.profileId
    )
      return { ok: false, error: { code: 'IMPORT_PLAN_CHANGED', retryable: false } };
    for (const entry of page.entries) {
      if (ids.has(entry.id))
        return { ok: false, error: { code: 'INTEGRITY_FAILURE', retryable: false } };
      ids.add(entry.id);
      entries.push(entry);
    }
    for (const group of page.groups) groups.set(group.id, group);
    changed?.(entries.length);
  }
  return {
    ok: true,
    value: { ...initial.page, entries, groups: [...groups.values()], nextCursor: null },
  };
}

/** Refresh visible pages at one progress revision; bounded retries never publish a mixed snapshot. */
export async function loadImportRun(
  api: Pick<DesktopApi, 'getImport'>,
  session: SpaceSession,
  runId: string,
  minimumItems = 50,
): Promise<Result<ImportRunPage>> {
  let manifestDigest: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const items: ImportRunPage['items'] = [],
      ids = new Set<string>(),
      cursors = new Set<string>();
    let snapshot: ImportRunPage['run'] | undefined, cursor: string | undefined;
    while (true) {
      if (cursor && cursors.has(cursor))
        return { ok: false, error: { code: 'INTEGRITY_FAILURE', retryable: false } };
      if (cursor) cursors.add(cursor);
      const result: Result<ImportRunPage> | null = await api
        .getImport(
          bound(session, {
            runId,
            limit: 50,
            maxBytes: 65_536,
            ...(cursor ? { afterItemId: cursor } : {}),
          }),
        )
        .catch(() => null);
      if (!result?.ok)
        return result ?? { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } };
      const page = result.value;
      if (page.run.id !== runId || (manifestDigest && page.run.manifestDigest !== manifestDigest))
        return { ok: false, error: { code: 'IMPORT_PLAN_CHANGED', retryable: false } };
      manifestDigest ??= page.run.manifestDigest;
      snapshot ??= page.run;
      // Discard this entire range, including its terminal summary, and restart at page one.
      if (page.run.progressRevision !== snapshot.progressRevision) break;
      for (const item of page.items) {
        if (ids.has(item.id))
          return { ok: false, error: { code: 'INTEGRITY_FAILURE', retryable: false } };
        ids.add(item.id);
        items.push(item);
      }
      if (cursors.size > 2_048)
        return { ok: false, error: { code: 'LIMIT_EXCEEDED', retryable: false } };
      if (!page.nextAfterItemId || items.length >= minimumItems)
        return { ok: true, value: { ...page, run: snapshot, items } };
      cursor = page.nextAfterItemId;
    }
  }
  return { ok: false, error: { code: 'CURSOR_STALE', retryable: true } };
}

/** Clipboard content is one exact saved version; a selection never masquerades as its full body. */
export function savedContext(
  space: SpaceSession,
  object: ObjectSnapshot,
  selectedBody: string | null = null,
): string {
  if (space.status.spaceId !== object.spaceId || space.status.instanceId !== object.instanceId)
    throw new Error('Context binding mismatch');
  return JSON.stringify(
    {
      format: 'agentspace-context/v1',
      scope: selectedBody ? 'one-saved-object-selected-body' : 'one-saved-object',
      space: { id: object.spaceId, instanceId: object.instanceId, title: space.status.title },
      object: {
        id: object.id,
        kind: object.kind,
        revision: object.revision,
        digest: object.digest,
        title: object.content.title,
        ...(selectedBody ? { bodySelection: selectedBody } : { body: object.content.body }),
        properties: object.content.properties,
        relations: object.content.relations,
      },
    },
    null,
    2,
  );
}

export type ArtifactSnapshot = Readonly<{
  operationId: string;
  session: TransferSession | null;
  progress: LocalProgress | null;
  busy: boolean;
  unknown: boolean;
  cancelled: boolean;
  error: ErrorCode | null;
}>;
/** Artifact receipts live outside the Core ledger. Recover by the same operationId and transfer handle. */
export class ArtifactOperation {
  private state: ArtifactSnapshot;
  private listeners = new Set<() => void>();
  private starting: Promise<void> | null = null;
  private polling: Promise<void> | null = null;
  private observationEpoch = 0;
  constructor(
    readonly operationId: string,
    private readonly api: Pick<DesktopApi, 'readLocalTransfer'>,
    private readonly sendOriginal: () => Promise<Result<TransferSession | null>>,
    private readonly expectedKind: ArtifactKind,
  ) {
    this.state = Object.freeze({
      operationId,
      session: null,
      progress: null,
      busy: false,
      unknown: false,
      cancelled: false,
      error: null,
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ArtifactSnapshot>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }
  start(): Promise<void> {
    if (this.state.progress?.stage === 'complete' && this.state.progress.receipt)
      return Promise.resolve();
    if (this.starting) return this.starting;
    this.observationEpoch++;
    this.starting = (async () => {
      this.publish({ busy: true, error: null });
      try {
        const result = await this.sendOriginal();
        if (!result.ok) {
          this.publish({
            error: result.error.code,
            unknown: result.error.code === 'OPERATION_UNKNOWN',
          });
          return;
        }
        if (!result.value) {
          this.publish({ cancelled: true, unknown: false });
          return;
        }
        if (result.value.kind !== this.expectedKind) {
          this.publish({ error: 'INTEGRITY_FAILURE', unknown: true });
          return;
        }
        this.publish({ session: result.value, cancelled: false, unknown: false });
        // A read begun before replay cannot replace the newly observed operation state.
        if (this.polling) await this.polling;
        await this.refresh();
      } catch {
        this.publish({ error: 'OPERATION_UNKNOWN', unknown: true });
      } finally {
        this.publish({ busy: false });
      }
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  refresh(): Promise<void> {
    if (this.state.progress?.stage === 'complete' && this.state.progress.receipt)
      return Promise.resolve();
    if (this.polling) return this.polling;
    const session = this.state.session;
    if (!session) return Promise.resolve();
    const epoch = this.observationEpoch;
    this.polling = (async () => {
      const result = await this.api.readLocalTransfer({ handle: session.handle }).catch(() => null);
      if (epoch !== this.observationEpoch) return;
      if (!result?.ok) {
        this.publish({
          error: result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN',
          unknown: true,
        });
        return;
      }
      const progress = result.value;
      if (
        (progress.receipt &&
          (progress.receipt.operationId !== this.operationId ||
            progress.receipt.kind !== session.kind)) ||
        (progress.stage === 'complete' && !progress.receipt)
      ) {
        this.publish({ error: 'INTEGRITY_FAILURE', unknown: true });
        return;
      }
      this.publish({
        progress,
        error: progress.error?.code ?? null,
        unknown: progress.error?.code === 'OPERATION_UNKNOWN',
      });
    })().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }
}
