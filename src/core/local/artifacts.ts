import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import {
  ArtifactOperationSchema,
  RestoreArtifactOperationSchema,
  ArtifactReceiptSchema,
  BackupManifestSchema,
  ExportManifestSchema,
  ExportObjectSchema,
  RestoredArtifactSchema,
} from '../../contracts/local.js';
import type {
  ArtifactReceipt,
  BackupManifest,
  ExportManifest,
  LocalProgress,
  RestoredArtifact,
  SnapshotCounts,
  SnapshotIdentity,
} from '../../contracts/local.js';
import { ContentSchema } from '../../contracts/schema.js';
import { OriginSchema, PolicySchema } from '../../contracts/core.js';
import { canonical, CoreError, digest, fail, parse } from '../support.js';
import { absolute, readJson, regularPath, resultOf, sha256 } from './files.js';
import { copySnapshot, captureSnapshot, hashFile, inspectSnapshot } from './snapshot.js';
import { validateDatabase } from './validate.js';

type Progress = (progress: LocalProgress) => void;
const IntentSchema = z.strictObject({
  operationId: z.uuid(),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['readable-export', 'sqlite-backup', 'restored-space']),
  snapshotFile: z.literal('snapshot.sqlite'),
  newInstanceId: z.uuid().optional(),
  receipt: z.union([RestoredArtifactSchema, ArtifactReceiptSchema]).nullable(),
});
type Intent = z.infer<typeof IntentSchema>;
const emit = (
  fn: Progress | undefined,
  stage: LocalProgress['stage'],
  completed = 0,
  total: number | null = null,
  receipt: ArtifactReceipt | null = null,
) => fn?.({ stage, completed, total, bytes: null, receipt, error: null });
function durable(path: string, text: string): void {
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function replaceJson(path: string, value: unknown): void {
  const temp = path + '.' + randomUUID() + '.tmp';
  durable(temp, canonical(value) + '\n');
  renameSync(temp, path);
}
function reserve(
  destination: string,
  intent: Intent,
): { work: string; intent: Intent; release: () => void } {
  absolute(destination);
  const parent = dirname(destination);
  if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('INVALID_INPUT');
  const intentFile = join(destination, '.operation.json');
  if (existsSync(destination)) {
    if (
      lstatSync(destination).isSymbolicLink() ||
      !lstatSync(destination).isDirectory() ||
      !existsSync(intentFile)
    )
      fail('DESTINATION_EXISTS');
    const old = readJson(intentFile, IntentSchema);
    if (old.operationId !== intent.operationId) fail('DESTINATION_EXISTS');
    if (old.requestDigest !== intent.requestDigest || old.kind !== intent.kind)
      fail('IDEMPOTENCY_KEY_REUSED');
    intent = old;
  } else {
    mkdirSync(destination, { mode: 0o700 });
    durable(intentFile, canonical(intent) + '\n');
  }
  const work = join(
    parent,
    `.agentspace-work-${intent.operationId}-${sha256(destination).slice(0, 12)}`,
  );
  if (!existsSync(work)) {
    mkdirSync(work, { mode: 0o700 });
    durable(
      join(work, 'owner.json'),
      canonical({ operationId: intent.operationId, requestDigest: intent.requestDigest }),
    );
  }
  if (lstatSync(work).isSymbolicLink() || !lstatSync(work).isDirectory())
    fail('DESTINATION_EXISTS');
  const owner = readJson(
    join(work, 'owner.json'),
    z.strictObject({ operationId: z.uuid(), requestDigest: z.string() }),
  );
  if (owner.operationId !== intent.operationId || owner.requestDigest !== intent.requestDigest)
    fail('DESTINATION_EXISTS');
  const lock = join(work, 'lock.json');
  if (existsSync(lock)) {
    const previous = readJson(lock, z.strictObject({ pid: z.number().int().positive() }));
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      alive = !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
    }
    if (alive) fail('STORAGE_BUSY');
    rmSync(lock);
  }
  durable(lock, JSON.stringify({ pid: process.pid }));
  return { work, intent, release: () => rmSync(lock, { force: true }) };
}
function complete(destination: string, intent: Intent, receipt: ArtifactReceipt): void {
  replaceJson(join(destination, '.operation.json'), { ...intent, receipt });
}
function discardSnapshot(work: string): void {
  // Only operation-owned scratch; retained content/history never enters this path.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(join(work, 'snapshot.sqlite') + suffix, { force: true });
    } catch {
      /* A retained private scratch file cannot invalidate a published receipt. */
    }
  }
}
function invalidateSnapshot(work: string): void {
  // A rejected acquisition is not reusable intent. Do not swallow cleanup errors
  // and leave a healthy-looking, wrong snapshot for the next same-operation call.
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(join(work, 'snapshot.sqlite') + suffix, { force: true });
}
function sourceIdentity(source: string): Pick<SnapshotIdentity, 'spaceId' | 'instanceId'> {
  const db = new DatabaseSync(regularPath(source), { readOnly: true, allowExtension: false });
  try {
    const row = db.prepare('SELECT space_id,instance_id FROM space_meta WHERE id=1').get();
    if (!row) fail('INTEGRITY_FAILURE');
    return { spaceId: String(row.space_id), instanceId: String(row.instance_id) };
  } finally {
    db.close();
  }
}
async function snapshot(
  source: string,
  work: string,
  expected: Pick<SnapshotIdentity, 'spaceId' | 'instanceId'>,
  progress?: Progress,
  capture: typeof copySnapshot = copySnapshot,
) {
  const path = join(work, 'snapshot.sqlite');
  if (existsSync(path)) {
    try {
      const validation = validateDatabase(path);
      if (
        validation.identity.spaceId !== expected.spaceId ||
        validation.identity.instanceId !== expected.instanceId
      )
        fail('SPACE_MISMATCH');
      return { path, validation, digest: await hashFile(path), bytes: lstatSync(path).size };
    } catch {
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    }
  }
  emit(progress, 'copying');
  const copied = await capture(source, path, (n, total) => emit(progress, 'copying', n, total));
  if (
    copied.validation.identity.spaceId !== expected.spaceId ||
    copied.validation.identity.instanceId !== expected.instanceId
  )
    fail('SPACE_MISMATCH');
  return { path, ...copied };
}

