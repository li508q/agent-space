import { z } from 'zod';
import type { Context } from '../engine.js';
import type { Store, Row } from '../storage.js';
import { rowJson } from '../storage.js';
import type {
  Actor,
  DraftReceipt,
  ObjectSnapshot,
  SaveDraftInput,
  WriteResult,
} from '../../contracts/core.js';
import type { Result, ErrorCode } from '../../contracts/errors.js';
import type { ObjectContent } from '../../contracts/schema.js';
import { ContentSchema } from '../../contracts/schema.js';
import {
  LifecycleInputSchema,
  RelinkInputSchema,
  StartImportSchema,
  ImportStepSchema,
  ImportRetrySchema,
  PauseImportSchema,
  ResumeImportSchema,
  ImportRunReadSchema,
  ImportListSchema,
  ImportManifestSchema,
  ImportRunRefSchema,
  RecoverableListSchema,
  RecoverableReadSchema,
  RecoverableCopySchema,
  localLimits,
} from '../../contracts/local.js';
import type {
  ImportManifest,
  ImportItemResult,
  ImportRunSummary,
  ImportRunPage,
  ImportRunsPage,
  RecoveryDraftPage,
  RecoveryDraftView,
  RecoveryDraftCopy,
} from '../../contracts/local.js';
import {
  asFailure,
  bytes,
  canonical,
  decodeCursor,
  digest,
  encodeCursor,
  fail,
  measured,
  parse,
  safe,
} from '../support.js';
import { sha256 } from './files.js';

/** The Engine owns transactions, receipts and every published revision. */
export interface LocalPort {
  command<S extends z.ZodType, T>(
    context: Context,
    schema: S,
    input: unknown,
    name: string,
    fn: (actor: Actor, input: z.output<S>) => T,
  ): Result<T>;
  read<T>(context: Context, name: string, fn: (actor: Actor) => T): Result<T>;
  load(id: string, revision?: number): ObjectSnapshot;
  validate(content: ObjectContent): void;
  publish(
    actor: Actor,
    action: string,
    id: string,
    kind: ObjectSnapshot['kind'],
    content: ObjectContent,
    policy: ObjectSnapshot['policy'],
    origin: ObjectSnapshot['origin'],
    lifecycle: ObjectSnapshot['lifecycle'],
    previous: ObjectSnapshot | null,
  ): WriteResult;
  persistDraft(actor: Actor, input: SaveDraftInput): DraftReceipt;
  draftReceipt(row: Row): DraftReceipt;
}
const recoveryToken = z.strictObject({
  version: z.literal(1),
  instance: z.uuid(),
  namespace: z.string(),
  owner: z.string(),
  id: z.uuid(),
  generation: z.number().int().nonnegative(),
  digest: z.string(),
});
const recoveryCursor = z.strictObject({
  instance: z.uuid(),
  namespace: z.string(),
  owner: z.string(),
  id: z.uuid(),
});
const itemKey = (run: string, item: string, attempt: number) => `imp:${run}:${item}:${attempt}`;

