import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SQLInputValue } from 'node:sqlite';
import {
  ContentSchema,
  AgentToolSchema,
  CursorSchema,
  HumanReadSchema,
  HumanSaveSchema,
  IdSchema,
  ProposeSchema,
  QuerySchema,
  ReadCursorSchema,
  ReadSchema,
  ReviewSchema,
  UndoSchema,
  type ObjectContent,
  type ProposalInput,
  type ReadPage,
} from '../contracts/schema.js';
import {
  CreateObjectSchema,
  CreateGrantSchema,
  UpdateGrantSchema,
  GrantSpecSchema,
  OriginSchema,
  PolicySchema,
  SetPolicySchema,
  KnowledgeReviewSchema,
  HistorySchema,
  ProposalListSchema,
  MarkSeenSchema,
  PageRequestSchema,
  OperationStatusSchema,
  SaveDraftSchema,
  DiscardDraftSchema,
  DraftListSchema,
  type Actor,
  type ActivityEntry,
  type ChangeSummary,
  type DeliveredReference,
  type DiscoverResult,
  type DraftReceipt,
  type DraftSnapshot,
  type DraftPage,
  type HistoryPage,
  type ProposalPage,
  type GrantSummary,
  type GrantSpec,
  type IssuedGrant,
  type Kind,
  type KnowledgeReview,
  type ObjectSnapshot,
  type ObjectSummary,
  type ObjectView,
  type OperationStatus,
  type Origin,
  type Policy,
  type ProposalSnapshot,
  type ProposalSummary,
  type ProposalView,
  type ProposalReceipt,
  type QueryPage,
  type ReceiptSummary,
  type ReceiptBusinessOutcome,
  type RelationTarget,
  type ReviewResult,
  type SequencePage,
  type WriteResult,
} from '../contracts/core.js';
import type { Result } from '../contracts/errors.js';
import {
  AcceptedChangeReadSchema,
  RelationsExpandSchema,
  SchemaDescribeSchema,
  TextSearchSchema,
  contextUsageHints,
  type AcceptedChangePage,
  type RelationsExpandPage,
  type SchemaDescription,
  type TextSearchPage,
} from '../contracts/context.js';
import { ContextReader, decodeContextCursor } from './context.js';
import { searchProjection } from './search.js';
import { LocalDomain } from './local/domain.js';
import { HumanQuerySchema } from '../contracts/local.js';
import type { ImportItemResult, ImportRunSummary } from '../contracts/local.js';
import { Store, type Row, rowJson } from './storage.js';
import {
  MAX_OBJECT_BYTES,
  asFailure,
  bytes,
  canonical,
  checkedJson,
  decodeCursor,
  digest,
  encodeCursor,
  fail,
  measured,
  normalize,
  parse,
  safe,
} from './support.js';

export type Context =
  | { kind: 'human'; namespace: string }
  | { kind: 'agent'; grantId: string; token: string; instanceId: string };
type Access = { actor: Actor; scope: GrantSpec['scope']; grant: GrantSummary | null };
type Audit = { delivered: DeliveredReference[]; details: ActivityEntry['details'] };
const now = () => new Date().toISOString();
const namespaceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const objectRequest = z.strictObject({ proposalId: IdSchema });
const defaultPolicy: Policy = { protectedFields: [] };
const defaultOrigin: Origin = { mode: 'managed', label: '' };

export class Engine {
  readonly local: LocalDomain;
  constructor(readonly store: Store) {
    this.local = new LocalDomain(store, {
      command: (context, schema, input, name, fn) =>
        this.command(context, schema, input, name, (a, p) => fn(a.actor, p)),
      read: (context, name, fn) => this.read(context, name, (a) => fn(a.actor), true),
      load: (id, revision) => this.load(id, revision),
      validate: (content) =>
        this.validateContent(
          {
            actor: { kind: 'human', namespace: 'trusted-local' },
            scope: { mode: 'space' },
            grant: null,
          },
          content,
        ),
      publish: (actor, ...args) =>
        this.publish({ actor, scope: { mode: 'space' }, grant: null }, ...args),
      persistDraft: (actor, p) => this.persistDraft(actor, p),
      draftReceipt: (row) => this.draftReceipt(row),
    });
  }

