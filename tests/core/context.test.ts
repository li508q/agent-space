import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { cpSync } from 'node:fs';
import { Space } from '../../src/core/index.js';
import type { HumanServices, ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import type { ObjectContent, PinnedRef } from '../../src/contracts/schema.js';
import {
  AcceptedChangePageSchema,
  RelationsExpandPageSchema,
  SchemaDescriptionSchema,
  TextSearchPageSchema,
  type AcceptedChangePage,
  type RelationsExpandPage,
} from '../../src/contracts/context.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

const pin = (objectId: string, revision: number, locator?: string): PinnedRef => ({
  mode: 'pinned',
  objectId,
  revision,
  ...(locator ? { locator } : {}),
});
const related = (n: number, objectId: string): ObjectContent['relations'][number] => ({
  id: id(n),
  predicate: 'related',
  target: { mode: 'current', objectId },
});
const source = (n: number, ref: PinnedRef): ObjectContent['relations'][number] => ({
  id: id(n),
  predicate: 'source',
  target: ref,
});
function create(human: HumanServices, n: number, value: ObjectContent = content()) {
  return ok(
    human.createObject({ operationKey: `seed:${n}`, id: id(n), kind: 'document', content: value }),
  ).object;
}
function apply(human: HumanServices, proposal: ProposalReceipt, key: string) {
  return ok(
    human.reviewProposal({
      operationKey: key,
      proposalId: proposal.id,
      expectedProposalVersion: proposal.statusVersion,
      expectedPayloadHash: proposal.payloadHash,
      decision: 'accept',
      expectedTarget:
        proposal.baseRevision === null
          ? { state: 'absent' }
          : { state: 'revision', revision: proposal.baseRevision },
    }),
  );
}
function bounded<T extends { returnedBytes: number }>(result: Result<T>, maxBytes: number): T {
  const value = ok(result);
  assert.equal(value.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.ok(value.returnedBytes <= maxBytes);
  return value;
}
const graph = (seedId: string) => ({
  seedId,
  direction: 'outgoing' as const,
  predicates: ['related', 'source'] as ('related' | 'source')[],
  maxDepth: 2 as const,
  maxNodes: 50,
  maxEdges: 50,
  maxBytes: 65_536,
});

test('fixed catalog and literal search reuse scoped query semantics, with separate cursors and tool audit', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 12; n++)
    create(f.human, n, {
      ...content('项目連携 지식 CAFÉ e\u0301 "OR" -literal', 'Same title'),
      properties: {
        value:
          n % 2
            ? { label: '数値', type: 'number', value: 0 }
            : { label: '다른 값', type: 'text', value: '' },
      },
    });
  const a = agent(f.space, f.human, 'grant:catalog');
  const before = ok(f.human.status());
  const discover = ok(a.api.discover());
  assert.equal(discover.implementedTools.length, 10);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: discover })) <= 8_192);
  const catalog = bounded(a.api.describe({ kind: 'record', maxBytes: 16_384 }), 16_384);
  SchemaDescriptionSchema.parse(catalog);
  assert.deepEqual(catalog.kinds, ['record']);
  assert.equal(catalog.propertyModel, 'per-object');
  assert.equal(
    catalog.relationDefinitions.find((r) => r.predicate === 'uses')?.targetKind,
    'asset',
  );
  assert.ok(!JSON.stringify(catalog).includes('数値'));
  const tooSmall = a.api.describe({ maxBytes: 1_024 });
  error(tooSmall, 'LIMIT_EXCEEDED');
  if (!tooSmall.ok) assert.ok(Number(tooSmall.error.params?.requiredBytes) > 1_024);
  for (const text of [
    '项',
    '项目',
    '项目連',
    '連携',
    '지식',
    'CAFÉ',
    'e\u0301',
    '"OR"',
    '-literal',
  ]) {
    const input = { filter: { text }, limit: 50, maxBytes: 65_536 };
    const search = bounded(a.api.search(input), input.maxBytes);
    TextSearchPageSchema.parse(search);
    assert.deepEqual(search.items, ok(a.api.query(input)).items);
    assert.equal(search.items.length, 12);
  }
  const input = { filter: { text: '项目' }, limit: 2, maxBytes: 4_096 };
  const page = bounded(a.api.search(input), input.maxBytes);
  assert.ok(page.nextCursor);
  error(a.api.query({ ...input, cursor: page.nextCursor }), 'INVALID_CURSOR');
  const query = ok(a.api.query(input));
  assert.ok(query.nextCursor);
  error(a.api.search({ ...input, cursor: query.nextCursor }), 'INVALID_CURSOR');
  error(a.api.search({ ...input, filter: { text: '   ' } }), 'INVALID_INPUT');
  error(a.api.describe({ maxBytes: 16_384, actor: 'human' } as never), 'INVALID_INPUT');
  const activity = ok(f.human.activity({ after: before.activitySequence, limit: 50 })).items;
  assert.ok(activity.some((entry) => entry.tool === 'text_search'));
  assert.deepEqual(activity.find((entry) => entry.tool === 'schema_describe')?.delivered, []);
  assert.equal(ok(f.human.status()).authoritySequence, before.authoritySequence);
});

