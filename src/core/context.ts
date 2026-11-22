import { z } from 'zod';
import type { SQLInputValue } from 'node:sqlite';
import {
  DigestSchema,
  IdSchema,
  PinnedRefSchema,
  ProposeSchema,
  SequenceSchema,
  type PinnedRef,
  type ProposalInput,
} from '../contracts/schema.js';
import {
  RelationsExpandInitialSchema,
  type AcceptedChangeEvidencePage,
  type AcceptedChangePage,
  type AcceptedChangeReadInput,
  type AcceptedEvidenceItem,
  type ExpandedEdge,
  type RelationsExpandInput,
  type RelationsExpandInitial,
  type RelationsExpandPage,
  type SchemaDescribeInput,
  type SchemaDescription,
} from '../contracts/context.js';
import type { ObjectSnapshot, ObjectSummary, ScopeSummary } from '../contracts/core.js';
import { Store, type Row } from './storage.js';
import {
  CoreError,
  MAX_OBJECT_BYTES,
  checkedJson,
  decodeCursor,
  digest,
  encodeCursor,
  fail,
  measured,
} from './support.js';

const graphParams = RelationsExpandInitialSchema.omit({ maxBytes: true });
const cursorBase = {
  version: z.literal(1),
  instanceId: IdSchema,
  scopeDigest: DigestSchema,
  authoritySequence: SequenceSchema,
  nextOffset: SequenceSchema,
};
const graphCursor = z.strictObject({
  ...cursorBase,
  tool: z.literal('relations_expand'),
  params: graphParams,
});
const evidenceCursor = z.strictObject({
  ...cursorBase,
  tool: z.literal('accepted_change_read'),
  params: z.strictObject({ changeId: IdSchema, section: z.literal('evidence') }),
});
// Read only the original accepted business association; never publish the receipt namespace/key.
const appliedReceipt = z.object({
  command: z.literal('proposal.review'),
  outcome: z.literal('succeeded'),
  changeId: IdSchema,
  business: z.object({
    kind: z.literal('review'),
    outcome: z.literal('applied'),
    proposalId: IdSchema,
    payloadHash: DigestSchema,
    objectRef: PinnedRefSchema,
    authoritySequence: SequenceSchema,
    changeId: IdSchema,
  }),
});
type AcceptedRecord = {
  change: Row;
  proposalId: string;
  payload: ProposalInput;
  target: ObjectSnapshot;
  current: ObjectSnapshot;
};
type ContextPorts = {
  load(id: string, revision?: number): ObjectSnapshot;
  visible(id: string): boolean;
  scope: ScopeSummary;
  ownerScope: { sql: string; values: SQLInputValue[] };
};
const pin = (object: ObjectSnapshot): PinnedRef => ({
  mode: 'pinned',
  objectId: object.id,
  revision: object.revision,
});
const pinKey = (ref: PinnedRef): string => `${ref.objectId}:${ref.revision}`;
const summary = (object: ObjectSnapshot): ObjectSummary => ({
  ref: pin(object),
  title: object.content.title,
  kind: object.kind,
  lifecycle: object.lifecycle,
  digest: object.digest,
  updatedAt: object.createdAt,
});
const WORK_EDGES = 5_000;

/** Reject noncanonical base64url spellings before the shared authenticated decoder. */
export function decodeContextCursor(secret: string, text: string): unknown {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(text)) fail('INVALID_CURSOR');
  for (const part of text.split('.')) {
    if (Buffer.from(part, 'base64url').toString('base64url') !== part) fail('INVALID_CURSOR');
  }
  return decodeCursor(secret, text);
}

/** Composes existing authority in the Engine's authenticated read transaction. No new store. */
export class ContextReader {
  private readonly loaded = new Map<string, ObjectSnapshot>();
  constructor(
    private readonly store: Store,
    private readonly ports: ContextPorts,
  ) {}

