import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ContentSchema,
  ProposeSchema,
  IdSchema,
  KindSchema,
  RevisionSchema,
} from '../../contracts/schema.js';
import {
  DraftSourceSchema,
  DraftTargetSchema,
  GrantSpecSchema,
  OriginSchema,
  PolicySchema,
} from '../../contracts/core.js';
import {
  ImportManifestSchema,
  ImportItemResultSchema,
  LOCAL_CORE_VERSION,
  LOCAL_FORMAT_VERSION,
  SnapshotIdentitySchema,
} from '../../contracts/local.js';
import type { SnapshotCounts, SnapshotIdentity } from '../../contracts/local.js';
import { digest, fail, canonical } from '../support.js';
import { searchProjection } from '../search.js';
import { FORMAT_SCHEMA_SQL } from '../storage.js';
import { regularPath } from './files.js';

const actor = z.strictObject({
  kind: z.enum(['human', 'agent']),
  namespace: z.string().min(1).max(160),
});
const required = [
  'space_meta',
  'objects',
  'revisions',
  'search_projection',
  'search_fts',
  'changes',
  'receipts',
  'grants',
  'proposals',
  'reservations',
  'proposal_seen',
  'knowledge_reviews',
  'drafts',
  'activity',
  'import_runs',
  'import_items',
];
let expectedSchema: string | undefined;
function catalog(db: DatabaseSync): string {
  return canonical(
    db
      .prepare(
        'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all(),
  );
}
function canonicalSchema(): string {
  if (!expectedSchema) {
    const reference = new DatabaseSync(':memory:', { allowExtension: false });
    try {
      reference.exec(FORMAT_SCHEMA_SQL);
      expectedSchema = catalog(reference);
    } finally {
      reference.close();
    }
  }
  return expectedSchema;
}
function decoded<S extends z.ZodType>(value: unknown, schema: S): z.output<S> {
  try {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 2_097_152)
      fail('INTEGRITY_FAILURE');
    return schema.parse(JSON.parse(String(value)));
  } catch {
    return fail('INTEGRITY_FAILURE');
  }
}
function count(db: DatabaseSync, table: string, suffix = ''): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${suffix}`).get()!.n);
}
export type SnapshotValidation = {
  identity: SnapshotIdentity;
  counts: SnapshotCounts;
  unresolvedDraftReferences: number;
};

/** Read only. No repair, FTS integrity INSERT, source receipt or activity. */
export function validateDatabase(filename: string): SnapshotValidation {
  const db = new DatabaseSync(regularPath(filename), {
    readOnly: true,
    allowExtension: false,
    timeout: 5_000,
  });
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA query_only=ON;');
    if (
      Number(db.prepare('PRAGMA application_id').get()!.application_id) !== 0x41535043 ||
      Number(db.prepare('PRAGMA user_version').get()!.user_version) !== LOCAL_FORMAT_VERSION
    )
      fail('SCHEMA_UNSUPPORTED');
    const meta = db.prepare('SELECT * FROM space_meta WHERE id=1').get();
    if (!meta || Number(meta.core_version) !== LOCAL_CORE_VERSION) fail('SCHEMA_UNSUPPORTED');
    const tables = new Set(
      [...db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").iterate()].map((r) =>
        String(r.name),
      ),
    );
    if (required.some((name) => !tables.has(name))) fail('INTEGRITY_FAILURE');
    if (catalog(db) !== canonicalSchema()) fail('INTEGRITY_FAILURE');
    if (
      db.prepare("SELECT name FROM sqlite_schema WHERE type='view'").get() ||
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name IN ('space_meta','grants')",
        )
        .get()
    )
      fail('INTEGRITY_FAILURE');
    const physical = [...db.prepare('PRAGMA integrity_check').iterate()];
    if (
      physical.length !== 1 ||
      Object.values(physical[0]!)[0] !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').get()
    )
      fail('INTEGRITY_FAILURE');
    const identity: SnapshotIdentity = SnapshotIdentitySchema.parse({
      spaceId: String(meta.space_id),
      instanceId: String(meta.instance_id),
      formatVersion: 2,
      coreContractVersion: 2,
      authoritySequence: Number(meta.authority_seq),
      activitySequence: Number(
        db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM activity').get()!.n,
      ),
    });
    const exists = db.prepare('SELECT 1 FROM revisions WHERE object_id=? AND revision=?');
    const head = db.prepare('SELECT kind,head FROM objects WHERE id=?');
    const checkRef = (ref: { objectId: string; mode: string; revision?: number }) =>
      ref.mode === 'pinned'
        ? Boolean(exists.get(ref.objectId, ref.revision!))
        : Boolean(head.get(ref.objectId));
    for (const row of db
      .prepare('SELECT r.*,o.kind FROM revisions r JOIN objects o ON o.id=r.object_id')
      .iterate()) {
      if (
        !IdSchema.safeParse(row.object_id).success ||
        !KindSchema.safeParse(row.kind).success ||
        !RevisionSchema.safeParse(row.revision).success
      )
        fail('INTEGRITY_FAILURE');
      const content = decoded(row.content_json, ContentSchema),
        policy = decoded(row.policy_json, PolicySchema),
        origin = decoded(row.origin_json, OriginSchema);
      decoded(row.actor_json, actor);
      if (
        !['active', 'archived'].includes(String(row.lifecycle)) ||
        digest({ kind: row.kind, content, policy, origin, lifecycle: row.lifecycle }) !==
          row.digest ||
        Number(row.revision) < 1 ||
        (Number(row.revision) === 1
          ? row.parent !== null
          : Number(row.parent) !== Number(row.revision) - 1)
      )
        fail('INTEGRITY_FAILURE');
      for (const relation of content.relations) {
        if (!checkRef(relation.target)) fail('INTEGRITY_FAILURE');
        if (
          relation.predicate === 'belongs_to' &&
          head.get(relation.target.objectId)?.kind !== 'project'
        )
          fail('INTEGRITY_FAILURE');
        if (relation.predicate === 'uses' && head.get(relation.target.objectId)?.kind !== 'asset')
          fail('INTEGRITY_FAILURE');
      }
    }
    for (const row of db
      .prepare(
        'SELECT o.*,r.content_json,r.lifecycle FROM objects o LEFT JOIN revisions r ON r.object_id=o.id AND r.revision=o.head',
      )
      .iterate()) {
      if (row.content_json === null || row.content_json === undefined) fail('INTEGRITY_FAILURE');
      const content = decoded(row.content_json, ContentSchema);
      const expected = searchProjection(content);
      if (
        db.prepare('SELECT normalized FROM search_projection WHERE object_id=?').get(row.id!)
          ?.normalized !== expected
      )
        fail('INTEGRITY_FAILURE');
      const indexed = [
        ...db.prepare('SELECT normalized FROM search_fts WHERE object_id=?').iterate(row.id!),
      ];
      if (
        row.lifecycle === 'active'
          ? indexed.length !== 1 || indexed[0]?.normalized !== expected
          : indexed.length !== 0
      )
        fail('INTEGRITY_FAILURE');
    }
    for (const row of db.prepare('SELECT * FROM grants').iterate())
      decoded(row.spec_json, GrantSpecSchema);
    for (const row of db.prepare('SELECT * FROM proposals').iterate()) {
      const payload = decoded(row.payload_json, ProposeSchema);
      if (
        digest({ payload, grantId: row.grant_id }) !== row.payload_hash ||
        payload.action !== row.action ||
        (payload.action === 'create' ? payload.newObject.id : payload.targetId) !== row.target_id
      )
        fail('INTEGRITY_FAILURE');
      if (row.base_revision !== null && !exists.get(row.target_id!, row.base_revision!))
        fail('INTEGRITY_FAILURE');
      if (row.result_revision !== null && !exists.get(row.target_id!, row.result_revision!))
        fail('INTEGRITY_FAILURE');
      for (const pin of payload.sources) if (!checkRef(pin)) fail('INTEGRITY_FAILURE');
    }
    for (const row of db.prepare('SELECT * FROM receipts').iterate()) {
      try {
        if (
          Buffer.byteLength(String(row.result_json)) > 2_097_152 ||
          Buffer.byteLength(String(row.summary_json)) > 65_536
        )
          fail('INTEGRITY_FAILURE');
        const result = JSON.parse(String(row.result_json)) as { ok?: unknown };
        const summary = JSON.parse(String(row.summary_json)) as { requestDigest?: unknown };
        if (typeof result.ok !== 'boolean' || summary.requestDigest !== row.request_digest)
          fail('INTEGRITY_FAILURE');
      } catch {
        fail('INTEGRITY_FAILURE');
      }
    }
    let unresolvedDraftReferences = 0;
    for (const row of db.prepare('SELECT * FROM drafts WHERE retained=1').iterate()) {
      const content = decoded(row.content_json, ContentSchema),
        target = decoded(row.target_json, DraftTargetSchema),
        source = decoded(row.source_json, DraftSourceSchema);
      if (digest({ target, source, content }) !== row.digest) fail('INTEGRITY_FAILURE');
      if (target.state === 'existing' && !exists.get(target.objectId, target.baseRevision))
        fail('INTEGRITY_FAILURE');
      if (source.kind === 'revision' && !checkRef(source.ref)) fail('INTEGRITY_FAILURE');
      if (
        source.kind === 'proposal' &&
        !db.prepare('SELECT 1 FROM proposals WHERE id=?').get(source.proposalId)
      )
        fail('INTEGRITY_FAILURE');
      unresolvedDraftReferences += content.relations.filter((r) => !checkRef(r.target)).length;
    }
    for (const row of db.prepare('SELECT * FROM import_runs').iterate()) {
      const manifest = decoded(row.manifest_json, ImportManifestSchema);
      if (
        digest(manifest) !== row.manifest_digest ||
        manifest.id !== row.id ||
        manifest.spaceId !== identity.spaceId ||
        manifest.instanceId !== row.instance_id
      )
        fail('INTEGRITY_FAILURE');
      const items = db
        .prepare('SELECT * FROM import_items WHERE run_id=? ORDER BY position')
        .all(row.id!);
      if (items.length !== manifest.items.length) fail('INTEGRITY_FAILURE');
      for (const [position, item] of items.entries()) {
        const approved = manifest.items[position]!;
        if (
          item.position !== position ||
          item.id !== approved.id ||
          item.target_id !== approved.targetId ||
          item.source_key !== approved.sourceKey ||
          item.source_version !== approved.sourceVersion
        )
          fail('INTEGRITY_FAILURE');
        if (['committed', 'reused'].includes(String(item.state))) {
          const result = decoded(item.result_json, ImportItemResultSchema);
          if (
            !result.originalRef ||
            !exists.get(result.originalRef.objectId, result.originalRef.revision)
          )
            fail('INTEGRITY_FAILURE');
          if (
            result.id !== item.id ||
            result.targetId !== item.target_id ||
            result.relativePath !== approved.relativePath ||
            result.state !== item.state ||
            result.attempt !== item.attempt ||
            result.operationKey !== item.op_key ||
            result.originalRef.revision !== item.original_revision ||
            (item.claimed === 1 &&
              (item.state !== 'committed' || result.originalRef.objectId !== item.target_id))
          )
            fail('INTEGRITY_FAILURE');
          const receipt = db
            .prepare('SELECT result_json,command FROM receipts WHERE namespace=? AND op_key=?')
            .get(row.namespace!, item.op_key!);
          if (
            !receipt ||
            receipt.command !== 'import.item' ||
            canonical(JSON.parse(String(receipt.result_json))) !==
              canonical({ ok: true, value: result })
          )
            fail('INTEGRITY_FAILURE');
        }
      }
    }
    const counts: SnapshotCounts = {
      objects: count(db, 'objects'),
      revisions: count(db, 'revisions'),
      proposals: count(db, 'proposals'),
      receipts: count(db, 'receipts'),
      retainedDrafts: count(db, 'drafts', 'WHERE retained=1'),
      externalReferences: count(
        db,
        'objects o JOIN revisions r ON r.object_id=o.id AND r.revision=o.head',
        "WHERE json_extract(r.origin_json,'$.mode')='external-reference'",
      ),
    };
    return { identity, counts, unresolvedDraftReferences };
  } finally {
    db.close();
  }
}