test('another agent follows an accepted change to the old source pin after source update, origin revoke and undo', (t) => {
  const f = fixture(t);
  const target = create(f.human, 1, content('Target v1'));
  let s = create(f.human, 2, content('Source v1', 'Old source title'));
  for (const body of ['Source v2', 'Source v3 · exact evidence'])
    s = ok(
      f.human.saveObject({
        operationKey: `source:${s.revision + 1}`,
        targetId: s.id,
        expectedRevision: s.revision,
        content: { ...s.content, body },
      }),
    ).object;
  const a = agent(f.space, f.human, 'grant:A');
  const b = agent(f.open(), f.human, 'grant:B', {
    scope: { mode: 'objects', objectIds: [target.id, s.id] },
  });
  const candidate = ok(
    a.api.propose({
      operationKey: 'A-private-operation-key',
      action: 'update',
      targetId: target.id,
      baseRevision: 1,
      patch: { body: 'Accepted result without source relations' },
      purpose: 'Shared continuity',
      reason: 'A declared reason, independent of private chat',
      sources: [pin(s.id, 3, 'section:old')],
    }),
  );
  const applied = apply(f.human, candidate, 'human:accept');
  s = ok(
    f.human.saveObject({
      operationKey: 'source:4',
      targetId: s.id,
      expectedRevision: 3,
      content: { ...s.content, title: 'New source title', body: 'Source v4' },
    }),
  ).object;
  ok(
    f.human.updateGrant({
      operationKey: 'revoke:A',
      grantId: a.grant.id,
      expectedGeneration: 1,
      spec: a.spec,
      revoked: true,
    }),
  );
  const changes = ok(b.api.changes({ limit: 50 })).items;
  assert.deepEqual(
    changes.filter((c) => c.acceptedChangeReadable).map((c) => c.id),
    [applied.changeId],
  );
  const summary = bounded(
    b.api.readAcceptedChange({ changeId: applied.changeId, section: 'summary', maxBytes: 32_768 }),
    32_768,
  );
  AcceptedChangePageSchema.parse(summary);
  assert.ok(summary.section === 'summary');
  assert.deepEqual(summary.target, pin(target.id, 2));
  assert.deepEqual(summary.base, pin(target.id, 1));
  assert.equal(summary.declared.reason, 'A declared reason, independent of private chat');
  assert.equal(summary.evidenceStatus, 'available');
  assert.ok(!JSON.stringify(summary).includes('A-private-operation-key'));
  const evidence = bounded(
    b.api.readAcceptedChange({ changeId: applied.changeId, section: 'evidence', maxBytes: 8_192 }),
    8_192,
  );
  assert.ok(evidence.section === 'evidence');
  assert.deepEqual(evidence.items[0]?.ref, pin(s.id, 3, 'section:old'));
  assert.equal(evidence.items[0]?.title, 'Old source title');
  assert.equal(evidence.items[0]?.currentRevision, 4);
  assert.ok(!JSON.stringify(evidence).includes('exact evidence'));
  const body = ok(b.api.read({ ref: pin(s.id, 3), section: 'body', maxBytes: 4_096 }));
  assert.ok(body.section === 'body');
  assert.equal(body.text, 'Source v3 · exact evidence');
  ok(
    f.human.undoChange({
      operationKey: 'undo:accept',
      changeId: applied.changeId,
      expectedRevision: 2,
    }),
  );
  const afterUndo = ok(
    b.api.readAcceptedChange({ changeId: applied.changeId, section: 'summary', maxBytes: 32_768 }),
  );
  assert.ok(afterUndo.section === 'summary');
  assert.deepEqual(afterUndo.target, summary.target);
  assert.equal(afterUndo.currentTargetRevision, 3);
  const targetOnly = agent(f.space, f.human, 'grant:target-only', {
    scope: { mode: 'objects', objectIds: [target.id] },
  });
  const redacted = ok(
    targetOnly.api.readAcceptedChange({
      changeId: applied.changeId,
      section: 'evidence',
      maxBytes: 4_096,
    }),
  );
  assert.ok(redacted.section === 'evidence');
  assert.deepEqual(redacted.items, []);
  assert.equal(redacted.unavailableReferences, true);
  for (const secret of [
    s.id,
    'Old source title',
    'section:old',
    evidence.items[0]!.digest,
    'Source v3',
  ])
    assert.ok(!JSON.stringify(redacted).includes(secret));
  error(targetOnly.api.read({ ref: pin(s.id, 3), section: 'body', maxBytes: 4_096 }), 'FORBIDDEN');
  error(
    targetOnly.api.readAcceptedChange({
      changeId: s.changeId,
      section: 'summary',
      maxBytes: 4_096,
    }),
    'NOT_FOUND',
  );
  const schema = new DatabaseSync(join(f.directory, 'space.sqlite'), { readOnly: true });
  assert.equal(schema.prepare('PRAGMA user_version').get()?.user_version, 2);
  schema.close();
});