export async function createBackup(sourceDirectory: string, input: unknown, progress?: Progress) {
  return resultOf(async () => {
    const p = parse(ArtifactOperationSchema, input);
    const source = join(absolute(sourceDirectory), 'space.sqlite');
    const expected = sourceIdentity(source);
    const requestDigest = digest({
      kind: 'sqlite-backup',
      destination: p.destination,
      ...expected,
    });
    const state = reserve(p.destination, {
      operationId: p.operationId,
      requestDigest,
      kind: 'sqlite-backup',
      snapshotFile: 'snapshot.sqlite',
      receipt: null,
    });
    try {
      if (state.intent.receipt) {
        discardSnapshot(state.work);
        return state.intent.receipt;
      }
      const payload = join(p.destination, 'backup.sqlite');
      const copy = existsSync(payload)
        ? {
            path: payload,
            validation: validateDatabase(payload),
            digest: await hashFile(payload),
            bytes: lstatSync(payload).size,
          }
        : await snapshot(source, state.work, expected, progress);
      if (
        copy.validation.identity.spaceId !== expected.spaceId ||
        copy.validation.identity.instanceId !== expected.instanceId
      )
        fail('SPACE_MISMATCH');
      emit(progress, 'validating');
      if (!existsSync(payload)) {
        renameSync(copy.path, payload);
      }
      const oldManifest = existsSync(join(p.destination, 'backup.json'))
        ? readJson(join(p.destination, 'backup.json'), BackupManifestSchema)
        : null;
      const manifest: BackupManifest = BackupManifestSchema.parse({
        format: 'agentspace-backup/v1',
        complete: true,
        operationId: p.operationId,
        requestDigest,
        createdAt: oldManifest?.createdAt ?? new Date().toISOString(),
        database: { name: 'backup.sqlite', sha256: copy.digest, bytes: copy.bytes },
        snapshot: copy.validation.identity,
        counts: copy.validation.counts,
        externalTargetBytesIncluded: false,
      });
      if (oldManifest && canonical(oldManifest) !== canonical(manifest)) fail('INTEGRITY_FAILURE');
      replaceJson(join(p.destination, 'backup.json'), manifest);
      const receipt: ArtifactReceipt = {
        operationId: p.operationId,
        requestDigest,
        kind: 'sqlite-backup',
        completedAt: manifest.createdAt,
        snapshot: manifest.snapshot,
        counts: manifest.counts,
        artifactDigest: digest(manifest),
        externalTargetBytesIncluded: false,
      };
      complete(p.destination, state.intent, receipt);
      discardSnapshot(state.work);
      emit(progress, 'complete', 1, 1, receipt);
      return receipt;
    } finally {
      state.release();
    }
  });
}

