import { randomBytes } from 'node:crypto';
import { basename, resolve, relative, isAbsolute } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { z } from 'zod';
import type { BoundRequest } from '../contracts/desktop.js';
import type { HumanServices } from '../contracts/core.js';
import type { Failure, Result } from '../contracts/errors.js';
import type {
  ArtifactKind,
  ImportManifest,
  PreparedImport,
  PreviewSession,
  ImportRunSummary,
  ImportResumeSession,
  RelinkSession,
  LocalProgress,
  TransferSession,
  RestorePreview,
  ImportPreviewPage,
} from '../contracts/local.js';
import {
  ChooseImportSchema,
  ConfirmImportHandleSchema,
  HandleRequestSchema,
  ReadPreviewHandleSchema,
  RelinkChooseSchema,
  RelinkConfirmSchema,
  ResumeImportSchema,
  TransferRequestSchema,
  RestoreBackupRequestSchema,
} from '../contracts/local.js';
import {
  CoreError,
  asFailure,
  canonical,
  decodeCursor,
  encodeCursor,
  fail,
  safe,
} from '../core/support.js';
import { fingerprint } from '../core/local/files.js';
import {
  captureImportItem,
  compileImport,
  importManifestDigest,
  readPreview,
  scanImport,
} from '../core/local/import-scan.js';
import {
  createBackup,
  exportCurrent,
  inspectBackup,
  restoreBackup,
} from '../core/local/artifacts.js';
import { Workspace } from './workspace.js';