export class LocalDomain {
  constructor(
    private readonly store: Store,
    private readonly port: LocalPort,
  ) {}
  setLifecycle(context: Context, input: unknown): Result<WriteResult> {
    return this.port.command(
      context,
      LifecycleInputSchema,
      input,
      'object.lifecycle',
      (actor, p) => {
        const object = this.port.load(p.objectId);
        if (object.revision !== p.expectedRevision)
          fail('STALE_REVISION', { currentRevision: object.revision });
        if (object.lifecycle === p.lifecycle) return this.unchanged(object);
        return this.port.publish(
          actor,
          p.lifecycle === 'archived' ? 'object.archived' : 'object.restored',
          object.id,
          object.kind,
          object.content,
          object.policy,
          object.origin,
          p.lifecycle,
          object,
        );
      },
    );
  }
  relinkExternalAsset(context: Context, input: unknown): Result<WriteResult> {
    return this.port.command(context, RelinkInputSchema, input, 'object.relink', (actor, p) => {
      const object = this.port.load(p.objectId);
      if (object.revision !== p.expectedRevision)
        fail('STALE_REVISION', { currentRevision: object.revision });
      if (object.kind !== 'asset' || object.origin.mode !== 'external-reference')
        fail('INVALID_INPUT');
      if (object.origin.locator === p.locator) return this.unchanged(object);
      const origin = {
        mode: object.origin.mode,
        label: object.origin.label,
        locator: p.locator,
        observedAt: p.observedAt,
      };
      return this.port.publish(
        actor,
        'object.relinked',
        object.id,
        object.kind,
        object.content,
        object.policy,
        origin,
        object.lifecycle,
        object,
      );
    });
  }
  private unchanged(object: ObjectSnapshot): WriteResult {
    return {
      state: 'unchanged',
      object,
      changeId: null,
      authoritySequence: this.store.status().authoritySequence,
      generation: null,
    };
  }
  private run(id: string, expected?: string): { row: Row; manifest: ImportManifest } {
    const row = this.store.one('SELECT * FROM import_runs WHERE id=?', id);
    if (expected && row.manifest_digest !== expected) fail('IMPORT_PLAN_CHANGED');
    const manifest = ImportManifestSchema.parse(rowJson(row, 'manifest_json'));
    if (digest(manifest) !== row.manifest_digest) fail('INTEGRITY_FAILURE');
    return { row, manifest };
  }
  private summary(row: Row, actor: Actor): ImportRunSummary {
    const counts = new Map(
      this.store
        .all(
          'SELECT state,COUNT(*) AS n FROM import_items WHERE run_id=? GROUP BY state',
          String(row.id),
        )
        .map((r) => [String(r.state), Number(r.n)]),
    );
    return {
      id: String(row.id),
      manifestDigest: String(row.manifest_digest),
      profileId: String(row.profile_id) as ImportRunSummary['profileId'],
      createdAt: String(row.created_at),
      state: String(row.state) as ImportRunSummary['state'],
      progressRevision: Number(row.progress_revision),
      total: [...counts.values()].reduce((a, b) => a + b, 0),
      committed: counts.get('committed') ?? 0,
      reused: counts.get('reused') ?? 0,
      skipped: counts.get('skipped') ?? 0,
      failed: counts.get('failed') ?? 0,
      blocked: counts.get('blocked') ?? 0,
      needsSourceConfirmation:
        row.namespace !== actor.namespace || row.instance_id !== this.store.instanceId,
    };
  }
  private item(row: Row, manifest: ImportManifest): ImportItemResult {
    const approved = manifest.items[Number(row.position)];
    if (!approved || approved.id !== row.id) fail('INTEGRITY_FAILURE');
    return {
      id: String(row.id),
      targetId: String(row.target_id),
      relativePath: approved.relativePath,
      title: approved.content.title,
      action: approved.action,
      state: String(row.state) as ImportItemResult['state'],
      attempt: Number(row.attempt),
      operationKey: String(row.op_key),
      originalRef: row.result_json
        ? rowJson<ImportItemResult>(row, 'result_json').originalRef
        : null,
      error: row.error_json ? rowJson(row, 'error_json') : null,
    };
  }
  private authorizedRun(row: Row, actor: Actor): void {
    if (row.namespace !== actor.namespace || row.instance_id !== this.store.instanceId)
      fail('IMPORT_SOURCE_CHANGED');
  }
  startImport(context: Context, input: unknown): Result<ImportRunSummary> {
    return this.port.command(context, StartImportSchema, input, 'import.start', (actor, p) => {
      const m = p.manifest;
      if (m.spaceId !== this.store.spaceId || m.instanceId !== this.store.instanceId)
        fail('SPACE_MISMATCH');
      if (digest(m) !== p.expectedManifestDigest || bytes(m) > localLimits.planBytes)
        fail('IMPORT_PLAN_CHANGED');
      const previous = this.store.maybe('SELECT * FROM import_runs WHERE id=?', m.id);
      if (previous) {
        if (
          previous.manifest_digest !== p.expectedManifestDigest ||
          previous.namespace !== actor.namespace
        )
          fail('IDEMPOTENCY_KEY_REUSED');
        return this.summary(previous, actor);
      }
      const ids = new Set<string>();
      for (const item of m.items) {
        if (
          item.action === 'link-relations' ||
          item.expectedRevision !== null ||
          item.content.body !== ''
        )
          fail('INVALID_INPUT');
        if (item.dependsOn.some((id) => !ids.has(id)))
          fail('INVALID_INPUT', undefined, 'dependsOn');
        if (
          item.action === 'managed-copy' &&
          (item.kind !== 'document' || !item.rawDigest || item.origin.mode !== 'imported-copy')
        )
          fail('INVALID_INPUT');
        if (
          item.action === 'external-reference' &&
          (item.kind !== 'asset' || item.origin.mode !== 'external-reference')
        )
          fail('INVALID_INPUT');
        if (item.action === 'project-group' && item.kind !== 'project') fail('INVALID_INPUT');
        if (!['skip'].includes(item.action) && (!item.sourcePath || !item.fingerprint))
          fail('INVALID_INPUT');
        ids.add(item.id);
      }
      this.store.db
        .prepare('INSERT INTO import_runs VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          m.id,
          p.expectedManifestDigest,
          canonical(m),
          actor.namespace,
          this.store.instanceId,
          m.profileId,
          'ready',
          0,
          m.createdAt,
        );
      for (const [position, item] of m.items.entries())
        this.store.db
          .prepare(
            'INSERT INTO import_items(run_id,id,position,target_id,source_key,source_version,state,attempt,op_key) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            m.id,
            item.id,
            position,
            item.targetId,
            item.sourceKey,
            item.sourceVersion,
            'pending',
            0,
            itemKey(m.id, item.id, 0),
          );
      return this.summary(this.run(m.id).row, actor);
    });
  }
  commitImportItem(context: Context, input: unknown): Result<ImportItemResult> {
    return this.port.command(context, ImportStepSchema, input, 'import.item', (actor, p) => {
      const { row: run, manifest } = this.run(p.runId, p.expectedManifestDigest);
      this.authorizedRun(run, actor);
      const row = this.store.one(
        'SELECT * FROM import_items WHERE run_id=? AND id=?',
        p.runId,
        p.itemId,
      );
      if (row.op_key !== p.operationKey) fail('IDEMPOTENCY_KEY_REUSED');
      if (row.state !== 'pending') return this.item(row, manifest);
      if (['paused', 'needs-repreview'].includes(String(run.state))) fail('IMPORT_PLAN_CHANGED');
      const approved = manifest.items[Number(row.position)]!;
      let result = this.item(row, manifest);
      const failed = (code: ErrorCode, state: 'failed' | 'blocked' = 'failed') => {
        result = {
          ...result,
          state,
          error: {
            code,
            retryable: !['IMPORT_SOURCE_CHANGED', 'INVALID_INPUT', 'OBJECT_ID_RESERVED'].includes(
              code,
            ),
          },
        };
      };
      const dependencies = approved.dependsOn.map((id) =>
        this.store.one('SELECT * FROM import_items WHERE run_id=? AND id=?', p.runId, id),
      );
      if (dependencies.some((r) => !['committed', 'reused'].includes(String(r.state))))
        failed('IMPORT_PLAN_CHANGED', 'blocked');
      else if (p.captureError) failed(p.captureError);
      else if (approved.action === 'skip') result = { ...result, state: 'skipped' };
      else {
        this.store.db.exec('SAVEPOINT import_publish');
        try {
          if (approved.action === 'managed-copy') {
            if (
              p.body === undefined ||
              p.capturedDigest !== approved.rawDigest ||
              sha256(p.body) !== approved.rawDigest
            )
              fail('IMPORT_SOURCE_CHANGED');
          } else if (p.body !== undefined || p.capturedDigest !== null) fail('INVALID_INPUT');
          const existing = this.store.maybe(
            'SELECT result_json FROM import_items WHERE source_key=? AND source_version=? AND claimed=1',
            approved.sourceKey,
            approved.sourceVersion,
          );
          if (existing) {
            const old = rowJson<ImportItemResult>(existing, 'result_json');
            if (!old.originalRef) fail('INTEGRITY_FAILURE');
            this.port.load(old.originalRef.objectId, old.originalRef.revision);
            result = { ...result, state: 'reused', originalRef: old.originalRef };
          } else {
            if (
              this.store.maybe('SELECT id FROM objects WHERE id=?', approved.targetId) ||
              this.store.maybe(
                'SELECT object_id FROM reservations WHERE object_id=?',
                approved.targetId,
              )
            )
              fail('OBJECT_ID_RESERVED');
            const aliases = new Map(
              dependencies.map((r) => {
                const ref = rowJson<ImportItemResult>(r, 'result_json').originalRef;
                if (!ref) fail('INTEGRITY_FAILURE');
                return [String(r.target_id), ref.objectId];
              }),
            );
            const content = ContentSchema.parse({
              ...approved.content,
              body: p.body ?? '',
              relations: approved.content.relations.map((r) => ({
                ...r,
                target: {
                  ...r.target,
                  objectId: aliases.get(r.target.objectId) ?? r.target.objectId,
                },
              })),
            });
            for (const relation of content.relations)
              if (this.port.load(relation.target.objectId).lifecycle !== 'active')
                fail('IMPORT_PLAN_CHANGED');
            this.port.validate(content);
            const written = this.port.publish(
              actor,
              'object.imported',
              approved.targetId,
              approved.kind,
              content,
              { protectedFields: [] },
              approved.origin,
              'active',
              null,
            );
            result = {
              ...result,
              state: 'committed',
              originalRef: {
                mode: 'pinned',
                objectId: written.object.id,
                revision: written.object.revision,
              },
            };
            this.store.db
              .prepare('UPDATE import_items SET claimed=1 WHERE run_id=? AND id=?')
              .run(p.runId, p.itemId);
          }
          this.store.db.exec('RELEASE import_publish');
        } catch (error) {
          this.store.db.exec('ROLLBACK TO import_publish; RELEASE import_publish');
          const failure = asFailure(error);
          if (
            [
              'STORAGE_FAILURE',
              'STORAGE_BUSY',
              'INTEGRITY_FAILURE',
              'OPERATION_UNKNOWN',
              'LIMIT_EXCEEDED',
            ].includes(failure.error.code)
          )
            throw error;
          failed(failure.error.code);
        }
      }
      this.store.db
        .prepare(
          'UPDATE import_items SET state=?,result_json=?,error_json=?,original_revision=? WHERE run_id=? AND id=?',
        )
        .run(
          result.state,
          canonical(result),
          result.error ? canonical(result.error) : null,
          result.originalRef?.revision ?? null,
          p.runId,
          p.itemId,
        );
      const remaining = Number(
        this.store.one(
          "SELECT COUNT(*) n FROM import_items WHERE run_id=? AND state='pending'",
          p.runId,
        ).n,
      );
      const errors = Number(
        this.store.one(
          "SELECT COUNT(*) n FROM import_items WHERE run_id=? AND state IN ('failed','blocked')",
          p.runId,
        ).n,
      );
      const state =
        result.error?.code === 'IMPORT_SOURCE_CHANGED'
          ? 'needs-repreview'
          : remaining
            ? 'running'
            : errors
              ? 'finished-with-errors'
              : 'finished';
      this.store.db
        .prepare('UPDATE import_runs SET state=?,progress_revision=progress_revision+1 WHERE id=?')
        .run(state, p.runId);
      return result;
    });
  }
  retryImport(context: Context, input: unknown): Result<ImportRunSummary> {
    return this.port.command(context, ImportRetrySchema, input, 'import.retry', (actor, p) => {
      const { row } = this.run(p.runId, p.expectedManifestDigest);
      this.authorizedRun(row, actor);
      if (row.state === 'needs-repreview') fail('IMPORT_SOURCE_CHANGED');
      for (const id of new Set(p.itemIds)) {
        const item = this.store.one(
          'SELECT * FROM import_items WHERE run_id=? AND id=?',
          p.runId,
          id,
        );
        if (!['failed', 'blocked'].includes(String(item.state))) continue;
        if (
          item.error_json &&
          rowJson<{ code: string }>(item, 'error_json').code === 'IMPORT_SOURCE_CHANGED'
        )
          fail('IMPORT_SOURCE_CHANGED');
        const attempt = Number(item.attempt) + 1;
        this.store.db
          .prepare(
            "UPDATE import_items SET state='pending',attempt=?,op_key=?,result_json=NULL,error_json=NULL WHERE run_id=? AND id=?",
          )
          .run(attempt, itemKey(p.runId, id, attempt), p.runId, id);
      }
      this.store.db
        .prepare(
          "UPDATE import_runs SET state='ready',progress_revision=progress_revision+1 WHERE id=?",
        )
        .run(p.runId);
      return this.summary(this.run(p.runId).row, actor);
    });
  }
  pauseImport(context: Context, input: unknown): Result<ImportRunSummary> {
    return this.port.command(context, PauseImportSchema, input, 'import.pause', (actor, p) => {
      const { row } = this.run(p.runId, p.expectedManifestDigest);
      this.authorizedRun(row, actor);
      if (['ready', 'running'].includes(String(row.state)))
        this.store.db
          .prepare(
            "UPDATE import_runs SET state='paused',progress_revision=progress_revision+1 WHERE id=?",
          )
          .run(p.runId);
      return this.summary(this.run(p.runId).row, actor);
    });
  }
  resumeImport(context: Context, input: unknown): Result<ImportRunSummary> {
    return this.port.command(context, ResumeImportSchema, input, 'import.resume', (actor, p) => {
      const { row } = this.run(p.runId, p.expectedManifestDigest);
      this.authorizedRun(row, actor);
      if (row.state === 'needs-repreview') fail('IMPORT_SOURCE_CHANGED');
      if (row.state === 'paused')
        this.store.db
          .prepare(
            "UPDATE import_runs SET state='ready',progress_revision=progress_revision+1 WHERE id=?",
          )
          .run(p.runId);
      return this.summary(this.run(p.runId).row, actor);
    });
  }
  getImport(context: Context, input: unknown): Result<ImportRunPage> {
    const p = safe(() => parse(ImportRunReadSchema, input));
    if (!p.ok) return p;
    return this.port.read(context, 'import.get', (actor) => {
      const { row, manifest } = this.run(p.value.runId);
      let after = -1;
      if (p.value.afterItemId)
        after = Number(
          this.store.one(
            'SELECT position FROM import_items WHERE run_id=? AND id=?',
            p.value.runId,
            p.value.afterItemId,
          ).position,
        );
      const rows = this.store.all(
        'SELECT * FROM import_items WHERE run_id=? AND position>? ORDER BY position LIMIT ?',
        p.value.runId,
        after,
        p.value.limit + 1,
      );
      const page: ImportRunPage = {
        run: this.summary(row, actor),
        items: [],
        nextAfterItemId: null,
        returnedBytes: 0,
      };
      for (const r of rows.slice(0, p.value.limit)) {
        page.items.push(this.item(r, manifest));
        page.nextAfterItemId = rows.length > page.items.length ? String(r.id) : null;
        if (measured(page).returnedBytes > p.value.maxBytes) {
          page.items.pop();
          page.nextAfterItemId = page.items.at(-1)?.id ?? null;
          if (!page.items.length) fail('LIMIT_EXCEEDED');
          break;
        }
      }
      if (measured(page).returnedBytes > p.value.maxBytes) fail('LIMIT_EXCEEDED');
      return page;
    });
  }
  listImports(context: Context, input: unknown): Result<ImportRunsPage> {
    const p = safe(() => parse(ImportListSchema, input));
    if (!p.ok) return p;
    return this.port.read(context, 'imports.list', (actor) => {
      const rows = this.store.all(
        'SELECT * FROM import_runs WHERE id<? ORDER BY id DESC LIMIT ?',
        p.value.beforeId ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        p.value.limit + 1,
      );
      return {
        items: rows.slice(0, p.value.limit).map((r) => this.summary(r, actor)),
        nextBeforeId: rows.length > p.value.limit ? String(rows[p.value.limit - 1]!.id) : null,
      };
    });
  }
  getImportManifest(context: Context, input: unknown): Result<ImportManifest> {
    const p = safe(() => parse(ImportRunRefSchema, input));
    if (!p.ok) return p;
    return this.port.read(
      context,
      'import.manifest',
      () => this.run(p.value.runId, p.value.expectedManifestDigest).manifest,
    );
  }
  private recoveryRef(actor: Actor, row: Row): string {
    return encodeCursor(this.store.secret, {
      version: 1,
      instance: this.store.instanceId,
      namespace: actor.namespace,
      owner: row.namespace,
      id: row.id,
      generation: row.generation,
      digest: row.digest,
    });
  }
  private recoverable(actor: Actor, ref: string): Row {
    const parsed = recoveryToken.safeParse(decodeCursor(this.store.secret, ref));
    if (!parsed.success) fail('INVALID_CURSOR');
    const p = parsed.data;
    if (
      p.instance !== this.store.instanceId ||
      p.namespace !== actor.namespace ||
      p.owner === actor.namespace
    )
      fail('INVALID_CURSOR');
    const row = this.store.one(
      'SELECT * FROM drafts WHERE namespace=? AND id=? AND retained=1',
      p.owner,
      p.id,
    );
    if (row.generation !== p.generation || row.digest !== p.digest) fail('STALE_REVISION');
    return row;
  }
  listRecoverableDrafts(context: Context, input: unknown): Result<RecoveryDraftPage> {
    const p = safe(() => parse(RecoverableListSchema, input));
    if (!p.ok) return p;
    return this.port.read(context, 'draft.recoverable.list', (actor) => {
      let owner = '',
        id = '';
      if (p.value.cursor) {
        const c = recoveryCursor.safeParse(decodeCursor(this.store.secret, p.value.cursor));
        if (
          !c.success ||
          c.data.instance !== this.store.instanceId ||
          c.data.namespace !== actor.namespace
        )
          fail('INVALID_CURSOR');
        owner = c.data.owner;
        id = c.data.id;
      }
      const rows = this.store.all(
        'SELECT * FROM drafts WHERE retained=1 AND namespace<>? AND (namespace>? OR (namespace=? AND id>?)) ORDER BY namespace,id LIMIT ?',
        actor.namespace,
        owner,
        owner,
        id,
        p.value.limit + 1,
      );
      const selected = rows.slice(0, p.value.limit);
      const last = selected.at(-1);
      return {
        items: selected.map((r) => ({
          ...this.port.draftReceipt(r),
          recoveryRef: this.recoveryRef(actor, r),
          fromOtherInstallation: true as const,
        })),
        nextCursor:
          rows.length > selected.length && last
            ? encodeCursor(this.store.secret, {
                instance: this.store.instanceId,
                namespace: actor.namespace,
                owner: last.namespace,
                id: last.id,
              })
            : null,
      };
    });
  }
  readRecoverableDraft(context: Context, input: unknown): Result<RecoveryDraftView> {
    const p = safe(() => parse(RecoverableReadSchema, input));
    if (!p.ok) return p;
    return this.port.read(context, 'draft.recoverable.read', (actor) => {
      const row = this.recoverable(actor, p.value.recoveryRef);
      return {
        ...this.port.draftReceipt(row),
        content: ContentSchema.parse(rowJson(row, 'content_json')),
        recoveryRef: p.value.recoveryRef,
        fromOtherInstallation: true,
      };
    });
  }
  copyRecoverableDraft(context: Context, input: unknown): Result<RecoveryDraftCopy> {
    return this.port.command(context, RecoverableCopySchema, input, 'draft.recover', (actor, p) => {
      const row = this.recoverable(actor, p.recoveryRef);
      if (
        this.store.maybe(
          'SELECT id FROM drafts WHERE namespace=? AND id=?',
          actor.namespace,
          p.newDraftId,
        )
      )
        fail('OBJECT_ID_RESERVED');
      const source = this.port.draftReceipt(row);
      const copied = this.port.persistDraft(actor, {
        operationKey: p.operationKey,
        draftId: p.newDraftId,
        generation: 1,
        target: source.target,
        source: source.source,
        content: ContentSchema.parse(rowJson(row, 'content_json')),
      });
      return {
        ...copied,
        copiedFrom: {
          draftId: source.draftId,
          generation: source.generation,
          digest: source.digest,
        },
      };
    });
  }
}