export async function exportCurrent(sourceDirectory: string, input: unknown, progress?: Progress) {
  return resultOf(async () => {
    const p = parse(ArtifactOperationSchema, input);
    const source = join(absolute(sourceDirectory), 'space.sqlite');
    const expected = sourceIdentity(source);
    const requestDigest = digest({
      kind: 'readable-export',
      destination: p.destination,
      ...expected,
    });
    const state = reserve(p.destination, {
      operationId: p.operationId,
      requestDigest,
      kind: 'readable-export',
      snapshotFile: 'snapshot.sqlite',
      receipt: null,
    });
    try {
      if (state.intent.receipt) {
        discardSnapshot(state.work);
        return state.intent.receipt;
      }
      const copy = await snapshot(source, state.work, expected, progress);
      const objects = join(p.destination, 'objects');
      mkdirSync(objects, { recursive: true, mode: 0o700 });
      // An interrupted export rewrites only this owned operation's output files.
      const index = join(p.destination, 'objects.jsonl');
      if (existsSync(index)) rmSync(index);
      durable(index, '');
      const db = new DatabaseSync(copy.path, { readOnly: true, allowExtension: false });
      let written = 0;
      try {
        for (const row of db
          .prepare(
            'SELECT o.id,o.kind,o.head,r.* FROM objects o JOIN revisions r ON r.object_id=o.id AND r.revision=o.head ORDER BY o.id',
          )
          .iterate()) {
          const content = ContentSchema.parse(JSON.parse(String(row.content_json)));
          const body = Buffer.from(content.body, 'utf8');
          const { body: _body, ...rest } = content;
          void _body;
          const metadata = ExportObjectSchema.parse({
            objectId: String(row.id),
            kind: row.kind,
            revision: Number(row.revision),
            lifecycle: row.lifecycle,
            content: rest,
            policy: PolicySchema.parse(JSON.parse(String(row.policy_json))),
            origin: OriginSchema.parse(JSON.parse(String(row.origin_json))),
            bodySha256: sha256(body),
            bodyBytes: body.byteLength,
          });
          const text = canonical(metadata) + '\n';
          const md = join(objects, String(row.id) + '.md'),
            json = join(objects, String(row.id) + '.json');
          for (const path of [md, json]) if (existsSync(path)) rmSync(path);
          durable(md, body.toString('utf8'));
          durable(json, text);
          if ((await hashFile(md)) !== sha256(body) || (await hashFile(json)) !== sha256(text))
            fail('INTEGRITY_FAILURE');
          appendFileSync(
            index,
            canonical({
              id: String(row.id),
              revision: Number(row.revision),
              metadataSha256: sha256(text),
              bodySha256: sha256(body),
            }) + '\n',
          );
          written++;
          emit(progress, 'writing', written, copy.validation.counts.objects);
          if (written % 16 === 0) await setImmediate();
        }
      } finally {
        db.close();
      }
      const counts = {
        ...copy.validation.counts,
        revisions: written,
        proposals: 0,
        receipts: 0,
        retainedDrafts: 0,
      };
      const indexFd = openSync(index, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(indexFd);
      } finally {
        closeSync(indexFd);
      }
      const oldManifest = existsSync(join(p.destination, 'manifest.json'))
        ? readJson(join(p.destination, 'manifest.json'), ExportManifestSchema)
        : null;
      const manifest: ExportManifest = ExportManifestSchema.parse({
        format: 'agentspace-export/v1',
        complete: true,
        operationId: p.operationId,
        requestDigest,
        createdAt: oldManifest?.createdAt ?? new Date().toISOString(),
        snapshot: copy.validation.identity,
        counts,
        index: {
          name: 'objects.jsonl',
          sha256: await hashFile(index),
          entries: written,
          bytes: lstatSync(index).size,
        },
        includesHistory: false,
        includesDrafts: false,
        externalTargetBytesIncluded: false,
        historicalPinBodiesIncluded: false,
      });
      if (oldManifest && canonical(oldManifest) !== canonical(manifest)) fail('INTEGRITY_FAILURE');
      replaceJson(join(p.destination, 'manifest.json'), manifest);
      const receipt: ArtifactReceipt = {
        operationId: p.operationId,
        requestDigest,
        kind: 'readable-export',
        completedAt: manifest.createdAt,
        snapshot: manifest.snapshot,
        counts: manifest.counts,
        artifactDigest: digest(manifest),
        externalTargetBytesIncluded: false,
      };
      complete(p.destination, state.intent, receipt);
      discardSnapshot(state.work);
      emit(progress, 'complete', written, written, receipt);
      return receipt;
    } finally {
      state.release();
    }
  });
}

export async function inspectBackup(directory: string) {
  return resultOf(async () => {
    const manifest = readJson(join(absolute(directory), 'backup.json'), BackupManifestSchema);
    const file = join(directory, 'backup.sqlite');
    if (
      lstatSync(regularPath(file)).size !== manifest.database.bytes ||
      (await hashFile(file)) !== manifest.database.sha256
    )
      fail('INTEGRITY_FAILURE');
    const validation = validateDatabase(file);
    if (
      canonical(validation.identity) !== canonical(manifest.snapshot) ||
      canonical(validation.counts) !== canonical(manifest.counts)
    )
      fail('INTEGRITY_FAILURE');
    return { manifest, validation };
  });
}