export type LocalChoosers = {
  importSources(mode: 'files' | 'folder'): Promise<string[] | null>;
  destination(kind: ArtifactKind): Promise<string | null>;
  backup(): Promise<string | null>;
  relink(): Promise<string | null>;
};
type PreviewHandle = {
  kind: 'preview';
  binding: string;
  plan: PreparedImport;
  parentRunId?: string;
};
type BackupHandle = {
  kind: 'backup';
  directory: string;
  databaseDigest: string;
  preview: RestorePreview;
};
type RelinkHandle = {
  kind: 'relink';
  binding: string;
  path: string;
  fingerprint: string;
  observedAt: string;
  objectId: string;
  expectedRevision: number;
};
type TransferHandle = {
  kind: 'transfer';
  binding: string | null;
  directory: string;
  artifactKind: ArtifactKind;
  progress: LocalProgress;
  source: string;
  operationId: string;
  sourceDigest?: string;
};
type Handle = PreviewHandle | BackupHandle | RelinkHandle | TransferHandle;
const initial = (): LocalProgress => ({
  stage: 'copying',
  completed: 0,
  total: null,
  bytes: null,
  receipt: null,
  error: null,
});
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new CoreError(result);
  return result.value;
};
const inside = (child: string, parent: string): boolean => {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/** Trusted Main coordinator. Renderer receives random handles and display labels only. */
export class LocalCoordinator {
  #handles = new Map<string, Handle>();
  #operations = new Map<string, string>();
  #restoreSources = new Map<string, string>();
  #jobs = new Set<Promise<void>>();
  #drivers = new Map<string, Promise<void>>();
  #driverErrors = new Map<string, Failure['error']>();
  #secret = randomBytes(32).toString('hex');
  #disposed = false;
  constructor(
    private readonly workspace: Workspace,
    private readonly choose: LocalChoosers,
  ) {}
  dispose(): void {
    this.#disposed = true;
    this.#handles.clear();
  }
  private retain(value: Handle): string {
    if (this.#handles.size >= 128) fail('LIMIT_EXCEEDED');
    const handle = randomBytes(32).toString('hex');
    this.#handles.set(handle, value);
    return handle;
  }
  private handle<K extends Handle['kind']>(key: string, kind: K): Extract<Handle, { kind: K }> {
    const h = this.#handles.get(key);
    if (!h || h.kind !== kind || this.#disposed) fail('NOT_FOUND');
    return h as Extract<Handle, { kind: K }>;
  }
  private active<T>(request: BoundRequest<T>): HumanServices {
    if (this.#disposed) fail('SPACE_MISMATCH');
    return unwrap(this.workspace.validate(request));
  }
  private same(binding: string, request: BoundRequest<unknown>): void {
    this.active(request);
    if (binding !== request.bindingId) fail('SPACE_MISMATCH');
  }
  private async preview<T>(
    request: BoundRequest<T>,
    sources: string[],
    profileId: PreparedImport['profileId'],
    parentRunId?: string,
  ): Promise<PreviewSession> {
    this.active(request);
    const plan = unwrap(
      await scanImport({ selections: sources.map((path) => ({ path })), profileId }),
    );
    this.active(request);
    const handle = this.retain({
      kind: 'preview',
      binding: request.bindingId,
      plan,
      ...(parentRunId ? { parentRunId } : {}),
    });
    return { handle, page: this.page(handle, plan) };
  }
  private page(
    handle: string,
    plan: PreparedImport,
    offset = 0,
    maxBytes = 65536,
  ): ImportPreviewPage {
    // A preview continuation cannot be transplanted into another plan/handle.
    const page = readPreview(plan, offset, Math.max(1024, maxBytes - 512));
    if (page.nextCursor)
      page.nextCursor = encodeCursor(this.#secret, {
        handle,
        digest: plan.digest,
        offset: Number(page.nextCursor),
      });
    // Adding the signed cursor changes the measured Result envelope.
    for (let i = 0; i < 5; i++) {
      const n = Buffer.byteLength(JSON.stringify({ ok: true, value: page }));
      if (n === page.returnedBytes) break;
      page.returnedBytes = n;
    }
    if (page.returnedBytes > maxBytes) fail('LIMIT_EXCEEDED');
    return page;
  }
  async chooseImport(
    request: BoundRequest<z.infer<typeof ChooseImportSchema>>,
  ): Promise<Result<PreviewSession | null>> {
    try {
      this.active(request);
      const paths = await this.choose.importSources(request.input.mode);
      this.active(request);
      return {
        ok: true,
        value: paths?.length ? await this.preview(request, paths, request.input.profileId) : null,
      };
    } catch (e) {
      return asFailure(e);
    }
  }
  readImportPreview(
    request: BoundRequest<z.infer<typeof ReadPreviewHandleSchema>>,
  ): Result<ImportPreviewPage> {
    return safe(() => {
      const h = this.handle(request.input.handle, 'preview');
      this.same(h.binding, request);
      let offset = 0;
      if (request.input.cursor) {
        const raw = decodeCursor(this.#secret, request.input.cursor);
        if (
          !raw ||
          typeof raw !== 'object' ||
          !('handle' in raw) ||
          raw.handle !== request.input.handle ||
          !('digest' in raw) ||
          raw.digest !== h.plan.digest ||
          !('offset' in raw) ||
          typeof raw.offset !== 'number'
        )
          fail('INVALID_CURSOR');
        offset = raw.offset;
      }
      return this.page(request.input.handle, h.plan, offset, request.input.maxBytes);
    });
  }
  confirmImport(
    request: BoundRequest<z.infer<typeof ConfirmImportHandleSchema>>,
  ): Result<ImportRunSummary> {
    return safe(() => {
      const h = this.handle(request.input.handle, 'preview');
      this.same(h.binding, request);
      const human = this.active(request);
      const { handle: _handle, ...choices } = request.input;
      void _handle;
      const manifest = compileImport(
        h.plan,
        { ...choices, planId: h.plan.id },
        { spaceId: request.spaceId, instanceId: request.instanceId },
      );
      if (h.parentRunId) manifest.parentRunId = h.parentRunId;
      // Preview approval never silently captures a newer file. Full captures are
      // bounded by the scan budget, then rechecked again immediately per commit.
      const operation = unwrap(human.operationStatus({ operationKey: choices.operationKey }));
      if (operation.state !== 'recorded')
        for (const item of manifest.items) captureImportItem(item);
      const result = unwrap(
        human.startImport({
          operationKey: choices.operationKey,
          manifest,
          expectedManifestDigest: importManifestDigest(manifest),
        }),
      );
      this.drive(request, manifest);
      return result;
    });
  }
  private drive(request: BoundRequest<unknown>, manifest: ImportManifest): void {
    const key = request.bindingId + ':' + manifest.id;
    if (this.#drivers.has(key)) return;
    this.#driverErrors.delete(key);
    const run = async () => {
      for (const approved of manifest.items) {
        await setImmediate();
        const checked = this.workspace.validate(request);
        if (this.#disposed || !checked.ok) return;
        const human = checked.value,
          expectedManifestDigest = importManifestDigest(manifest);
        const page = human.getImport({ runId: manifest.id, limit: 50, maxBytes: 65536 });
        if (!page.ok) {
          this.#driverErrors.set(key, page.error);
          return;
        }
        if (['paused', 'needs-repreview', 'finished'].includes(page.value.run.state)) return;
        // Find this exact item with bounded progress pages (up to 1,000 entries).
        let current = page.value,
          item = current.items.find((i) => i.id === approved.id);
        while (!item && current.nextAfterItemId) {
          const next = human.getImport({
            runId: manifest.id,
            afterItemId: current.nextAfterItemId,
            limit: 50,
            maxBytes: 65536,
          });
          if (!next.ok) return;
          current = next.value;
          item = current.items.find((i) => i.id === approved.id);
        }
        if (!item || item.state !== 'pending') continue;
        let body: string | undefined,
          captureError: z.infer<
            typeof import('../contracts/local.js').ImportStepSchema
          >['captureError'];
        try {
          body = captureImportItem(approved);
        } catch (e) {
          const code = asFailure(e).error.code;
          captureError = [
            'SOURCE_UNAVAILABLE',
            'IMPORT_SOURCE_CHANGED',
            'UNSUPPORTED_IMPORT',
            'LIMIT_EXCEEDED',
          ].includes(code)
            ? (code as NonNullable<typeof captureError>)
            : 'SOURCE_UNAVAILABLE';
        }
        const result = human.commitImportItem({
          operationKey: item.operationKey,
          runId: manifest.id,
          expectedManifestDigest,
          itemId: approved.id,
          ...(body !== undefined ? { body } : {}),
          capturedDigest: body === undefined ? null : approved.rawDigest,
          ...(captureError ? { captureError } : {}),
        });
        if (!result.ok) {
          this.#driverErrors.set(key, result.error);
          return;
        } // No false durable success on disk-full/unknown.
      }
    };
    const running = run()
      .catch((error) => {
        this.#driverErrors.set(key, asFailure(error).error);
      })
      .finally(() => this.#drivers.delete(key));
    this.#drivers.set(key, running);
  }
  async idle(): Promise<void> {
    await Promise.all([...this.#drivers.values(), ...this.#jobs]);
  }
  importCoordinatorError(bindingId: string, runId: string): Failure['error'] | undefined {
    return this.#driverErrors.get(bindingId + ':' + runId);
  }
  async resumeImport(
    request: BoundRequest<z.infer<typeof ResumeImportSchema>>,
  ): Promise<Result<ImportResumeSession>> {
    try {
      const human = this.active(request),
        run = unwrap(
          human.getImport({ runId: request.input.runId, limit: 1, maxBytes: 65536 }),
        ).run;
      if (run.manifestDigest !== request.input.expectedManifestDigest) fail('IMPORT_PLAN_CHANGED');
      if (run.needsSourceConfirmation || run.state === 'needs-repreview') {
        const paths = await this.choose.importSources('folder');
        this.active(request);
        return {
          ok: true,
          value: paths?.length
            ? {
                state: 'confirmation-required',
                preview: await this.preview(request, paths, run.profileId, run.id),
              }
            : { state: 'cancelled', run },
        };
      }
      const resumed = unwrap(human.resumeImport(request.input));
      this.drive(request, unwrap(human.getImportManifest(request.input)));
      return { ok: true, value: { state: 'resumed', run: resumed } };
    } catch (e) {
      return asFailure(e);
    }
  }
  private destinationSafe(destination: string, source: string): void {
    if (inside(destination, source) || inside(source, destination)) fail('INVALID_INPUT');
  }
  private launchArtifact(h: TransferHandle): void {
    h.progress = initial();
    const progress = (p: LocalProgress) => {
      h.progress = p;
    };
    const request = { operationId: h.operationId, destination: h.directory };
    const task =
      h.artifactKind === 'restored-space'
        ? restoreBackup(h.source, { ...request, expectedBackupDigest: h.sourceDigest }, progress)
        : (h.artifactKind === 'sqlite-backup' ? createBackup : exportCurrent)(
            h.source,
            request,
            progress,
          );
    const settled = task
      .then((result) => {
        h.progress = result.ok
          ? { ...h.progress, stage: 'complete', receipt: result.value, error: null }
          : { ...h.progress, stage: 'failed', error: result.error };
      })
      .catch(() => {
        h.progress = {
          ...h.progress,
          stage: 'failed',
          error: { code: 'OPERATION_UNKNOWN', retryable: true },
        };
      })
      .finally(() => this.#jobs.delete(settled));
    this.#jobs.add(settled);
  }
  async transfer(
    request: BoundRequest<z.infer<typeof TransferRequestSchema>>,
    kind: 'readable-export' | 'sqlite-backup',
  ): Promise<Result<TransferSession | null>> {
    try {
      this.active(request);
      const op = request.bindingId + ':' + kind + ':' + request.input.operationId;
      const previous = this.#operations.get(op);
      if (previous) {
        const h = this.handle(previous, 'transfer');
        if (h.progress.stage === 'failed') {
          if (this.#jobs.size) fail('STORAGE_BUSY');
          this.launchArtifact(h);
        }
        return {
          ok: true,
          value: { handle: previous, kind, destinationLabel: basename(h.directory) },
        };
      }
      if (this.#jobs.size) fail('STORAGE_BUSY');
      const source = this.workspace.directory!;
      const destination = await this.choose.destination(kind);
      this.active(request);
      if (!destination) return { ok: true, value: null };
      this.destinationSafe(destination, source);
      const h: TransferHandle = {
        kind: 'transfer',
        binding: request.bindingId,
        directory: destination,
        artifactKind: kind,
        source,
        operationId: request.input.operationId,
        progress: initial(),
      };
      const handle = this.retain(h);
      this.#operations.set(op, handle);
      this.launchArtifact(h);
      return { ok: true, value: { handle, kind, destinationLabel: basename(destination) } };
    } catch (e) {
      return asFailure(e);
    }
  }
  async chooseBackup(): Promise<Result<RestorePreview | null>> {
    try {
      const directory = await this.choose.backup();
      if (!directory) return { ok: true, value: null };
      const checked = unwrap(await inspectBackup(directory));
      const preview: RestorePreview = {
        handle: '',
        snapshot: checked.manifest.snapshot,
        counts: checked.manifest.counts,
        externalTargetBytesIncluded: false,
      };
      preview.handle = this.retain({
        kind: 'backup',
        directory,
        databaseDigest: checked.manifest.database.sha256,
        preview,
      });
      return { ok: true, value: preview };
    } catch (e) {
      return asFailure(e);
    }
  }
  async restoreBackup(
    request: z.infer<typeof RestoreBackupRequestSchema>,
  ): Promise<Result<TransferSession | null>> {
    try {
      const source = this.handle(request.handle, 'backup'),
        op = 'restore:' + request.operationId;
      const previous = this.#operations.get(op);
      if (previous) {
        const h = this.handle(previous, 'transfer');
        if (this.#restoreSources.get(op) !== source.directory + ':' + source.databaseDigest)
          fail('IDEMPOTENCY_KEY_REUSED');
        if (h.progress.stage === 'failed') {
          if (this.#jobs.size) fail('STORAGE_BUSY');
          this.launchArtifact(h);
        }
        return {
          ok: true,
          value: {
            handle: previous,
            kind: 'restored-space',
            destinationLabel: basename(h.directory),
          },
        };
      }
      if (this.#jobs.size) fail('STORAGE_BUSY');
      const destination = await this.choose.destination('restored-space');
      if (!destination) return { ok: true, value: null };
      this.destinationSafe(destination, source.directory);
      if (this.workspace.directory) this.destinationSafe(destination, this.workspace.directory);
      const checked = unwrap(await inspectBackup(source.directory));
      if (checked.manifest.database.sha256 !== source.databaseDigest) fail('IMPORT_SOURCE_CHANGED');
      const h: TransferHandle = {
        kind: 'transfer',
        binding: null,
        directory: destination,
        artifactKind: 'restored-space',
        source: source.directory,
        sourceDigest: source.databaseDigest,
        operationId: request.operationId,
        progress: initial(),
      };
      const handle = this.retain(h);
      this.#operations.set(op, handle);
      this.#restoreSources.set(op, source.directory + ':' + source.databaseDigest);
      this.launchArtifact(h);
      return {
        ok: true,
        value: { handle, kind: 'restored-space', destinationLabel: basename(destination) },
      };
    } catch (e) {
      return asFailure(e);
    }
  }
  readLocalTransfer(request: z.infer<typeof HandleRequestSchema>): Result<LocalProgress> {
    return safe(() => this.handle(request.handle, 'transfer').progress);
  }
  openRestoredSpace(request: z.infer<typeof HandleRequestSchema>) {
    return safe(() => {
      const h = this.handle(request.handle, 'transfer');
      if (
        h.artifactKind !== 'restored-space' ||
        h.progress.stage !== 'complete' ||
        !h.progress.receipt
      )
        fail('IMPORT_PLAN_CHANGED');
      return unwrap(this.workspace.open(h.directory));
    });
  }
  async chooseRelink(
    request: BoundRequest<z.infer<typeof RelinkChooseSchema>>,
  ): Promise<Result<RelinkSession | null>> {
    try {
      const h = this.active(request),
        object = unwrap(h.readObject({ objectId: request.input.objectId })).object;
      if (object.revision !== request.input.expectedRevision) fail('STALE_REVISION');
      if (object.kind !== 'asset' || object.origin.mode !== 'external-reference')
        fail('INVALID_INPUT');
      const path = await this.choose.relink();
      this.active(request);
      if (!path) return { ok: true, value: null };
      const handle = this.retain({
        kind: 'relink',
        binding: request.bindingId,
        path,
        fingerprint: canonical(fingerprint(path)),
        observedAt: new Date().toISOString(),
        objectId: object.id,
        expectedRevision: object.revision,
      });
      return {
        ok: true,
        value: {
          handle,
          objectId: object.id,
          expectedRevision: object.revision,
          oldLabel: object.origin.locator ?? object.origin.label,
          newLabel: path,
        },
      };
    } catch (e) {
      return asFailure(e);
    }
  }
  confirmRelink(request: BoundRequest<z.infer<typeof RelinkConfirmSchema>>) {
    return safe(() => {
      const h = this.handle(request.input.handle, 'relink');
      this.same(h.binding, request);
      if (h.expectedRevision !== request.input.expectedRevision) fail('STALE_REVISION');
      const human = this.active(request);
      const status = unwrap(human.operationStatus({ operationKey: request.input.operationKey }));
      if (status.state !== 'recorded' && canonical(fingerprint(h.path)) !== h.fingerprint)
        fail('IMPORT_SOURCE_CHANGED');
      return unwrap(
        human.relinkExternalAsset({
          operationKey: request.input.operationKey,
          objectId: h.objectId,
          expectedRevision: h.expectedRevision,
          locator: h.path,
          observedAt: h.observedAt,
        }),
      );
    });
  }
}