  private auth(context: Context, human = false): Access {
    if (context.kind === 'human') {
      namespaceSchema.parse(context.namespace);
      return {
        actor: { kind: 'human', namespace: 'human:' + context.namespace },
        scope: { mode: 'space' },
        grant: null,
      };
    }
    if (human) fail('FORBIDDEN');
    if (context.instanceId !== this.store.instanceId) fail('SPACE_MISMATCH');
    const row = this.store.maybe('SELECT * FROM grants WHERE id=?', context.grantId);
    if (!row || row.revoked || typeof context.token !== 'string' || context.token.length > 128)
      fail('FORBIDDEN');
    const expected = Buffer.from(String(row.token_hash), 'hex');
    const actual = Buffer.from(digest(context.token), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('FORBIDDEN');
    const grant = this.grantFrom(row);
    if (!grant.capabilities.read) fail('FORBIDDEN');
    return { actor: { kind: 'agent', namespace: 'grant:' + grant.id }, scope: grant.scope, grant };
  }
  private visible(access: Access, id: string): boolean {
    return access.scope.mode === 'space' || access.scope.objectIds.includes(id);
  }
  private allow(access: Access, id: string): void {
    if (!this.visible(access, id)) fail('FORBIDDEN');
  }
  private scopeDigest(access: Access): string {
    return digest({
      instanceId: this.store.instanceId,
      namespace: access.actor.namespace,
      scope: access.scope,
      generation: access.grant?.generation ?? 0,
    });
  }
  private rollback(): void {
    try {
      if (this.store.db.isTransaction) this.store.db.exec('ROLLBACK');
    } catch {
      /* A storage failure is returned, never claimed as saved. */
    }
  }

  private read<T>(
    context: Context,
    tool: string,
    fn: (access: Access, audit: Audit) => T,
    human = false,
    logAgent = true,
  ): Result<T> {
    try {
      // Logged agent reads are short transactions. No model/transport work runs under this lock.
      this.store.db.exec(context.kind === 'agent' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      this.store.checkVersion();
      const access = this.auth(context, human);
      const audit: Audit = { delivered: [], details: {} };
      const value = fn(access, audit);
      if (context.kind === 'agent' && logAgent)
        this.activity(access.actor, 'tool.result_prepared', {
          tool,
          delivered: audit.delivered,
          details: {
            ...audit.details,
            scopeDigest: this.scopeDigest(access),
            grantGeneration: access.grant!.generation,
          },
        });
      this.store.db.exec('COMMIT');
      return { ok: true, value };
    } catch (error) {
      this.rollback();
      return asFailure(error);
    }
  }
  private command<S extends z.ZodType, T>(
    context: Context,
    schema: S,
    input: unknown,
    command: string,
    fn: (access: Access, p: z.output<S>) => T,
    preflight?: (access: Access, p: z.output<S>) => string[],
    human = true,
  ): Result<T> {
    let committing = false;
    try {
      const p = parse(schema, input);
      const key = z
        .strictObject({ operationKey: namespaceSchema })
        .passthrough()
        .parse(p).operationKey;
      const requestDigest = digest({ command, input: p });
      this.store.db.exec('BEGIN IMMEDIATE');
      this.store.checkVersion();
      const access = this.auth(context, human);
      const accessIds = preflight?.(access, p) ?? [];
      const previous = this.store.maybe(
        'SELECT * FROM receipts WHERE namespace=? AND op_key=?',
        access.actor.namespace,
        key,
      );
      if (previous) {
        rowJson<string[]>(previous, 'access_json').forEach((id) => this.allow(access, id));
        if (previous.request_digest !== requestDigest) fail('IDEMPOTENCY_KEY_REUSED');
        const result = rowJson<Result<T>>(previous, 'result_json');
        this.store.db.exec('COMMIT');
        return result;
      }
      this.store.db.exec('SAVEPOINT mutation');
      let result: Result<T>;
      try {
        result = { ok: true, value: fn(access, p) };
        this.store.db.exec('RELEASE mutation');
      } catch (error) {
        try {
          this.store.db.exec('ROLLBACK TO mutation; RELEASE mutation');
        } catch {
          throw error;
        }
        result = asFailure(error);
        if (
          ['STORAGE_BUSY', 'STORAGE_FAILURE', 'INTEGRITY_FAILURE', 'OPERATION_UNKNOWN'].includes(
            result.error.code,
          )
        )
          throw error;
      }
      const recordedAt = now();
      const summary = this.receiptSummary(command, key, requestDigest, recordedAt, result);
      this.store.db
        .prepare('INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?)')
        .run(
          access.actor.namespace,
          key,
          command,
          requestDigest,
          canonical(result),
          canonical(summary),
          canonical([...new Set(accessIds)]),
          recordedAt,
        );
      committing = true;
      this.store.db.exec('COMMIT');
      committing = false;
      return result;
    } catch (error) {
      this.rollback();
      return committing
        ? { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } }
        : asFailure(error);
    }
  }
  private receiptSummary<T>(
    command: string,
    key: string,
    hash: string,
    time: string,
    result: Result<T>,
  ): ReceiptSummary {
    const value = result.ok ? (result.value as Record<string, unknown>) : null;
    const object = value && 'object' in value ? (value.object as ObjectSnapshot | null) : null;
    const proposal =
      value && 'proposal' in value
        ? (value.proposal as ProposalSnapshot)
        : value && 'payloadHash' in value
          ? (value as unknown as ProposalReceipt)
          : null;
    let business: ReceiptBusinessOutcome | null = null;
    if (result.ok) {
      if (command === 'proposal.review') {
        const r = result.value as ReviewResult;
        business = {
          kind: 'review',
          outcome: r.outcome,
          proposalId: r.proposal.id,
          statusVersion: r.proposal.statusVersion,
          payloadHash: r.proposal.payloadHash,
          objectRef: r.object
            ? { mode: 'pinned', objectId: r.object.id, revision: r.object.revision }
            : null,
          authoritySequence: r.authoritySequence,
          changeId: r.changeId,
        };
      } else if (command === 'proposal.create') {
        const r = result.value as ProposalReceipt;
        business = {
          kind: 'proposal',
          proposalId: r.id,
          targetId: r.targetId,
          status: r.status,
          statusVersion: r.statusVersion,
          payloadHash: r.payloadHash,
        };
      } else if (command === 'import.item') {
        const r = result.value as ImportItemResult;
        business = {
          kind: 'import-item',
          runId: key.split(':')[1]!,
          itemId: r.id,
          state: r.state,
          ref: r.originalRef,
        };
      } else if (command.startsWith('import.')) {
        const r = result.value as ImportRunSummary;
        business = {
          kind: 'import',
          runId: r.id,
          manifestDigest: r.manifestDigest,
          state: r.state,
          progressRevision: r.progressRevision,
        };
      } else if (command.startsWith('draft.')) {
        const r = result.value as DraftReceipt;
        business = {
          kind: 'draft',
          draftId: r.draftId,
          generation: r.generation,
          retained: r.retained,
          digest: r.digest,
        };
      } else if (command.startsWith('grant.')) {
        const r = result.value as GrantSummary;
        business = { kind: 'grant', grantId: r.id, generation: r.generation, revoked: r.revoked };
      } else if (command === 'knowledge.review') {
        const r = result.value as KnowledgeReview;
        business = { kind: 'knowledge-review', ref: r!.objectRef };
      } else {
        const r = result.value as WriteResult;
        business = {
          kind: 'object',
          state: r.state,
          ref: { mode: 'pinned', objectId: r.object.id, revision: r.object.revision },
          generation: r.generation,
          authoritySequence: r.authoritySequence,
          changeId: r.changeId,
        };
      }
    }
    return {
      operationKey: key,
      command,
      requestDigest: hash,
      recordedAt: time,
      outcome: result.ok ? 'succeeded' : 'failed',
      errorCode: result.ok ? null : result.error.code,
      business,
      objectRef: object ? { mode: 'pinned', objectId: object.id, revision: object.revision } : null,
      proposalId: proposal?.id ?? null,
      changeId: value && typeof value.changeId === 'string' ? value.changeId : null,
    };
  }
  private activity(
    actor: Actor,
    kind: string,
    fields: Partial<
      Pick<
        ActivityEntry,
        'objectId' | 'proposalId' | 'authoritySequence' | 'tool' | 'delivered' | 'details'
      >
    > = {},
  ): void {
    this.store.db
      .prepare(
        'INSERT INTO activity(kind,actor_json,recorded_at,object_id,proposal_id,authority_seq,tool,delivered_json,details_json) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        kind,
        canonical(actor),
        now(),
        fields.objectId ?? null,
        fields.proposalId ?? null,
        fields.authoritySequence ?? null,
        fields.tool ?? null,
        canonical(fields.delivered ?? []),
        canonical(fields.details ?? {}),
      );
  }
  private change(
    actor: Actor,
    action: string,
    objectId: string | null = null,
    before: number | null = null,
    after: number | null = null,
    proposalId: string | null = null,
  ): ChangeSummary {
    this.store.db.exec('UPDATE space_meta SET authority_seq=authority_seq+1 WHERE id=1');
    const sequence = Number(
      this.store.one('SELECT authority_seq FROM space_meta WHERE id=1').authority_seq,
    );
    const change: ChangeSummary = {
      acceptedChangeReadable: false,
      sequence,
      id: randomUUID(),
      action,
      objectId,
      beforeRevision: before,
      afterRevision: after,
      proposalId,
      actor,
      recordedAt: now(),
    };
    this.store.db
      .prepare('INSERT INTO changes VALUES (?,?,?,?,?,?,?,?,?)')
      .run(
        sequence,
        change.id,
        action,
        objectId,
        before,
        after,
        proposalId,
        canonical(actor),
        change.recordedAt,
      );
    this.activity(actor, action, {
      objectId,
      proposalId,
      authoritySequence: sequence,
      tool: actor.kind === 'agent' && action === 'proposal.created' ? 'proposal_create' : null,
    });
    return change;
  }
  private stored<S extends z.ZodType>(schema: S, text: unknown): z.output<S> {
    const parsed = schema.safeParse(checkedJson(text));
    if (!parsed.success) fail('INTEGRITY_FAILURE');
    return parsed.data;
  }
  private load(id: string, revision?: number): ObjectSnapshot {
    const row = this.store.one(
      `SELECT r.*,o.kind FROM objects o JOIN revisions r ON r.object_id=o.id AND r.revision=${revision === undefined ? 'o.head' : '?'} WHERE o.id=?`,
      ...(revision === undefined ? [id] : [revision, id]),
    );
    const content = this.stored(ContentSchema, row.content_json);
    const policy = this.stored(PolicySchema, row.policy_json);
    const origin = this.stored(OriginSchema, row.origin_json);
    const lifecycle = String(row.lifecycle) as ObjectSnapshot['lifecycle'];
    const kind = String(row.kind) as Kind;
    if (digest({ kind, content, policy, origin, lifecycle }) !== row.digest)
      fail('INTEGRITY_FAILURE');
    const reviewed = this.store.maybe(
      'SELECT * FROM knowledge_reviews WHERE object_id=? ORDER BY revision DESC LIMIT 1',
      id,
    );
    return {
      spaceId: this.store.spaceId,
      instanceId: this.store.instanceId,
      id,
      kind,
      revision: Number(row.revision),
      lifecycle,
      content,
      policy,
      origin,
      digest: String(row.digest),
      parentRevision: row.parent === null ? null : Number(row.parent),
      createdAt: String(row.created_at),
      actor: rowJson<Actor>(row, 'actor_json'),
      changeId: String(row.change_id),
      authoritySequence: Number(row.authority_seq),
      knowledgeReview: reviewed
        ? {
            reviewedRevision: Number(reviewed.revision),
            objectRef: { mode: 'pinned', objectId: id, revision: Number(reviewed.revision) },
            reviewedAt: String(reviewed.reviewed_at),
            actor: rowJson<Actor>(reviewed, 'actor_json'),
          }
        : null,
    };
  }
  private assertRevision(current: ObjectSnapshot, expected: number): void {
    if (current.revision !== expected)
      fail('STALE_REVISION', { currentRevision: current.revision });
  }
  private validateContent(access: Access, content: ObjectContent, prior?: ObjectContent): void {
    if (bytes(content) > MAX_OBJECT_BYTES) fail('LIMIT_EXCEEDED', { maxBytes: MAX_OBJECT_BYTES });
    if (new Set(content.relations.map((r) => r.id)).size !== content.relations.length)
      fail('INVALID_INPUT', undefined, 'relations');
    for (const relation of content.relations) {
      const unchanged = prior?.relations.some((r) => canonical(r) === canonical(relation));
      if (access.grant && !unchanged) this.allow(access, relation.target.objectId);
      const target = this.load(
        relation.target.objectId,
        relation.target.mode === 'pinned' ? relation.target.revision : undefined,
      );
      if (relation.predicate === 'belongs_to' && target.kind !== 'project')
        fail('INVALID_INPUT', undefined, 'relations');
      if (relation.predicate === 'uses' && target.kind !== 'asset')
        fail('INVALID_INPUT', undefined, 'relations');
    }
  }
  private assertAgentPatch(current: ObjectSnapshot, content: ObjectContent): void {
    for (const path of current.policy.protectedFields) {
      const [group, key] = path.split('.');
      const before =
        group === 'properties' && key
          ? current.content.properties[key]
          : current.content[group as keyof ObjectContent];
      const after =
        group === 'properties' && key
          ? content.properties[key]
          : content[group as keyof ObjectContent];
      if (canonical(before) !== canonical(after)) fail('PROTECTED_FIELD', undefined, path);
    }
    const definition = (fields: ObjectContent['properties']) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, field]) => {
          const { value: _value, ...rest } = field;
          void _value;
          return [key, rest];
        }),
      );
    if (
      canonical(definition(current.content.properties)) !==
      canonical(definition(content.properties))
    )
      fail('PROTECTED_FIELD', undefined, 'properties');
  }
  private publish(
    access: Access,
    action: string,
    id: string,
    kind: Kind,
    content: ObjectContent,
    policy: Policy,
    origin: Origin,
    lifecycle: ObjectSnapshot['lifecycle'],
    previous: ObjectSnapshot | null,
    generation: number | null = null,
    proposalId: string | null = null,
  ): WriteResult {
    if (bytes({ kind, content, policy, origin, lifecycle }) > MAX_OBJECT_BYTES)
      fail('LIMIT_EXCEEDED', { maxBytes: MAX_OBJECT_BYTES });
    const revision = (previous?.revision ?? 0) + 1;
    const change = this.change(
      access.actor,
      action,
      id,
      previous?.revision ?? null,
      revision,
      proposalId,
    );
    if (!previous)
      this.store.db.prepare('INSERT INTO objects VALUES (?,?,?)').run(id, kind, revision);
    else this.store.db.prepare('UPDATE objects SET head=? WHERE id=?').run(revision, id);
    this.store.db
      .prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        revision,
        previous?.revision ?? null,
        canonical(content),
        canonical(policy),
        canonical(origin),
        lifecycle,
        digest({ kind, content, policy, origin, lifecycle }),
        canonical(access.actor),
        change.recordedAt,
        change.id,
        change.sequence,
      );
    const text = searchProjection(content);
    this.store.db
      .prepare(
        'INSERT INTO search_projection VALUES (?,?) ON CONFLICT(object_id) DO UPDATE SET normalized=excluded.normalized',
      )
      .run(id, text);
    this.store.db.prepare('DELETE FROM search_fts WHERE object_id=?').run(id);
    if (lifecycle === 'active')
      this.store.db.prepare('INSERT INTO search_fts VALUES (?,?)').run(id, text);
    const object = this.load(id, revision);
    return {
      state: previous
        ? lifecycle === 'archived'
          ? 'archived'
          : previous.lifecycle === 'archived'
            ? 'restored'
            : 'saved'
        : 'created',
      object,
      changeId: change.id,
      authoritySequence: change.sequence,
      generation,
    };
  }

  authenticate(context: Context): Result<null> {
    return this.read(context, 'grant.authenticate', () => null, false, false);
  }
  status(context: Context): Result<ReturnType<Store['status']>> {
    return this.read(context, 'space.status', () => this.store.status());
  }
  discover(context: Context): Result<DiscoverResult> {
    return this.read(context, 'space_discover', (a) => {
      const value: DiscoverResult = {
        status: this.store.status(),
        kinds: ['document', 'project', 'record', 'asset'],
        scope: this.summaryScope(a),
        capabilities: a.grant?.capabilities ?? { read: true, propose: false },
        creation: a.grant?.creation ?? { enabled: false, kinds: [] },
        limits: { objectBytes: MAX_OBJECT_BYTES, readBytes: 65_536, queryItems: 50 },
        implementedTools: [...AgentToolSchema.options],
        usageHints: [...contextUsageHints],
      };
      if (bytes({ ok: true, value }) > 8_192) fail('LIMIT_EXCEEDED');
      return value;
    });
  }
  createObject(context: Context, input: unknown): Result<WriteResult> {
    return this.command(context, CreateObjectSchema, input, 'object.create', (a, p) => {
      const id = p.id ?? randomUUID();
      if (
        this.store.maybe('SELECT id FROM objects WHERE id=?', id) ||
        this.store.maybe('SELECT object_id FROM reservations WHERE object_id=?', id)
      )
        fail('OBJECT_ID_RESERVED');
      this.validateContent(a, p.content);
      return this.publish(
        a,
        'object.created',
        id,
        p.kind,
        p.content,
        p.policy ?? defaultPolicy,
        p.origin ?? defaultOrigin,
        'active',
        null,
        p.generation ?? null,
      );
    });
  }
  saveObject(context: Context, input: unknown): Result<WriteResult> {
    return this.command(context, HumanSaveSchema, input, 'object.save', (a, p) => {
      const current = this.load(p.targetId);
      this.assertRevision(current, p.expectedRevision);
      this.validateContent(a, p.content);
      if (canonical(current.content) === canonical(p.content))
        return {
          state: 'unchanged',
          object: current,
          changeId: null,
          authoritySequence: this.store.status().authoritySequence,
          generation: p.generation ?? null,
        };
      return this.publish(
        a,
        'object.saved',
        current.id,
        current.kind,
        p.content,
        current.policy,
        current.origin,
        current.lifecycle,
        current,
        p.generation ?? null,
      );
    });
  }
  readObject(context: Context, input: unknown): Result<ObjectView> {
    const parsed = safe(() => parse(HumanReadSchema, input));
    if (!parsed.ok) return parsed;
    return this.read(
      context,
      'object.read.full',
      () => {
        const object = this.load(parsed.value.objectId, parsed.value.revision);
        const relationTargets: RelationTarget[] = object.content.relations.map((relation) => {
          try {
            const target = this.load(
              relation.target.objectId,
              relation.target.mode === 'pinned' ? relation.target.revision : undefined,
            );
            return {
              relationId: relation.id,
              declared: relation.target,
              status: 'available',
              resolved: { mode: 'pinned', objectId: target.id, revision: target.revision },
              title: target.content.title,
              kind: target.kind,
            };
          } catch (error) {
            if (asFailure(error).error.code !== 'NOT_FOUND') throw error;
            return {
              relationId: relation.id,
              declared: relation.target,
              status: 'unavailable',
              resolved: null,
            };
          }
        });
        return {
          object,
          currentRevision: Number(
            this.store.one('SELECT head FROM objects WHERE id=?', object.id).head,
          ),
          relationTargets,
        };
      },
      true,
    );
  }
  setPolicy(context: Context, input: unknown): Result<WriteResult> {
    return this.command(context, SetPolicySchema, input, 'object.policy', (a, p) => {
      const current = this.load(p.objectId);
      this.assertRevision(current, p.expectedRevision);
      if (canonical(current.policy) === canonical(p.policy))
        return {
          state: 'unchanged',
          object: current,
          changeId: null,
          authoritySequence: this.store.status().authoritySequence,
          generation: null,
        };
      return this.publish(
        a,
        'object.policy_changed',
        current.id,
        current.kind,
        current.content,
        p.policy,
        current.origin,
        current.lifecycle,
        current,
      );
    });
  }
  markKnowledgeReviewed(context: Context, input: unknown): Result<KnowledgeReview> {
    return this.command(context, KnowledgeReviewSchema, input, 'knowledge.review', (a, p) => {
      const current = this.load(p.ref.objectId);
      this.assertRevision(current, p.ref.revision);
      const prior = this.store.maybe(
        'SELECT * FROM knowledge_reviews WHERE object_id=? AND revision=?',
        current.id,
        current.revision,
      );
      if (prior)
        return {
          reviewedRevision: current.revision,
          objectRef: { mode: 'pinned' as const, objectId: current.id, revision: current.revision },
          reviewedAt: String(prior.reviewed_at),
          actor: rowJson<Actor>(prior, 'actor_json'),
        };
      const time = now();
      this.store.db
        .prepare('INSERT INTO knowledge_reviews VALUES (?,?,?,?)')
        .run(current.id, current.revision, canonical(a.actor), time);
      this.change(a.actor, 'knowledge.reviewed', current.id, current.revision, current.revision);
      return {
        reviewedRevision: current.revision,
        objectRef: { mode: 'pinned', objectId: current.id, revision: current.revision },
        reviewedAt: time,
        actor: a.actor,
      };
    });
  }
  history(context: Context, input: unknown): Result<HistoryPage> {
    const p = safe(() => parse(HistorySchema, input));
    if (!p.ok) return p;
    return this.read(
      context,
      'object.history',
      () => {
        this.load(p.value.objectId);
        const rows = this.store.all(
          'SELECT revision FROM revisions WHERE object_id=? AND revision<? ORDER BY revision DESC LIMIT ?',
          p.value.objectId,
          p.value.beforeRevision ?? Number.MAX_SAFE_INTEGER,
          p.value.limit + 1,
        );
        const items = rows.slice(0, p.value.limit).map((r) => {
          const o = this.load(p.value.objectId, Number(r.revision));
          return {
            revision: o.revision,
            digest: o.digest,
            actor: o.actor,
            lifecycle: o.lifecycle,
            changeId: o.changeId,
            createdAt: o.createdAt,
            authoritySequence: o.authoritySequence,
            title: o.content.title,
            ref: { mode: 'pinned' as const, objectId: o.id, revision: o.revision },
          };
        });
        return {
          items,
          nextBeforeRevision: rows.length > items.length ? items.at(-1)!.revision : null,
          truncated: rows.length > items.length,
        };
      },
      true,
    );
  }
  private grantFrom(row: Row): GrantSummary {
    const spec = this.stored(GrantSpecSchema, row.spec_json);
    return {
      id: String(row.id),
      generation: Number(row.generation),
      label: spec.label,
      scope: spec.scope,
      capabilities: spec.capabilities,
      creation: spec.creation ?? { enabled: false, kinds: [] },
      revoked: Boolean(row.revoked),
      createdAt: String(row.created_at),
    };
  }
  private validateGrant(spec: GrantSpec): void {
    if (spec.scope.mode === 'objects') spec.scope.objectIds.forEach((id) => this.load(id));
  }
  createGrant(context: Context, input: unknown): Result<IssuedGrant> {
    let token: string | null = null;
    const result = this.command(context, CreateGrantSchema, input, 'grant.create', (a, p) => {
      this.validateGrant(p.spec);
      if (Number(this.store.one('SELECT COUNT(*) AS n FROM grants').n) >= 256)
        fail('LIMIT_EXCEEDED');
      const id = randomUUID();
      token = randomBytes(32).toString('base64url');
      this.store.db
        .prepare('INSERT INTO grants VALUES (?,1,?,?,0,?)')
        .run(id, canonical(p.spec), digest(token), now());
      this.change(a.actor, 'grant.created');
      return this.grantFrom(this.store.one('SELECT * FROM grants WHERE id=?', id));
    });
    return result.ok ? { ok: true, value: { grant: result.value, token } } : result;
  }
  updateGrant(context: Context, input: unknown): Result<GrantSummary> {
    return this.command(context, UpdateGrantSchema, input, 'grant.update', (a, p) => {
      const current = this.grantFrom(this.store.one('SELECT * FROM grants WHERE id=?', p.grantId));
      if (current.generation !== p.expectedGeneration)
        fail('STALE_REVISION', { currentGeneration: current.generation });
      this.validateGrant(p.spec);
      const sameSpec =
        canonical({
          label: current.label,
          scope: current.scope,
          capabilities: current.capabilities,
          creation: current.creation,
        }) === canonical({ ...p.spec, creation: p.spec.creation ?? { enabled: false, kinds: [] } });
      if (sameSpec && current.revoked === p.revoked) return current;
      this.store.db
        .prepare('UPDATE grants SET generation=generation+1,spec_json=?,revoked=? WHERE id=?')
        .run(canonical(p.spec), Number(p.revoked), p.grantId);
      this.change(a.actor, p.revoked ? 'grant.revoked' : 'grant.updated');
      return this.grantFrom(this.store.one('SELECT * FROM grants WHERE id=?', p.grantId));
    });
  }
  listGrants(context: Context): Result<GrantSummary[]> {
    return this.read(
      context,
      'grants.list',
      () => this.store.all('SELECT * FROM grants ORDER BY id').map((r) => this.grantFrom(r)),
      true,
    );
  }

  private proposal(row: Row): ProposalSnapshot {
    const payload = this.stored(ProposeSchema, row.payload_json);
    if (digest({ payload, grantId: row.grant_id }) !== row.payload_hash) fail('INTEGRITY_FAILURE');
    return {
      id: String(row.id),
      action: payload.action,
      targetId: String(row.target_id),
      kind: String(row.kind) as Kind,
      baseRevision: row.base_revision === null ? null : Number(row.base_revision),
      payload,
      payloadHash: String(row.payload_hash),
      grantId: String(row.grant_id),
      status: String(row.status) as ProposalSnapshot['status'],
      statusVersion: Number(row.status_version),
      resultRevision: row.result_revision === null ? null : Number(row.result_revision),
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
      conflictCode: row.conflict_code === null ? null : String(row.conflict_code),
    };
  }
  private proposalSummary(proposal: ProposalSnapshot, namespace: string): ProposalSummary {
    const { payload, ...rest } = proposal;
    return {
      ...rest,
      purpose: payload.purpose,
      seen: Boolean(
        this.store.maybe(
          'SELECT seen FROM proposal_seen WHERE proposal_id=? AND namespace=?',
          proposal.id,
          namespace,
        )?.seen,
      ),
    };
  }
  private proposalAccess(a: Access, p: ProposalInput): string[] {
    if (!a.grant?.capabilities.propose) fail('FORBIDDEN');
    if (
      p.action === 'create' &&
      (a.scope.mode !== 'space' ||
        !a.grant.creation.enabled ||
        !a.grant.creation.kinds.includes(p.newObject.kind))
    )
      fail('FORBIDDEN');
    const ids = [
      p.action === 'update' ? p.targetId : p.newObject.id,
      ...p.sources.map((r) => r.objectId),
      ...(p.action === 'create' ? p.newObject.content.relations : (p.patch.relations ?? [])).map(
        (r) => r.target.objectId,
      ),
    ];
    ids.forEach((id) => this.allow(a, id));
    return ids;
  }
  private contentFor(p: ProposalSnapshot): ObjectContent {
    if (p.payload.action === 'create') return p.payload.newObject.content;
    const base = this.load(p.targetId, p.payload.baseRevision);
    return { ...base.content, ...p.payload.patch };
  }
  propose(context: Context, input: unknown): Result<ProposalReceipt> {
    if (context.kind !== 'agent')
      return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
    return this.command(
      context,
      ProposeSchema,
      input,
      'proposal.create',
      (a, p) => {
        let kind: Kind;
        let targetId: string;
        let baseRevision: number | null;
        let conflicted = false;
        for (const ref of p.sources) this.load(ref.objectId, ref.revision);
        if (p.supersedes) {
          const previous = this.proposal(
            this.store.one('SELECT * FROM proposals WHERE id=?', p.supersedes),
          );
          if (previous.grantId !== a.grant!.id) fail('FORBIDDEN');
          this.allow(a, previous.targetId);
        }
        if (p.action === 'create') {
          kind = p.newObject.kind;
          targetId = p.newObject.id;
          baseRevision = null;
          if (
            this.store.maybe('SELECT id FROM objects WHERE id=?', targetId) ||
            this.store.maybe('SELECT object_id FROM reservations WHERE object_id=?', targetId)
          )
            fail('OBJECT_ID_RESERVED');
          this.validateContent(a, p.newObject.content);
        } else {
          const current = this.load(p.targetId);
          const base = this.load(p.targetId, p.baseRevision);
          kind = current.kind;
          targetId = current.id;
          baseRevision = base.revision;
          if (current.lifecycle !== 'active') fail('STALE_REVISION');
          const content = { ...base.content, ...p.patch };
          this.validateContent(a, content, base.content);
          this.assertAgentPatch(base, content);
          // Check current protection as well, including when the base is stale.
          this.assertAgentPatch({ ...base, policy: current.policy }, content);
          conflicted = current.revision !== base.revision;
        }
        const id = randomUUID();
        const time = now();
        this.store.db
          .prepare('INSERT INTO proposals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(
            id,
            p.action,
            targetId,
            kind,
            baseRevision,
            canonical(p),
            digest({ payload: p, grantId: a.grant!.id }),
            a.grant!.id,
            conflicted ? 'conflicted' : 'pending',
            1,
            null,
            time,
            null,
            conflicted ? 'STALE_REVISION' : null,
          );
        if (p.action === 'create')
          this.store.db.prepare('INSERT INTO reservations VALUES (?,?)').run(targetId, id);
        this.change(a.actor, 'proposal.created', targetId, baseRevision, null, id);
        const { payload, ...receipt } = this.proposal(
          this.store.one('SELECT * FROM proposals WHERE id=?', id),
        );
        return { ...receipt, purpose: payload.purpose };
      },
      (a, p) => this.proposalAccess(a, p),
      false,
    );
  }
  getProposal(context: Context, input: unknown): Result<ProposalView> {
    const p = safe(() => parse(objectRequest, input));
    if (!p.ok) return p;
    return this.read(
      context,
      'proposal.read',
      (a) => {
        const proposal = this.proposal(
          this.store.one('SELECT * FROM proposals WHERE id=?', p.value.proposalId),
        );
        const base =
          proposal.baseRevision === null
            ? null
            : this.load(proposal.targetId, proposal.baseRevision);
        const current = this.store.maybe('SELECT id FROM objects WHERE id=?', proposal.targetId)
          ? this.load(proposal.targetId)
          : null;
        return {
          proposal,
          base,
          current,
          proposedContent: this.contentFor(proposal),
          seen: this.proposalSummary(proposal, a.actor.namespace).seen,
        };
      },
      true,
    );
  }
  listProposals(context: Context, input: unknown): Result<ProposalPage> {
    const p = safe(() => parse(ProposalListSchema, input));
    if (!p.ok) return p;
    return this.read(
      context,
      'proposals.list',
      (a) => {
        const rows = this.store.all(
          `SELECT * FROM proposals WHERE id>? ${p.value.status ? 'AND status=?' : ''} ORDER BY id LIMIT ?`,
          p.value.afterId ?? '',
          ...(p.value.status ? [p.value.status] : []),
          p.value.limit + 1,
        );
        const items = rows
          .slice(0, p.value.limit)
          .map((r) => this.proposalSummary(this.proposal(r), a.actor.namespace));
        return {
          items,
          nextAfterId: rows.length > items.length ? items.at(-1)!.id : null,
          truncated: rows.length > items.length,
        };
      },
      true,
    );
  }
  markProposalSeen(
    context: Context,
    input: unknown,
  ): Result<{ proposalId: string; seen: boolean }> {
    const p = safe(() => parse(MarkSeenSchema, input));
    if (!p.ok) return p;
    // No authority or activity event: seeing a candidate is not resolving it.
    return this.read(
      context,
      'proposal.seen',
      (a) => {
        this.store.one('SELECT id FROM proposals WHERE id=?', p.value.proposalId);
        this.store.db
          .prepare(
            'INSERT INTO proposal_seen VALUES (?,?,?) ON CONFLICT(proposal_id,namespace) DO UPDATE SET seen=excluded.seen',
          )
          .run(p.value.proposalId, a.actor.namespace, Number(p.value.seen));
        return p.value;
      },
      true,
    );
  }
  reviewProposal(context: Context, input: unknown): Result<ReviewResult> {
    return this.command(context, ReviewSchema, input, 'proposal.review', (a, p) => {
      const candidate = this.proposal(
        this.store.one('SELECT * FROM proposals WHERE id=?', p.proposalId),
      );
      if (
        candidate.payloadHash !== p.expectedPayloadHash ||
        candidate.statusVersion !== p.expectedProposalVersion
      )
        fail('PROPOSAL_CHANGED');
      if (candidate.status === 'applied' || candidate.status === 'rejected')
        fail('PROPOSAL_RESOLVED');
      if (p.decision === 'reject') {
        this.store.db
          .prepare(
            "UPDATE proposals SET status='rejected',status_version=status_version+1,resolved_at=? WHERE id=?",
          )
          .run(now(), candidate.id);
        const change = this.change(
          a.actor,
          'proposal.rejected',
          candidate.targetId,
          candidate.baseRevision,
          null,
          candidate.id,
        );
        return {
          outcome: 'rejected',
          proposal: this.proposal(
            this.store.one('SELECT * FROM proposals WHERE id=?', candidate.id),
          ),
          object: null,
          changeId: change.id,
          authoritySequence: change.sequence,
        };
      }
      // The person's acceptance never acquires the agent's revoked permissions.
      const grant = this.grantFrom(
        this.store.one('SELECT * FROM grants WHERE id=?', candidate.grantId),
      );
      if (grant.revoked || !grant.capabilities.read || !grant.capabilities.propose)
        fail('FORBIDDEN');
      const originAccess: Access = {
        actor: { kind: 'agent', namespace: 'grant:' + grant.id },
        scope: grant.scope,
        grant,
      };
      this.proposalAccess(originAccess, candidate.payload);
      for (const source of candidate.payload.sources) this.load(source.objectId, source.revision);
      const current = this.store.maybe('SELECT id FROM objects WHERE id=?', candidate.targetId)
        ? this.load(candidate.targetId)
        : null;
      const compatible =
        candidate.action === 'create'
          ? p.expectedTarget.state === 'absent' &&
            !current &&
            this.store.maybe(
              'SELECT proposal_id FROM reservations WHERE object_id=?',
              candidate.targetId,
            )?.proposal_id === candidate.id
          : p.expectedTarget.state === 'revision' &&
            current?.revision === p.expectedTarget.revision &&
            current.revision === candidate.baseRevision &&
            current.lifecycle === 'active';
      if (!compatible || candidate.status === 'conflicted') {
        this.store.db
          .prepare(
            "UPDATE proposals SET status='conflicted',status_version=status_version+1,conflict_code='STALE_REVISION' WHERE id=?",
          )
          .run(candidate.id);
        const change = this.change(
          a.actor,
          'proposal.conflicted',
          candidate.targetId,
          candidate.baseRevision,
          null,
          candidate.id,
        );
        return {
          outcome: 'conflicted',
          proposal: this.proposal(
            this.store.one('SELECT * FROM proposals WHERE id=?', candidate.id),
          ),
          object: current,
          changeId: change.id,
          authoritySequence: change.sequence,
        };
      }
      const content = this.contentFor(candidate);
      this.validateContent(originAccess, content, current?.content);
      if (current) this.assertAgentPatch(current, content);
      const written = this.publish(
        a,
        'proposal.applied',
        candidate.targetId,
        candidate.kind,
        content,
        current?.policy ?? defaultPolicy,
        current?.origin ?? defaultOrigin,
        'active',
        current,
        null,
        candidate.id,
      );
      this.store.db
        .prepare(
          "UPDATE proposals SET status='applied',status_version=status_version+1,result_revision=?,resolved_at=? WHERE id=?",
        )
        .run(written.object.revision, now(), candidate.id);
      return {
        outcome: 'applied',
        proposal: this.proposal(this.store.one('SELECT * FROM proposals WHERE id=?', candidate.id)),
        object: written.object,
        changeId: written.changeId!,
        authoritySequence: written.authoritySequence,
      };
    });
  }
  undoChange(context: Context, input: unknown): Result<WriteResult> {
    return this.command(context, UndoSchema, input, 'change.undo', (a, p) => {
      const change = this.store.one('SELECT * FROM changes WHERE id=?', p.changeId);
      if (change.action === 'object.relinked') fail('UNDO_NOT_SUPPORTED');
      if (
        ![
          'object.created',
          'object.imported',
          'object.saved',
          'object.archived',
          'object.restored',
          'proposal.applied',
          'change.undone',
        ].includes(String(change.action)) ||
        !change.object_id ||
        change.after_revision === null
      )
        fail('INVALID_INPUT');
      const current = this.load(String(change.object_id));
      this.assertRevision(current, p.expectedRevision);
      if (current.revision !== Number(change.after_revision))
        fail('STALE_REVISION', { currentRevision: current.revision });
      const before =
        change.before_revision === null
          ? null
          : this.load(current.id, Number(change.before_revision));
      // Preserve present human policy/origin/review/grants. Creation undo is archival.
      return this.publish(
        a,
        'change.undone',
        current.id,
        current.kind,
        before?.content ?? current.content,
        current.policy,
        current.origin,
        before?.lifecycle ?? 'archived',
        current,
      );
    });
  }

  private draftReceipt(row: Row): DraftReceipt {
    return {
      draftId: String(row.id),
      generation: Number(row.generation),
      target: rowJson(row, 'target_json'),
      source: rowJson(row, 'source_json'),
      digest: String(row.digest),
      retained: Boolean(row.retained),
      updatedAt: String(row.updated_at),
    };
  }
  saveDraft(context: Context, input: unknown): Result<DraftReceipt> {
    return this.command(context, SaveDraftSchema, input, 'draft.save', (a, p) =>
      this.persistDraft(a.actor, p),
    );
  }
  private persistDraft(actor: Actor, p: z.infer<typeof SaveDraftSchema>): DraftReceipt {
    if (bytes(p.content) > MAX_OBJECT_BYTES) fail('LIMIT_EXCEEDED');
    if (p.target.state === 'existing') this.load(p.target.objectId, p.target.baseRevision);
    if (p.source.kind === 'proposal')
      this.store.one('SELECT id FROM proposals WHERE id=?', p.source.proposalId);
    if (p.source.kind === 'revision') this.load(p.source.ref.objectId, p.source.ref.revision);
    const hash = digest({ target: p.target, source: p.source, content: p.content });
    const previous = this.store.maybe(
      'SELECT * FROM drafts WHERE namespace=? AND id=?',
      actor.namespace,
      p.draftId,
    );
    if (previous && (!previous.retained || p.generation < Number(previous.generation)))
      fail('STALE_REVISION', { currentGeneration: Number(previous.generation) });
    if (previous && p.generation === previous.generation) {
      if (previous.digest !== hash) fail('IDEMPOTENCY_KEY_REUSED');
      return this.draftReceipt(previous);
    }
    this.store.db
      .prepare(
        'INSERT INTO drafts VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET generation=excluded.generation,target_json=excluded.target_json,source_json=excluded.source_json,content_json=excluded.content_json,digest=excluded.digest,retained=1,updated_at=excluded.updated_at',
      )
      .run(
        actor.namespace,
        p.draftId,
        p.generation,
        canonical(p.target),
        canonical(p.source),
        canonical(p.content),
        hash,
        1,
        now(),
      );
    return this.draftReceipt(
      this.store.one('SELECT * FROM drafts WHERE namespace=? AND id=?', actor.namespace, p.draftId),
    );
  }

  listDrafts(context: Context, input: unknown): Result<DraftPage> {
    const p = safe(() => parse(DraftListSchema, input));
    if (!p.ok) return p;
    return this.read(
      context,
      'drafts.list',
      (a) => {
        const rows = this.store.all(
          'SELECT * FROM drafts WHERE namespace=? AND retained=1 AND id<? ORDER BY id DESC LIMIT ?',
          a.actor.namespace,
          p.value.beforeId ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          p.value.limit + 1,
        );
        const items = rows.slice(0, p.value.limit).map((row) => this.draftReceipt(row));
        return {
          items,
          nextBeforeId: rows.length > items.length ? items.at(-1)!.draftId : null,
          truncated: rows.length > items.length,
        };
      },
      true,
    );
  }
  readDraft(context: Context, input: unknown): Result<DraftSnapshot> {
    const p = safe(() => parse(z.strictObject({ draftId: IdSchema }), input));
    if (!p.ok) return p;
    return this.read(
      context,
      'draft.read',
      (a) => {
        const row = this.store.one(
          'SELECT * FROM drafts WHERE namespace=? AND id=? AND retained=1',
          a.actor.namespace,
          p.value.draftId,
        );
        return { ...this.draftReceipt(row), content: this.stored(ContentSchema, row.content_json) };
      },
      true,
    );
  }
  discardDraft(context: Context, input: unknown): Result<DraftReceipt> {
    return this.command(context, DiscardDraftSchema, input, 'draft.discard', (a, p) => {
      const current = this.store.one(
        'SELECT * FROM drafts WHERE namespace=? AND id=?',
        a.actor.namespace,
        p.draftId,
      );
      if (current.generation !== p.expectedGeneration)
        fail('STALE_REVISION', { currentGeneration: Number(current.generation) });
      if (!current.retained) return this.draftReceipt(current);
      this.store.db
        .prepare(
          'UPDATE drafts SET retained=0,content_json=NULL,updated_at=? WHERE namespace=? AND id=?',
        )
        .run(now(), a.actor.namespace, p.draftId);
      return this.draftReceipt(
        this.store.one(
          'SELECT * FROM drafts WHERE namespace=? AND id=?',
          a.actor.namespace,
          p.draftId,
        ),
      );
    });
  }

  private scopedSql(a: Access, column = 'o.id'): { sql: string; values: SQLInputValue[] } {
    if (a.scope.mode === 'space') return { sql: '1=1', values: [] };
    return {
      sql: `${column} IN (${a.scope.objectIds.map(() => '?').join(',')})`,
      values: a.scope.objectIds,
    };
  }
  private summaryScope(a: Access): QueryPage['scope'] {
    return {
      mode: a.scope.mode,
      digest: this.scopeDigest(a),
      objectCount: a.scope.mode === 'objects' ? a.scope.objectIds.length : null,
    };
  }
  private contextReader(access: Access): ContextReader {
    return new ContextReader(this.store, {
      load: (id, revision) => this.load(id, revision),
      visible: (id) => this.visible(access, id),
      scope: this.summaryScope(access),
      ownerScope: this.scopedSql(access),
    });
  }
  describe(context: Context, input: unknown): Result<SchemaDescription> {
    const p = safe(() => parse(SchemaDescribeSchema, input));
    if (!p.ok) return p;
    return this.read(context, 'schema_describe', (a, audit) => {
      const page = this.contextReader(a).describe(p.value);
      audit.details = { returnedBytes: page.returnedBytes, definitionsVersion: 1 };
      return page;
    });
  }
  expandRelations(context: Context, input: unknown): Result<RelationsExpandPage> {
    const p = safe(() => parse(RelationsExpandSchema, input));
    if (!p.ok) return p;
    return this.read(context, 'relations_expand', (a, audit) => {
      const page = this.contextReader(a).expandRelations(p.value);
      audit.delivered = page.nodes.map((node) => ({ ref: node.ref }));
      audit.details = {
        resultKind: 'reference-metadata',
        returnedBytes: page.returnedBytes,
        truncated: page.truncated,
        traversalCompleteWithinScope: page.traversalCompleteWithinScope,
        direction: page.direction,
      };
      return page;
    });
  }
  readAcceptedChange(context: Context, input: unknown): Result<AcceptedChangePage> {
    const p = safe(() => parse(AcceptedChangeReadSchema, input));
    if (!p.ok) return p;
    return this.read(context, 'accepted_change_read', (a, audit) => {
      const page = this.contextReader(a).readAcceptedChange(p.value);
      const refs = [
        page.target,
        ...(page.section === 'summary'
          ? page.base
            ? [page.base]
            : []
          : page.items.map((item) => item.ref)),
      ];
      audit.delivered = refs.map((ref) => ({ ref }));
      audit.details = {
        resultKind: 'reference-metadata',
        changeId: page.changeId,
        section: page.section,
        returnedBytes: page.returnedBytes,
        ...(page.section === 'evidence' ? { truncated: page.truncated } : {}),
      };
      return page;
    });
  }
  search(context: Context, input: unknown): Result<TextSearchPage> {
    const result = this.queryWithTool(context, input, 'text_search');
    // The shared implementation parses TextSearchSchema and cannot return a no-text page.
    return result as Result<TextSearchPage>;
  }
  query(context: Context, input: unknown): Result<QueryPage> {
    return this.queryWithTool(context, input, 'objects_query');
  }
  private queryWithTool(
    context: Context,
    input: unknown,
    tool: 'objects_query' | 'text_search',
  ): Result<QueryPage> {
    const parsed = safe(() =>
      parse(
        tool === 'text_search'
          ? TextSearchSchema
          : context.kind === 'human'
            ? HumanQuerySchema
            : QuerySchema,
        input,
      ),
    );
    if (!parsed.ok) return parsed;
    const p = parsed.value;
    return this.read(context, tool, (a, audit) => {
      if (p.filter.projectId) {
        this.allow(a, p.filter.projectId);
        if (this.load(p.filter.projectId).kind !== 'project')
          fail('INVALID_INPUT', undefined, 'filter.projectId');
      }
      const scope = this.scopedSql(a);
      const sequence = this.store.status().authoritySequence;
      const request = { ...p, cursor: undefined };
      const queryDigest = digest(tool === 'objects_query' ? request : { tool, request });
      let afterId = '';
      if (p.cursor) {
        const cursor = CursorSchema.safeParse(
          tool === 'text_search'
            ? decodeContextCursor(this.store.secret, p.cursor)
            : decodeCursor(this.store.secret, p.cursor),
        );
        if (!cursor.success) fail('INVALID_CURSOR');
        if (cursor.data.queryDigest !== queryDigest) fail('INVALID_CURSOR');
        if (cursor.data.scopeDigest !== this.scopeDigest(a) || cursor.data.atSequence !== sequence)
          fail('CURSOR_STALE');
        afterId = cursor.data.afterId;
      }
      const lifecycle =
        context.kind === 'human' && 'lifecycle' in p.filter ? p.filter.lifecycle : 'active';
      const predicates = [scope.sql, 'o.id>?'];
      if (lifecycle !== 'all')
        predicates.push(
          lifecycle === 'archived' ? "r.lifecycle='archived'" : "r.lifecycle='active'",
        );
      const params: SQLInputValue[] = [...scope.values, afterId];
      if (p.filter.kind) {
        predicates.push('o.kind=?');
        params.push(p.filter.kind);
      }
      if (p.filter.projectId) {
        predicates.push(
          "EXISTS(SELECT 1 FROM json_each(r.content_json,'$.relations') e WHERE json_extract(e.value,'$.predicate')='belongs_to' AND json_extract(e.value,'$.target.objectId')=?)",
        );
        params.push(p.filter.projectId);
      }
      if (p.filter.property) {
        const { key, equals } = p.filter.property;
        const fieldPath = '$.properties.' + key;
        if (equals === null) {
          predicates.push("json_type(r.content_json,?)='null'");
          params.push(fieldPath + '.value');
        } else {
          const allowedTypes =
            typeof equals === 'string'
              ? "('text','select','date')"
              : typeof equals === 'boolean'
                ? "('boolean')"
                : "('number')";
          predicates.push(
            `json_extract(r.content_json,?) IN ${allowedTypes} AND json_extract(r.content_json,?)=?`,
          );
          params.push(
            fieldPath + '.type',
            fieldPath + '.value',
            typeof equals === 'boolean' ? Number(equals) : equals,
          );
        }
      }
      let searchMode: QueryPage['searchMode'] = 'none';
      if (p.filter.text) {
        const q = normalize(p.filter.text);
        predicates.push('instr(s.normalized,?)>0');
        params.push(q);
        searchMode = 'literal';
        if (
          lifecycle !== 'all' &&
          lifecycle !== 'archived' &&
          Array.from(q).length >= 3 &&
          /[\p{L}\p{N}]{3}/u.test(q) &&
          !Array.from(q).some((c) => c.codePointAt(0)! < 32)
        ) {
          predicates.push('o.id IN (SELECT object_id FROM search_fts WHERE search_fts MATCH ?)');
          params.push('"' + q.replaceAll('"', '""') + '"');
          searchMode = 'trigram-literal';
        }
      }
      const rows = this.store.all(
        `SELECT o.id FROM objects o JOIN revisions r ON r.object_id=o.id AND r.revision=o.head JOIN search_projection s ON s.object_id=o.id WHERE ${predicates.join(' AND ')} ORDER BY o.id LIMIT ?`,
        ...params,
        p.limit + 1,
      );
      const candidates: ObjectSummary[] = rows.slice(0, p.limit).map((row) => {
        const object = this.load(String(row.id));
        return {
          ref: { mode: 'pinned', objectId: object.id, revision: object.revision },
          title: object.content.title,
          kind: object.kind,
          lifecycle: object.lifecycle,
          digest: object.digest,
          updatedAt: object.createdAt,
        };
      });
      const make = (count: number): QueryPage => {
        const truncated = rows.length > count;
        return measured({
          items: candidates.slice(0, count),
          executed: p.filter,
          scope: this.summaryScope(a),
          authoritySequence: sequence,
          nextCursor:
            truncated && count > 0
              ? encodeCursor(this.store.secret, {
                  version: 1,
                  queryDigest,
                  scopeDigest: this.scopeDigest(a),
                  atSequence: sequence,
                  afterId: candidates[count - 1]!.ref.objectId,
                })
              : null,
          truncated,
          returnedBytes: 0,
          searchMode,
        });
      };
      let count = candidates.length;
      let page = make(count);
      while (page.returnedBytes > p.maxBytes && count > 0) page = make(--count);
      if (page.returnedBytes > p.maxBytes || (count === 0 && candidates.length))
        fail('LIMIT_EXCEEDED', { requiredBytes: make(1).returnedBytes });
      audit.delivered = page.items.map((item) => ({ ref: item.ref, section: 'summary' }));
      audit.details = {
        executedFilter: canonical(p.filter),
        limit: p.limit,
        truncated: page.truncated,
        returnedBytes: page.returnedBytes,
        searchMode,
      };
      return page;
    });
  }
  readFragment(context: Context, input: unknown): Result<ReadPage> {
    const parsed = safe(() => parse(ReadSchema, input));
    if (!parsed.ok) return parsed;
    const p = parsed.value;
    return this.read(context, 'object_read', (a, audit) => {
      let objectId: string;
      let revision: number | undefined;
      let start = 0;
      let section: 'summary' | 'body' | 'properties' | 'relations';
      let expectedDigest: string | null = null;
      if ('cursor' in p) {
        const result = ReadCursorSchema.safeParse(decodeCursor(this.store.secret, p.cursor));
        if (!result.success) fail('INVALID_CURSOR');
        const c = result.data;
        if (c.instanceId !== this.store.instanceId || c.scopeDigest !== this.scopeDigest(a))
          fail('CURSOR_STALE');
        objectId = c.ref.objectId;
        revision = c.ref.revision;
        section = c.section;
        start = c.nextOffset;
        expectedDigest = c.digest;
      } else {
        objectId = p.ref.objectId;
        revision = p.ref.mode === 'pinned' ? p.ref.revision : undefined;
        section = p.section;
      }
      this.allow(a, objectId);
      const object = this.load(objectId, revision);
      if (expectedDigest && object.digest !== expectedDigest) fail('INTEGRITY_FAILURE');
      const ref = { mode: 'pinned' as const, objectId, revision: object.revision };
      const envelope = {
        ref,
        digest: object.digest,
        returnedBytes: 0,
        unavailableReferences: object.content.relations.some(
          (r) => !this.visible(a, r.target.objectId),
        ),
        truncated: false,
        nextCursor: null,
      };
      let page: ReadPage;
      if (section === 'summary') {
        page = measured({
          ...envelope,
          section,
          title: object.content.title,
          kind: object.kind,
          currentRevision: Number(
            this.store.one('SELECT head FROM objects WHERE id=?', objectId).head,
          ),
          origin: object.origin,
          lifecycle: object.lifecycle,
          protectedFields: object.policy.protectedFields,
          knowledgeReviewedRevision: object.knowledgeReview?.reviewedRevision ?? null,
        });
        if (page.returnedBytes > p.maxBytes)
          fail('LIMIT_EXCEEDED', { requiredBytes: page.returnedBytes });
      } else {
        const body = section === 'body' ? Array.from(object.content.body) : [];
        const properties =
          section === 'properties'
            ? Object.entries(object.content.properties)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, field]) => ({ key, field }))
            : [];
        const relations =
          section === 'relations'
            ? object.content.relations
                .filter((r) => this.visible(a, r.target.objectId))
                .sort((a, b) => a.id.localeCompare(b.id, 'en'))
            : [];
        const total =
          section === 'body'
            ? body.length
            : section === 'properties'
              ? properties.length
              : relations.length;
        if (start > total) fail('INVALID_CURSOR');
        const make = (end: number): ReadPage => {
          const nextCursor =
            end < total
              ? encodeCursor(this.store.secret, {
                  version: 1,
                  instanceId: this.store.instanceId,
                  scopeDigest: this.scopeDigest(a),
                  ref,
                  digest: object.digest,
                  section,
                  nextOffset: end,
                })
              : null;
          const common = { ...envelope, truncated: end < total, nextCursor };
          if (section === 'body')
            return measured({
              ...common,
              section,
              text: body.slice(start, end).join(''),
              range: { unit: 'unicode-code-points', start, endExclusive: end, total },
            });
          const range = { unit: 'entries' as const, start, endExclusive: end, total };
          return section === 'properties'
            ? measured({ ...common, section, entries: properties.slice(start, end), range })
            : measured({
                ...common,
                section: 'relations',
                entries: relations.slice(start, end),
                range,
              });
        };
        // Binary search only over complete code points / entries; measured budget includes Result and cursor.
        let low = start;
        let high = total;
        const complete = make(total);
        if (complete.returnedBytes <= p.maxBytes) low = total;
        else high = Math.max(start, total - 1);
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (make(mid).returnedBytes <= p.maxBytes) low = mid;
          else high = mid - 1;
        }
        page = make(low);
        if (page.returnedBytes > p.maxBytes || (low === start && start < total))
          fail('LIMIT_EXCEEDED', { requiredBytes: make(Math.min(start + 1, total)).returnedBytes });
        if (section === 'relations')
          audit.details.unavailableRelations = relations.length < object.content.relations.length;
      }
      const range = 'range' in page ? page.range : undefined;
      audit.delivered = [{ ref, section, ...(range ? { range } : {}) }];
      audit.details = {
        ...audit.details,
        returnedBytes: page.returnedBytes,
        truncated: page.truncated,
      };
      return page;
    });
  }
  changes(context: Context, input: unknown): Result<SequencePage<ChangeSummary>> {
    const p = safe(() => parse(PageRequestSchema, input));
    if (!p.ok) return p;
    return this.read(context, 'changes_list', (a, audit) => {
      const through = p.value.through ?? this.store.status().authoritySequence;
      if (through > this.store.status().authoritySequence || (p.value.after ?? 0) > through)
        fail('INVALID_INPUT');
      const scope = this.scopedSql(a, 'object_id');
      const rows = this.store.all(
        `SELECT * FROM changes WHERE seq>? AND seq<=? AND ${context.kind === 'human' ? '1=1' : scope.sql} ORDER BY seq LIMIT ?`,
        p.value.after ?? 0,
        through,
        ...(context.kind === 'human' ? [] : scope.values),
        p.value.limit + 1,
      );
      const reader = this.contextReader(a);
      const items: ChangeSummary[] = rows.slice(0, p.value.limit).map((r) => ({
        acceptedChangeReadable: reader.acceptedChangeReadable(String(r.id)),
        sequence: Number(r.seq),
        id: String(r.id),
        action: String(r.action),
        objectId: r.object_id === null ? null : String(r.object_id),
        beforeRevision: r.before_revision === null ? null : Number(r.before_revision),
        afterRevision: r.after_revision === null ? null : Number(r.after_revision),
        proposalId: r.proposal_id === null ? null : String(r.proposal_id),
        actor: rowJson(r, 'actor_json'),
        recordedAt: String(r.recorded_at),
      }));
      audit.delivered = items
        .filter((c) => c.objectId && c.afterRevision)
        .map((c) => ({
          ref: { mode: 'pinned', objectId: c.objectId!, revision: c.afterRevision! },
        }));
      audit.details = { truncated: rows.length > items.length, through };
      return {
        items,
        through,
        nextAfter: rows.length > items.length ? items.at(-1)!.sequence : null,
        truncated: rows.length > items.length,
      };
    });
  }
  activities(context: Context, input: unknown): Result<SequencePage<ActivityEntry>> {
    const p = safe(() => parse(PageRequestSchema, input));
    if (!p.ok) return p;
    return this.read(
      context,
      'activity.list',
      () => {
        const through = p.value.through ?? this.store.status().activitySequence;
        if (through > this.store.status().activitySequence || (p.value.after ?? 0) > through)
          fail('INVALID_INPUT');
        const rows = this.store.all(
          'SELECT * FROM activity WHERE id>? AND id<=? ORDER BY id LIMIT ?',
          p.value.after ?? 0,
          through,
          p.value.limit + 1,
        );
        const items: ActivityEntry[] = rows.slice(0, p.value.limit).map((r) => ({
          id: Number(r.id),
          kind: String(r.kind),
          stage: r.kind === 'tool.result_prepared' ? 'prepared' : 'committed-change',
          actor: rowJson(r, 'actor_json'),
          recordedAt: String(r.recorded_at),
          objectId: r.object_id === null ? null : String(r.object_id),
          proposalId: r.proposal_id === null ? null : String(r.proposal_id),
          authoritySequence: r.authority_seq === null ? null : Number(r.authority_seq),
          tool: r.tool === null ? null : String(r.tool),
          delivered: rowJson(r, 'delivered_json'),
          details: rowJson(r, 'details_json'),
        }));
        return {
          items,
          through,
          nextAfter: rows.length > items.length ? items.at(-1)!.id : null,
          truncated: rows.length > items.length,
        };
      },
      true,
    );
  }
  operationStatus(context: Context, input: unknown): Result<OperationStatus> {
    const p = safe(() => parse(OperationStatusSchema, input));
    if (!p.ok) return p;
    return this.read(context, 'operation_status', (a) => {
      const row = this.store.maybe(
        'SELECT * FROM receipts WHERE namespace=? AND op_key=?',
        a.actor.namespace,
        p.value.operationKey,
      );
      if (!row)
        return {
          state: 'not_found',
          operationKey: p.value.operationKey,
          interpretation: 'not_a_failure_confirmation',
        };
      rowJson<string[]>(row, 'access_json').forEach((id) => this.allow(a, id));
      const receipt = rowJson<ReceiptSummary>(row, 'summary_json');
      const candidate = receipt.proposalId
        ? this.store.maybe('SELECT * FROM proposals WHERE id=?', receipt.proposalId)
        : undefined;
      return {
        state: 'recorded',
        receipt,
        currentProposal: candidate
          ? this.proposalSummary(this.proposal(candidate), a.actor.namespace)
          : null,
      };
    });
  }
}