test('accepted access belongs to the applied event, including creation; pending/rejected/conflicted/save events stay unreadable', (t) => {
  const f = fixture(t);
  const target = create(f.human, 1);
  const a = agent(f.space, f.human, 'grant', { creation: { enabled: true, kinds: ['document'] } });
  const make = (key: string) =>
    ok(
      a.api.propose({
        operationKey: key,
        action: 'update',
        targetId: target.id,
        baseRevision: 1,
        patch: { body: key },
        purpose: 'Purpose',
        reason: 'Reason',
        sources: [],
      }),
    );
  const pending = make('applied');
  const accepted = apply(f.human, pending, 'apply');
  const stale = make('conflict');
  const conflicted = apply(f.human, stale, 'conflict');
  assert.equal(conflicted.outcome, 'conflicted');
  const rejected = ok(
    f.human.reviewProposal({
      operationKey: 'reject',
      proposalId: stale.id,
      expectedPayloadHash: stale.payloadHash,
      expectedProposalVersion: conflicted.proposal.statusVersion,
      decision: 'reject',
    }),
  );
  const creation = ok(
    a.api.propose({
      operationKey: 'create',
      action: 'create',
      purpose: 'Capture',
      reason: 'New independent note',
      sources: [],
      newObject: { id: id(9), kind: 'document', content: content('Created') },
    }),
  );
  const created = apply(f.human, creation, 'apply:create');
  const createdSummary = ok(
    a.api.readAcceptedChange({ changeId: created.changeId, section: 'summary', maxBytes: 8_192 }),
  );
  assert.ok(createdSummary.section === 'summary');
  assert.equal(createdSummary.base, null);
  assert.deepEqual(createdSummary.target, pin(id(9), 1));
  assert.equal(createdSummary.evidenceStatus, 'none-declared');
  const changes = ok(a.api.changes({ limit: 50 })).items;
  const acceptedIds = [accepted.changeId, created.changeId].sort();
  assert.deepEqual(
    changes
      .filter((c) => c.acceptedChangeReadable)
      .map((c) => c.id)
      .sort(),
    acceptedIds,
  );
  for (const change of changes.filter((c) => !c.acceptedChangeReadable))
    error(
      a.api.readAcceptedChange({ changeId: change.id, section: 'summary', maxBytes: 8_192 }),
      'NOT_FOUND',
    );
  for (const changeId of [conflicted.changeId, rejected.changeId, id(999)])
    error(
      a.api.readAcceptedChange({ changeId, section: 'evidence', maxBytes: 8_192 }),
      'NOT_FOUND',
    );
});