export async function restoreBackup(backupDirectory: string, input: unknown, progress?: Progress) {
  return resultOf(async (): Promise<RestoredArtifact> => {
    const p = parse(RestoreArtifactOperationSchema, input);
    const checked = await inspectBackup(backupDirectory);
    if (!checked.ok) throw new CoreError(checked);
    const original = checked.value.manifest;
    if (p.expectedBackupDigest && p.expectedBackupDigest !== original.database.sha256)
      fail('IMPORT_SOURCE_CHANGED');
    const requestDigest = digest({
      kind: 'restored-space',
      source: original.database.sha256,
      destination: p.destination,
    });
    const state = reserve(p.destination, {
      operationId: p.operationId,
      requestDigest,
      kind: 'restored-space',
      snapshotFile: 'snapshot.sqlite',
      newInstanceId: randomUUID(),
      receipt: null,
    });
    try {
      if (state.intent.receipt) {
        discardSnapshot(state.work);
        return RestoredArtifactSchema.parse(state.intent.receipt);
      }
      const final = join(p.destination, 'space.sqlite');
      let identity: SnapshotIdentity;
      let counts: SnapshotCounts;
      let artifactDigest: string;
      let disabledGrants: number;
      const expectedRestored = { ...original.snapshot, instanceId: state.intent.newInstanceId };
      if (existsSync(final)) {
        const restored = validateDatabase(final);
        if (
          canonical(restored.identity) !== canonical(expectedRestored) ||
          canonical(restored.counts) !== canonical(original.counts)
        )
          fail('INTEGRITY_FAILURE');
        identity = restored.identity;
        counts = restored.counts;
        artifactDigest = await hashFile(final);
        disabledGrants = countGrants(final);
      } else {
        const source = join(backupDirectory, 'backup.sqlite');
        let copy: Awaited<ReturnType<typeof snapshot>>;
        try {
          copy = await snapshot(source, state.work, original.snapshot, progress, captureSnapshot);
          emit(progress, 'validating');
          // The path inspected earlier can now be another healthy backup with
          // the same space/instance. Reused scratch also requires this exact pin.
          const acquired = await inspectSnapshot(copy.path);
          if (
            acquired.digest !== original.database.sha256 ||
            acquired.bytes !== original.database.bytes ||
            canonical(acquired.validation.identity) !== canonical(original.snapshot) ||
            canonical(acquired.validation.counts) !== canonical(original.counts)
          )
            fail('IMPORT_SOURCE_CHANGED');
        } catch (error) {
          invalidateSnapshot(state.work);
          throw error;
        }
        const db = new DatabaseSync(copy.path, { allowExtension: false });
        try {
          db.exec(
            'PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;',
          );
          db.prepare('UPDATE space_meta SET instance_id=?,cursor_secret=? WHERE id=1').run(
            state.intent.newInstanceId!,
            randomBytes(32).toString('hex'),
          );
          disabledGrants = Number(db.prepare('SELECT COUNT(*) AS n FROM grants').get()!.n);
          db.prepare('UPDATE grants SET revoked=1,token_hash=?').run(
            digest(randomBytes(32).toString('hex')),
          );
          db.exec('COMMIT');
        } finally {
          if (db.isTransaction) db.exec('ROLLBACK');
          db.close();
        }
        const restored = validateDatabase(copy.path);
        if (
          canonical(restored.identity) !== canonical(expectedRestored) ||
          canonical(restored.counts) !== canonical(original.counts)
        ) {
          invalidateSnapshot(state.work);
          fail('INTEGRITY_FAILURE');
        }
        identity = restored.identity;
        counts = restored.counts;
        // Freeze this restoration's digest while its file is still private.
        // Later human edits to the published space cannot enter its receipt.
        artifactDigest = await hashFile(copy.path);
        renameSync(copy.path, final);
      }
      const receipt: RestoredArtifact = {
        operationId: p.operationId,
        requestDigest,
        kind: 'restored-space',
        completedAt: new Date().toISOString(),
        snapshot: identity,
        counts,
        artifactDigest,
        externalTargetBytesIncluded: false,
        sourceInstanceId: original.snapshot.instanceId,
        disabledGrants,
      };
      complete(p.destination, state.intent, receipt);
      discardSnapshot(state.work);
      emit(progress, 'complete', 1, 1, receipt);
      return receipt;
    } finally {
      state.release();
    }
  });
}
function countGrants(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM grants WHERE revoked=1').get()!.n);
  } finally {
    db.close();
  }
}