  private load(id: string, revision?: number): ObjectSnapshot {
    const key = `${id}:${revision ?? 'current'}`;
    let object = this.loaded.get(key);
    if (!object) {
      object = this.ports.load(id, revision);
      this.loaded.set(key, object);
    }
    return object;
  }
  private available(id: string, revision?: number): ObjectSnapshot | null {
    if (!this.ports.visible(id)) return null;
    try {
      return this.load(id, revision);
    } catch (error) {
      if (error instanceof CoreError && error.failure.error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }
  private meta() {
    return {
      spaceId: this.store.spaceId,
      instanceId: this.store.instanceId,
      scope: this.ports.scope,
      authoritySequence: this.store.status().authoritySequence,
      returnedBytes: 0,
    };
  }
  private checkCursor(cursor: z.infer<typeof evidenceCursor> | z.infer<typeof graphCursor>) {
    if (cursor.instanceId !== this.store.instanceId) fail('INVALID_CURSOR');
    if (
      cursor.scopeDigest !== this.ports.scope.digest ||
      cursor.authoritySequence !== this.store.status().authoritySequence
    )
      fail('CURSOR_STALE');
  }
  private cursor(
    tool: 'relations_expand' | 'accepted_change_read',
    params: unknown,
    nextOffset: number,
  ) {
    const value = encodeCursor(this.store.secret, {
      version: 1,
      tool,
      params,
      nextOffset,
      instanceId: this.store.instanceId,
      scopeDigest: this.ports.scope.digest,
      authoritySequence: this.store.status().authoritySequence,
    });
    if (value.length > 2_048) fail('LIMIT_EXCEEDED');
    return value;
  }
  private fit<T extends { returnedBytes: number }>(page: T, maxBytes: number): T {
    if (page.returnedBytes > maxBytes)
      fail('LIMIT_EXCEEDED', { requiredBytes: page.returnedBytes });
    return page;
  }

  describe(input: SchemaDescribeInput): SchemaDescription {
    return this.fit(
      measured<SchemaDescription>({
        ...this.meta(),
        definitionsVersion: 1,
        describedKind: input.kind ?? null,
        kinds: input.kind ? [input.kind] : ['document', 'project', 'record', 'asset'],
        contentFields: [
          { name: 'title', valueShape: 'text', agentUpdate: 'allowed-by-policy' },
          { name: 'body', valueShape: 'text', agentUpdate: 'allowed-by-policy' },
          { name: 'properties', valueShape: 'typed-map', agentUpdate: 'values-only' },
          { name: 'relations', valueShape: 'relation-list', agentUpdate: 'allowed-by-policy' },
        ],
        propertyModel: 'per-object',
        propertyTypes: ['text', 'number', 'boolean', 'date', 'select'],
        relationDefinitions: [
          {
            predicate: 'belongs_to',
            targetKind: 'project',
            referenceMode: 'current',
            meaning: 'membership',
          },
          {
            predicate: 'related',
            targetKind: null,
            referenceMode: 'current',
            meaning: 'association',
          },
          { predicate: 'source', targetKind: null, referenceMode: 'pinned', meaning: 'evidence' },
          { predicate: 'uses', targetKind: 'asset', referenceMode: 'either', meaning: 'asset-use' },
          {
            predicate: 'continues_from',
            targetKind: null,
            referenceMode: 'either',
            meaning: 'continuation',
          },
        ],
        filterKeys: ['kind', 'projectId', 'text', 'property.equals'],
        humanOwned: ['origin', 'protection', 'grants', 'knowledge-review'],
        semantics: {
          nulls: 'null-empty-zero-and-missing-are-distinct',
          fieldDefinitions: 'agent-update-values-only',
          dates: 'authored-date-not-save-time',
          history: 'accepted-revisions-not-temporal-facts',
          locators: 'advisory-within-pinned-revision',
        },
        limits: {
          objectBytes: MAX_OBJECT_BYTES,
          fieldBytes: 32_768,
          properties: 64,
          relations: 100,
          readBytes: 65_536,
        },
      }),
      input.maxBytes,
    );
  }

  private accepted(changeId: string): AcceptedRecord | null {
    const change = this.store.maybe('SELECT * FROM changes WHERE id=?', changeId);
    if (
      !change ||
      change.action !== 'proposal.applied' ||
      !change.object_id ||
      !change.proposal_id ||
      change.after_revision === null ||
      !this.ports.visible(String(change.object_id))
    )
      return null;
    const receipts = this.store.all(
      `SELECT summary_json FROM receipts WHERE command='proposal.review'
       AND json_valid(summary_json) AND json_extract(summary_json,'$.changeId')=? LIMIT 2`,
      changeId,
    );
    if (receipts.length === 0) return null;
    if (receipts.length !== 1) fail('INTEGRITY_FAILURE');
    const receipt = appliedReceipt.safeParse(checkedJson(receipts[0]!.summary_json));
    if (!receipt.success) fail('INTEGRITY_FAILURE');
    const business = receipt.data.business;
    const proposal = this.store.maybe(
      'SELECT * FROM proposals WHERE id=?',
      String(change.proposal_id),
    );
    if (!proposal) fail('INTEGRITY_FAILURE');
    const parsed = ProposeSchema.safeParse(checkedJson(proposal.payload_json));
    if (!parsed.success) fail('INTEGRITY_FAILURE');
    const payload = parsed.data;
    const targetId = payload.action === 'update' ? payload.targetId : payload.newObject.id;
    const baseRevision = payload.action === 'update' ? payload.baseRevision : null;
    if (
      digest({ payload, grantId: proposal.grant_id }) !== proposal.payload_hash ||
      proposal.target_id !== targetId ||
      proposal.action !== payload.action ||
      proposal.base_revision !== baseRevision ||
      change.object_id !== targetId ||
      change.before_revision !== baseRevision ||
      business.proposalId !== change.proposal_id ||
      business.payloadHash !== proposal.payload_hash ||
      business.objectRef.objectId !== targetId ||
      business.objectRef.revision !== change.after_revision ||
      proposal.result_revision !== change.after_revision ||
      business.changeId !== changeId ||
      business.authoritySequence !== change.seq
    )
      fail('INTEGRITY_FAILURE');
    const target = this.available(targetId, Number(change.after_revision));
    const current = this.available(targetId);
    if (!target || !current) return null;
    // The current publisher always creates a revision for proposal.applied. Check
    // its own immutable association as well as the original successful receipt.
    if (target.changeId !== changeId || target.authoritySequence !== Number(change.seq))
      fail('INTEGRITY_FAILURE');
    return { change, proposalId: String(proposal.id), payload, target, current };
  }
  acceptedChangeReadable(changeId: string): boolean {
    return this.accepted(changeId) !== null;
  }
  readAcceptedChange(input: AcceptedChangeReadInput): AcceptedChangePage {
    let params: { changeId: string; section: 'summary' | 'evidence' };
    let start = 0;
    if ('cursor' in input) {
      const parsed = evidenceCursor.safeParse(decodeContextCursor(this.store.secret, input.cursor));
      if (!parsed.success) fail('INVALID_CURSOR');
      this.checkCursor(parsed.data);
      params = parsed.data.params;
      start = parsed.data.nextOffset;
    } else params = { changeId: input.changeId, section: input.section };
    const accepted = this.accepted(params.changeId);
    if (!accepted) fail('NOT_FOUND');
    const items: AcceptedEvidenceItem[] = [];
    let unavailableReferences = false;
    for (const ref of accepted.payload.sources) {
      const source = this.available(ref.objectId, ref.revision);
      const current = source && this.available(ref.objectId);
      if (!source || !current) {
        unavailableReferences = true;
        continue;
      }
      items.push({
        ref,
        digest: source.digest,
        title: source.content.title,
        kind: source.kind,
        currentRevision: current.revision,
        availability: 'available',
      });
    }
    const base = {
      ...this.meta(),
      changeId: params.changeId,
      proposalId: accepted.proposalId,
      target: pin(accepted.target),
    };
    if (params.section === 'summary')
      return this.fit(
        measured({
          ...base,
          section: 'summary' as const,
          acceptedSequence: Number(accepted.change.seq),
          acceptedAt: String(accepted.change.recorded_at),
          base:
            accepted.payload.action === 'update'
              ? {
                  mode: 'pinned' as const,
                  objectId: accepted.target.id,
                  revision: accepted.payload.baseRevision,
                }
              : null,
          targetDigest: accepted.target.digest,
          currentTargetRevision: accepted.current.revision,
          declared: { purpose: accepted.payload.purpose, reason: accepted.payload.reason },
          evidenceStatus:
            accepted.payload.sources.length === 0
              ? ('none-declared' as const)
              : !unavailableReferences
                ? ('available' as const)
                : items.length
                  ? ('partly-unavailable' as const)
                  : ('unavailable' as const),
        }),
        input.maxBytes,
      );
    if (start > items.length) fail('INVALID_CURSOR');
    const make = (count: number): AcceptedChangeEvidencePage =>
      measured({
        ...base,
        section: 'evidence',
        items: items.slice(start, start + count),
        unavailableReferences,
        range: { unit: 'entries', start, endExclusive: start + count },
        truncated: start + count < items.length,
        nextCursor:
          start + count < items.length && count > 0
            ? this.cursor('accepted_change_read', params, start + count)
            : null,
      });
    let count = items.length - start;
    let page = make(count);
    while (page.returnedBytes > input.maxBytes && count > 0) page = make(--count);
    if (count === 0 && start < items.length)
      fail('LIMIT_EXCEEDED', { requiredBytes: make(1).returnedBytes });
    return this.fit(page, input.maxBytes);
  }

  expandRelations(input: RelationsExpandInput): RelationsExpandPage {
    let params: Omit<RelationsExpandInitial, 'maxBytes'>;
    let start = 0;
    if ('cursor' in input) {
      const parsed = graphCursor.safeParse(decodeContextCursor(this.store.secret, input.cursor));
      if (!parsed.success) fail('INVALID_CURSOR');
      this.checkCursor(parsed.data);
      params = parsed.data.params;
      start = parsed.data.nextOffset;
    } else {
      const { maxBytes: _maxBytes, ...initial } = input;
      void _maxBytes;
      params = initial;
    }
    if (!this.ports.visible(params.seedId)) fail('FORBIDDEN');
    const seed = this.load(params.seedId);
    const nodes = new Map<string, ObjectSummary>([[pinKey(pin(seed)), summary(seed)]]);
    const edges: ExpandedEdge[] = [];
    const edgeKeys = new Set<string>();
    const expanded = new Set<string>();
    const stopReasons = new Set<RelationsExpandPage['stopReasons'][number]>();
    let unavailableReferences = false;
    let work = 0;
    let frontier = [seed.id];
    walk: for (let depth = 1; depth <= params.maxDepth; depth++) {
      const next = new Set<string>();
      for (const objectId of frontier.sort()) {
        if (expanded.has(objectId)) continue;
        expanded.add(objectId);
        const candidates: { ownerId: string; relationId: string }[] = [];
        if (params.direction === 'outgoing') {
          const owner = this.load(objectId);
          for (const relation of owner.content.relations
            .filter((r) => params.predicates.includes(r.predicate))
            .sort((a, b) => a.id.localeCompare(b.id))) {
            // An unauthorized destination is neither a candidate count nor a frontier node.
            if (!this.ports.visible(relation.target.objectId)) {
              unavailableReferences = true;
              continue;
            }
            candidates.push({ ownerId: owner.id, relationId: relation.id });
          }
        } else {
          const rows = this.store.all(
            `SELECT o.id AS owner_id,json_extract(e.value,'$.id') AS relation_id
             FROM objects o JOIN revisions r ON r.object_id=o.id AND r.revision=o.head,
             json_each(r.content_json,'$.relations') e
             WHERE ${this.ports.ownerScope.sql} AND json_extract(e.value,'$.target.objectId')=?
             AND json_extract(e.value,'$.predicate') IN (${params.predicates.map(() => '?').join(',')})
             ORDER BY o.id,json_extract(e.value,'$.id') LIMIT ?`,
            ...this.ports.ownerScope.values,
            objectId,
            ...params.predicates,
            WORK_EDGES - work,
          );
          for (const row of rows)
            candidates.push({ ownerId: String(row.owner_id), relationId: String(row.relation_id) });
        }
        for (const { ownerId, relationId } of candidates) {
          // Resolve lazily: reaching a traversal cap does not load the rest of the SQL page.
          const owner = this.load(ownerId);
          const relation = owner.content.relations.find((r) => r.id === relationId);
          if (!relation) fail('INTEGRITY_FAILURE');
          if (!this.ports.visible(owner.id) || !this.ports.visible(relation.target.objectId)) {
            unavailableReferences = true;
            continue;
          }
          const key = `${pinKey(pin(owner))}:${relation.id}`;
          work++;
          if (edgeKeys.has(key)) {
            if (work >= WORK_EDGES) {
              stopReasons.add('work-budget');
              break walk;
            }
            continue;
          }
          edgeKeys.add(key);
          const target = this.available(
            relation.target.objectId,
            relation.target.mode === 'pinned' ? relation.target.revision : undefined,
          );
          if (!target) unavailableReferences = true;
          else {
            const endpoints = [owner, target];
            const newNodes = new Map(
              endpoints.filter((o) => !nodes.has(pinKey(pin(o)))).map((o) => [pinKey(pin(o)), o]),
            );
            if (nodes.size + newNodes.size > params.maxNodes) {
              stopReasons.add('max-nodes');
              break walk;
            }
            if (edges.length >= params.maxEdges) {
              stopReasons.add('max-edges');
              break walk;
            }
            for (const object of endpoints) nodes.set(pinKey(pin(object)), summary(object));
            edges.push({
              owner: pin(owner),
              relation,
              resolvedTarget: pin(target),
              depth: depth as 1 | 2,
            });
            const nextId =
              params.direction === 'incoming'
                ? owner.id
                : relation.target.mode === 'current'
                  ? target.id
                  : null;
            if (nextId && !expanded.has(nextId)) next.add(nextId);
          }
          if (work >= WORK_EDGES) {
            stopReasons.add('work-budget');
            break walk;
          }
        }
      }
      frontier = [...next];
    }
    if (start > edges.length) fail('INVALID_CURSOR');
    const make = (count: number): RelationsExpandPage => {
      const selected = edges.slice(start, start + count);
      const pageNodeKeys = new Set([
        pinKey(pin(seed)),
        ...selected.flatMap((e) => [pinKey(e.owner), pinKey(e.resolvedTarget)]),
      ]);
      return measured({
        ...this.meta(),
        seed: summary(seed),
        direction: params.direction,
        matching: 'object-identity',
        pinnedTargets: 'terminal',
        nodes: [...nodes].filter(([key]) => pageNodeKeys.has(key)).map(([, node]) => node),
        edges: selected,
        unavailableReferences,
        traversalCompleteWithinScope: stopReasons.size === 0,
        stopReasons: [...stopReasons],
        truncated: start + count < edges.length,
        nextCursor:
          start + count < edges.length && count > 0
            ? this.cursor('relations_expand', params, start + count)
            : null,
      });
    };
    let count = edges.length - start;
    let page = make(count);
    while (page.returnedBytes > input.maxBytes && count > 0) page = make(--count);
    if (count === 0 && start < edges.length)
      fail('LIMIT_EXCEEDED', { requiredBytes: make(1).returnedBytes });
    return this.fit(page, input.maxBytes);
  }
}