test('evidence paging counts only visible pins, measures the complete Result, and invalidates on authority/scope/revocation', (t) => {
  const f = fixture(t);
  const target = create(f.human, 1);
  const sources = Array.from({ length: 12 }, (_, n) =>
    create(f.human, n + 10, content('Source body', '证据'.repeat(100))),
  );
  const a = agent(f.space, f.human, 'grant:A');
  const b = agent(f.space, f.human, 'grant:B', {
    scope: { mode: 'objects', objectIds: [target.id, ...sources.slice(0, 10).map((s) => s.id)] },
  });
  const candidate = ok(
    a.api.propose({
      operationKey: 'proposal',
      action: 'update',
      targetId: target.id,
      baseRevision: 1,
      purpose: 'Purpose',
      reason: '理由'.repeat(1_000),
      sources: sources.map((s) => pin(s.id, 1, '位'.repeat(240))),
      patch: { body: 'Result' },
    }),
  );
  const accepted = apply(f.human, candidate, 'accept');
  error(
    b.api.readAcceptedChange({ changeId: accepted.changeId, section: 'summary', maxBytes: 1_024 }),
    'LIMIT_EXCEEDED',
  );
  const first = bounded(
    b.api.readAcceptedChange({ changeId: accepted.changeId, section: 'evidence', maxBytes: 4_096 }),
    4_096,
  );
  assert.ok(first.section === 'evidence' && first.nextCursor);
  assert.ok(first.items.length > 0 && first.items.length < 10);
  const refs = [...first.items.map((item) => item.ref)];
  let cursor: string | null = first.nextCursor;
  let end = first.range.endExclusive;
  while (cursor) {
    const page: AcceptedChangePage = bounded(
      b.api.readAcceptedChange({ cursor, maxBytes: 4_096 }),
      4_096,
    );
    AcceptedChangePageSchema.parse(page);
    assert.ok(page.section === 'evidence' && page.items.length > 0);
    assert.equal(page.range.start, end);
    assert.ok(!('total' in page.range));
    refs.push(...page.items.map((item) => item.ref));
    end = page.range.endExclusive;
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    refs,
    sources.slice(0, 10).map((s) => pin(s.id, 1, '位'.repeat(240))),
  );
  assert.equal(first.unavailableReferences, true);
  error(b.api.expandRelations({ cursor: first.nextCursor, maxBytes: 4_096 }), 'INVALID_CURSOR');
  error(
    b.api.readAcceptedChange({ cursor: first.nextCursor.slice(0, -1) + '!', maxBytes: 4_096 }),
    'INVALID_CURSOR',
  );
  ok(
    f.human.saveObject({
      operationKey: 'source:changed',
      targetId: sources[0]!.id,
      expectedRevision: 1,
      content: content('New source'),
    }),
  );
  error(b.api.readAcceptedChange({ cursor: first.nextCursor, maxBytes: 4_096 }), 'CURSOR_STALE');
  const fresh = ok(
    b.api.readAcceptedChange({ changeId: accepted.changeId, section: 'evidence', maxBytes: 4_096 }),
  );
  assert.ok(fresh.section === 'evidence' && fresh.nextCursor);
  assert.equal(fresh.items[0]?.ref.revision, 1);
  const narrowedSpec = { ...b.spec, scope: { mode: 'objects' as const, objectIds: [target.id] } };
  const narrowed = ok(
    f.human.updateGrant({
      operationKey: 'narrow',
      grantId: b.grant.id,
      expectedGeneration: 1,
      spec: narrowedSpec,
      revoked: false,
    }),
  );
  error(b.api.readAcceptedChange({ cursor: fresh.nextCursor, maxBytes: 4_096 }), 'CURSOR_STALE');
  const hidden = ok(
    b.api.readAcceptedChange({ changeId: accepted.changeId, section: 'evidence', maxBytes: 4_096 }),
  );
  assert.ok(hidden.section === 'evidence');
  assert.deepEqual(hidden.items, []);
  ok(
    f.human.updateGrant({
      operationKey: 'revoke',
      grantId: b.grant.id,
      expectedGeneration: narrowed.generation,
      spec: narrowedSpec,
      revoked: true,
    }),
  );
  error(b.api.describe({ maxBytes: 16_384 }), 'FORBIDDEN');
  error(b.api.search({ filter: { text: 'Result' }, limit: 10, maxBytes: 4_096 }), 'FORBIDDEN');
  error(b.api.expandRelations(graph(target.id)), 'FORBIDDEN');
  error(b.api.readAcceptedChange({ cursor: fresh.nextCursor, maxBytes: 4_096 }), 'FORBIDDEN');
});

test('relation BFS separates current identities, terminal evidence pins, incoming identity, cycles and nonpropagating scope', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 5; n++)
    create(f.human, n, content('', n < 4 ? 'Same title' : n === 4 ? 'HIDDEN_TITLE' : 'Source old'));
  const update = (n: number, relations: ObjectContent['relations']) =>
    ok(
      f.human.saveObject({
        operationKey: `links:${n}`,
        targetId: id(n),
        expectedRevision: 1,
        content: { ...ok(f.human.readObject({ objectId: id(n) })).object.content, relations },
      }),
    );
  update(1, [related(101, id(2)), source(102, pin(id(5), 1, 'old-section')), related(103, id(4))]);
  update(2, [related(201, id(1)), related(202, id(3))]);
  update(3, [related(301, id(1))]);
  update(4, [related(401, id(1)), related(402, id(3))]);
  update(5, [related(501, id(3))]);
  const a = agent(f.space, f.human, 'grant:graph', {
    scope: { mode: 'objects', objectIds: [id(1), id(2), id(3), id(5)] },
  });
  const one = bounded(a.api.expandRelations({ ...graph(id(1)), maxDepth: 1 }), 65_536);
  const two = bounded(a.api.expandRelations(graph(id(1))), 65_536);
  RelationsExpandPageSchema.parse(two);
  assert.deepEqual(
    one.edges.map((e) => e.relation.id),
    [id(101), id(102)],
  );
  assert.deepEqual(
    two.edges.map((e) => e.relation.id),
    [id(101), id(102), id(201), id(202)],
  );
  assert.ok(two.edges.every((e) => e.relation.id !== id(501)));
  assert.deepEqual(two.edges[1]?.resolvedTarget, pin(id(5), 1));
  assert.equal(two.edges[1]?.depth, 1);
  assert.equal(two.unavailableReferences, true);
  for (const hidden of [id(4), 'HIDDEN_TITLE', id(402)])
    assert.ok(!JSON.stringify(two).includes(hidden));
  const incoming = ok(
    a.api.expandRelations({ ...graph(id(5)), direction: 'incoming', maxDepth: 1 }),
  );
  assert.deepEqual(incoming.seed.ref, pin(id(5), 2));
  assert.deepEqual(incoming.edges[0]?.resolvedTarget, pin(id(5), 1));
  assert.equal(incoming.nodes.length, 3);
  const incomingTwo = ok(a.api.expandRelations({ ...graph(id(5)), direction: 'incoming' }));
  assert.deepEqual(
    incomingTwo.edges.map((e) => e.relation.id),
    [id(102), id(201), id(301)],
  );
  assert.deepEqual(
    incomingTwo.edges.map((e) => e.depth),
    [1, 2, 2],
  );
  const privateIncoming = ok(
    a.api.expandRelations({ ...graph(id(1)), direction: 'incoming', maxDepth: 1 }),
  );
  assert.deepEqual(
    privateIncoming.edges.map((e) => e.owner.objectId),
    [id(2), id(3)],
  );
  assert.equal(privateIncoming.unavailableReferences, false);
  const capped = ok(a.api.expandRelations({ ...graph(id(1)), maxEdges: 1 }));
  assert.equal(capped.edges.length, 1);
  assert.equal(capped.traversalCompleteWithinScope, false);
  assert.deepEqual(capped.stopReasons, ['max-edges']);
  assert.equal(capped.nextCursor, null);
  const nodeCap = ok(a.api.expandRelations({ ...graph(id(1)), maxNodes: 2 }));
  assert.equal(nodeCap.nodes.length, 2);
  assert.deepEqual(nodeCap.stopReasons, ['max-nodes']);
});

test('relation byte pages recompute one capped walk, audit only their nodes, and reject stale/tampered/cross-instance cursors', (t) => {
  const f = fixture(t);
  const seed = create(f.human, 1);
  for (let n = 10; n < 24; n++) create(f.human, n, content('', '長い名前'.repeat(40)));
  ok(
    f.human.saveObject({
      operationKey: 'links',
      targetId: seed.id,
      expectedRevision: 1,
      content: {
        ...seed.content,
        relations: Array.from({ length: 14 }, (_, n) =>
          source(100 + n, pin(id(10 + n), 1, '位'.repeat(200))),
        ),
      },
    }),
  );
  const a = agent(f.space, f.human, 'grant');
  const first = bounded(
    a.api.expandRelations({ ...graph(seed.id), maxEdges: 10, maxBytes: 4_096 }),
    4_096,
  );
  assert.ok(first.nextCursor && first.edges.length > 0 && first.edges.length < 10);
  assert.equal(first.traversalCompleteWithinScope, false);
  const delivered = ok(
    f.human.activity({ after: ok(f.human.status()).activitySequence - 1, limit: 1 }),
  ).items[0]!;
  assert.deepEqual(
    delivered.delivered.map((item) => item.ref),
    first.nodes.map((item) => item.ref),
  );
  assert.ok(delivered.delivered.every((item) => !item.section));
  assert.equal(delivered.details.resultKind, 'reference-metadata');
  const all = [...first.edges];
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page: RelationsExpandPage = bounded(
      a.api.expandRelations({ cursor, maxBytes: 4_096 }),
      4_096,
    );
    RelationsExpandPageSchema.parse(page);
    assert.ok(page.edges.length > 0);
    all.push(...page.edges);
    cursor = page.nextCursor;
    assert.equal(page.traversalCompleteWithinScope, false);
  }
  assert.equal(all.length, 10);
  assert.equal(new Set(all.map((e) => e.relation.id)).size, 10);
  error(a.api.readAcceptedChange({ cursor: first.nextCursor, maxBytes: 4_096 }), 'INVALID_CURSOR');
  error(
    a.api.expandRelations({ cursor: first.nextCursor + '!', maxBytes: 4_096 }),
    'INVALID_CURSOR',
  );
  const other = fixture(t);
  const foreign = agent(other.space, other.human, 'other:grant');
  error(
    foreign.api.expandRelations({ cursor: first.nextCursor, maxBytes: 4_096 }),
    'INVALID_CURSOR',
  );
  create(f.human, 40);
  error(a.api.expandRelations({ cursor: first.nextCursor, maxBytes: 4_096 }), 'CURSOR_STALE');
});

test('controlled missing retained sources are aggregate unavailable, while corrupt source JSON is an integrity failure', (t) => {
  const f = fixture(t);
  const target = create(f.human, 1);
  const missing = create(f.human, 2, content('Retained source', 'SYNTHETIC_MISSING_TITLE'));
  const available = create(f.human, 3, content('Other retained source'));
  const a = agent(f.space, f.human, 'grant');
  const p = ok(
    a.api.propose({
      operationKey: 'proposal',
      action: 'update',
      targetId: target.id,
      baseRevision: 1,
      patch: { body: 'Accepted' },
      purpose: 'Purpose',
      reason: 'Reason',
      sources: [pin(missing.id, 1, 'MISSING_LOCATOR'), pin(available.id, 1)],
    }),
  );
  const accepted = apply(f.human, p, 'accept');
  ok(
    f.human.saveObject({
      operationKey: 'advance:source',
      targetId: missing.id,
      expectedRevision: 1,
      content: content('New head'),
    }),
  );
  // Fault fixture only: public operations cannot delete immutable retained revisions.
  const fault = new DatabaseSync(join(f.directory, 'space.sqlite'));
  t.after(() => fault.close());
  fault.exec(
    'PRAGMA foreign_keys=OFF; DROP TRIGGER immutable_revision_delete; DROP TRIGGER immutable_revision_update;',
  );
  fault.prepare('DELETE FROM revisions WHERE object_id=? AND revision=1').run(missing.id);
  const summary = ok(
    a.api.readAcceptedChange({ changeId: accepted.changeId, section: 'summary', maxBytes: 8_192 }),
  );
  assert.ok(summary.section === 'summary');
  assert.equal(summary.evidenceStatus, 'partly-unavailable');
  const evidence = ok(
    a.api.readAcceptedChange({ changeId: accepted.changeId, section: 'evidence', maxBytes: 8_192 }),
  );
  assert.ok(evidence.section === 'evidence');
  assert.equal(evidence.unavailableReferences, true);
  assert.deepEqual(
    evidence.items.map((item) => item.ref),
    [pin(available.id, 1)],
  );
  for (const secret of [missing.id, missing.content.title, missing.digest, 'MISSING_LOCATOR'])
    assert.ok(!JSON.stringify(evidence).includes(secret));
  fault
    .prepare("UPDATE revisions SET content_json='not json' WHERE object_id=? AND revision=1")
    .run(available.id);
  error(
    a.api.readAcceptedChange({ changeId: accepted.changeId, section: 'evidence', maxBytes: 8_192 }),
    'INTEGRITY_FAILURE',
  );
});

test('a damaged copy cannot associate a healthy accepted receipt with a revision from a different change or sequence', (t) => {
  const f = fixture(t);
  const target = create(f.human, 1);
  const a = agent(f.space, f.human, 'grant');
  const p = ok(
    a.api.propose({
      operationKey: 'proposal',
      action: 'update',
      targetId: target.id,
      baseRevision: 1,
      patch: { body: 'Accepted' },
      purpose: 'Purpose',
      reason: 'Reason',
      sources: [],
    }),
  );
  const accepted = apply(f.human, p, 'accept');
  f.space.close();
  const copy = join(f.root, 'damaged-copy');
  cpSync(f.directory, copy, { recursive: true });
  const damaged = ok(Space.open(copy));
  const fault = new DatabaseSync(join(copy, 'space.sqlite'));
  t.after(() => {
    fault.close();
    damaged.close();
  });
  const reader = ok(
    damaged.agent({ grantId: a.grant.id, token: a.token, instanceId: accepted.object!.instanceId }),
  );
  fault.exec('DROP TRIGGER immutable_revision_update;');
  fault
    .prepare('UPDATE revisions SET change_id=? WHERE object_id=? AND revision=2')
    .run(id(999), target.id);
  error(
    reader.readAcceptedChange({ changeId: accepted.changeId, section: 'summary', maxBytes: 8_192 }),
    'INTEGRITY_FAILURE',
  );
  fault
    .prepare('UPDATE revisions SET change_id=?,authority_seq=? WHERE object_id=? AND revision=2')
    .run(accepted.changeId, accepted.authoritySequence + 1, target.id);
  error(
    reader.readAcceptedChange({ changeId: accepted.changeId, section: 'summary', maxBytes: 8_192 }),
    'INTEGRITY_FAILURE',
  );
});

test('authorized incoming candidate work is bounded even when a retained target pin is missing', (t) => {
  const f = fixture(t);
  const seed = create(f.human, 1);
  ok(
    f.human.saveObject({
      operationKey: 'seed:head',
      targetId: seed.id,
      expectedRevision: 1,
      content: content('Current head'),
    }),
  );
  for (let n = 0; n < 51; n++)
    create(f.human, 200 + n, {
      ...content(),
      relations: Array.from({ length: 100 }, (_, edge) =>
        source(10_000 + n * 100 + edge, pin(seed.id, 1)),
      ),
    });
  const a = agent(f.space, f.human, 'grant:work');
  const limited = agent(f.space, f.human, 'grant:limited-work', {
    scope: { mode: 'objects', objectIds: [seed.id, id(200)] },
  });
  const fault = new DatabaseSync(join(f.directory, 'space.sqlite'));
  t.after(() => fault.close());
  // Fault only: 5,100 current authorized declarations now point at a lost old revision.
  fault.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER immutable_revision_delete;');
  fault.prepare('DELETE FROM revisions WHERE object_id=? AND revision=1').run(seed.id);
  const page = ok(a.api.expandRelations({ ...graph(seed.id), direction: 'incoming', maxDepth: 1 }));
  assert.deepEqual(page.stopReasons, ['work-budget']);
  assert.equal(page.traversalCompleteWithinScope, false);
  assert.equal(page.unavailableReferences, true);
  assert.deepEqual(page.edges, []);
  assert.equal(page.nodes.length, 1);
  assert.equal(page.nextCursor, null);
  const scoped = ok(
    limited.api.expandRelations({ ...graph(seed.id), direction: 'incoming', maxDepth: 1 }),
  );
  assert.deepEqual(scoped.stopReasons, []);
  assert.equal(scoped.traversalCompleteWithinScope, true);
  assert.equal(scoped.unavailableReferences, true);
  assert.deepEqual(scoped.edges, []);
});
