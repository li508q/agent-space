import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { HumanServices, ObjectSnapshot, QueryPage } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import type { QueryInput } from '../../src/contracts/schema.js';
import { ObjectSummarySchema, SchemaDescriptionSchema } from '../../src/contracts/context.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

const pin = (object: ObjectSnapshot) => ({
  mode: 'pinned' as const,
  objectId: object.id,
  revision: object.revision,
});
function create(human: HumanServices, n: number, title = `Material ${n}`) {
  return ok(
    human.createObject({
      operationKey: `seed:${n}`,
      id: id(n),
      kind: 'document',
      content: content('知识 CAFÉ 🙂', title),
    }),
  ).object;
}
function review(
  human: HumanServices,
  object: ObjectSnapshot,
  key = `review:${object.id}:${object.revision}`,
) {
  return ok(human.markKnowledgeReviewed({ operationKey: key, ref: pin(object) }));
}
function advance(human: HumanServices, object: ObjectSnapshot) {
  return ok(
    human.saveObject({
      operationKey: `save:${object.id}:${object.revision}`,
      targetId: object.id,
      expectedRevision: object.revision,
      content: { ...object.content, body: object.content.body + '\nLater work' },
    }),
  ).object;
}
function measured(result: Result<QueryPage>, maxBytes: number) {
  const page = ok(result);
  assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.ok(page.returnedBytes <= maxBytes);
  page.items.forEach((item) => ObjectSummarySchema.parse(item));
  return page;
}
const request: QueryInput = { filter: {}, limit: 50, maxBytes: 65_536 };

test('head review transitions persist without certifying saves, proposals, seen or source changes', (t) => {
  const f = fixture(t);
  let target = create(f.human, 1);
  let source = create(f.human, 2);
  const a = agent(f.space, f.human, 'grant:review');
  const state = () => ok(f.human.query({ ...request, filter: { text: 'Material 1' } })).items[0]!;
  assert.equal(state().knowledgeReviewState, 'never-reviewed');
  target = advance(f.human, target);
  assert.equal(state().knowledgeReviewState, 'never-reviewed');
  review(f.human, target);
  const sequence = ok(f.human.status()).authoritySequence;
  review(f.human, target);
  review(f.human, target, 'review:duplicate:new-key');
  assert.equal(ok(f.human.status()).authoritySequence, sequence);
  assert.equal(state().knowledgeReviewState, 'current-reviewed');
  ok(
    f.human.saveObject({
      operationKey: 'unchanged',
      targetId: target.id,
      expectedRevision: target.revision,
      content: target.content,
    }),
  );
  assert.equal(ok(f.human.status()).authoritySequence, sequence);
  const proposal = ok(
    a.api.propose({
      operationKey: 'proposal',
      action: 'update',
      targetId: target.id,
      baseRevision: target.revision,
      purpose: 'Continue',
      reason: 'An explicit candidate',
      sources: [pin(source)],
      patch: { body: 'Accepted newer work' },
    }),
  );
  ok(f.human.markProposalSeen({ proposalId: proposal.id, seen: true }));
  assert.equal(state().knowledgeReviewState, 'current-reviewed');
  target = ok(
    f.human.reviewProposal({
      operationKey: 'accept',
      proposalId: proposal.id,
      expectedProposalVersion: proposal.statusVersion,
      expectedPayloadHash: proposal.payloadHash,
      expectedTarget: { state: 'revision', revision: target.revision },
      decision: 'accept',
    }),
  ).object!;
  assert.equal(state().knowledgeReviewState, 'changed-since-review');
  error(
    f.human.markKnowledgeReviewed({
      operationKey: 'review:stale',
      ref: { ...pin(target), revision: target.revision - 1 },
    }),
    'STALE_REVISION',
  );
  review(f.human, target);
  source = advance(f.human, source);
  assert.equal(source.revision, 2);
  assert.equal(state().knowledgeReviewState, 'current-reviewed');
  assert.equal(
    ok(f.open().human('reopen').query(request)).items.find(
      (item) => item.ref.objectId === target.id,
    )?.knowledgeReviewState,
    'current-reviewed',
  );
  const catalog = ok(a.api.describe({ maxBytes: 16_384 }));
  SchemaDescriptionSchema.parse(catalog);
  assert.equal(catalog.definitionsVersion, 2);
  assert.ok(catalog.filterKeys.includes('knowledgeReviewStates'));
});

test('SQL filters before pages across 90 interleaved objects and multiple reviews without duplicates', (t) => {
  const f = fixture(t);
  const expected: string[] = [];
  for (let n = 1; n <= 90; n++) {
    let object = create(f.human, n);
    if (n > 54 && n % 3 !== 0) {
      review(f.human, object);
      object = advance(f.human, object);
      review(f.human, object);
      object = advance(f.human, object);
      if (n % 3 === 1) expected.push(object.id);
      else review(f.human, object);
    }
  }
  const a = agent(f.space, f.human, 'grant:A');
  const b = agent(f.open(), f.human, 'grant:B', {
    scope: { mode: 'objects', objectIds: expected.slice(0, 5) },
  });
  const input: QueryInput = {
    filter: { knowledgeReviewStates: ['changed-since-review'], text: '知' },
    limit: 3,
    maxBytes: 4096,
  };
  for (const api of [f.human, a.api, b.api]) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = measured(api.query({ ...input, ...(cursor ? { cursor } : {}) }), input.maxBytes);
      ids.push(...page.items.map((item) => item.ref.objectId));
      assert.ok(
        page.items.every(
          (item) => item.knowledgeReviewedRevision === 2 && item.currentRevision === 3,
        ),
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(ids, api === b.api ? expected.slice(0, 5) : expected);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      ok(api.search({ ...input, filter: { ...input.filter, text: '知' } })).items,
      ok(api.query(input)).items,
    );
  }
  const empty = measured(
    a.api.query({
      ...input,
      filter: { knowledgeReviewStates: ['changed-since-review'], text: 'no matching text' },
    }),
    input.maxBytes,
  );
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, null);
  assert.equal(empty.truncated, false);
});

test('review-set cursors canonicalize order and reject authority, scope, revoked or changed requests', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 5; n++) create(f.human, n);
  const a = agent(f.space, f.human, 'grant:A');
  const b = agent(f.space, f.human, 'grant:B');
  const input: QueryInput = {
    filter: { knowledgeReviewStates: ['changed-since-review', 'never-reviewed'] },
    limit: 1,
    maxBytes: 4096,
  };
  const page = ok(a.api.query(input));
  assert.ok(page.nextCursor);
  assert.deepEqual(page.executed.knowledgeReviewStates, ['never-reviewed', 'changed-since-review']);
  ok(
    a.api.query({
      ...input,
      filter: { knowledgeReviewStates: ['never-reviewed', 'changed-since-review'] },
      cursor: page.nextCursor,
    }),
  );
  error(
    a.api.query({
      ...input,
      filter: { knowledgeReviewStates: ['never-reviewed'] },
      cursor: page.nextCursor,
    }),
    'INVALID_CURSOR',
  );
  error(b.api.query({ ...input, cursor: page.nextCursor }), 'CURSOR_STALE');
  const before = ok(f.human.status()).authoritySequence;
  ok(a.api.read({ ref: page.items[0]!.ref, section: 'summary', maxBytes: 4096 }));
  ok(
    f.human.saveDraft({
      operationKey: 'draft',
      draftId: id(101),
      generation: 1,
      target: { state: 'existing', objectId: id(1), baseRevision: 1 },
      source: { kind: 'editor' },
      content: content('Draft only'),
    }),
  );
  assert.equal(ok(f.human.status()).authoritySequence, before);
  ok(a.api.query({ ...input, cursor: page.nextCursor }));
  review(f.human, ok(f.human.readObject({ objectId: id(1) })).object);
  error(a.api.query({ ...input, cursor: page.nextCursor }), 'CURSOR_STALE');
  const current = ok(a.api.query(input));
  ok(
    f.human.updateGrant({
      operationKey: 'grant:change',
      grantId: a.grant.id,
      expectedGeneration: 1,
      spec: { ...a.spec, label: 'Changed grant' },
      revoked: false,
    }),
  );
  error(a.api.query({ ...input, cursor: current.nextCursor! }), 'CURSOR_STALE');
  ok(
    f.human.updateGrant({
      operationKey: 'grant:revoke',
      grantId: a.grant.id,
      expectedGeneration: 2,
      spec: a.spec,
      revoked: true,
    }),
  );
  error(a.api.query(input), 'FORBIDDEN');
});

test('Unicode summary budgets count the whole Result and do not turn an oversized first item into empty success', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 9; n++) create(f.human, n, '知🙂'.repeat(80));
  const a = agent(f.space, f.human, 'grant');
  const input: QueryInput = {
    filter: { knowledgeReviewStates: ['never-reviewed'] },
    limit: 9,
    maxBytes: 3072,
  };
  let page = measured(a.api.query(input), input.maxBytes);
  assert.ok(page.items.length < 9 && page.items.length > 0);
  const ids = page.items.map((item) => item.ref.objectId);
  while (page.nextCursor) {
    page = measured(a.api.query({ ...input, cursor: page.nextCursor }), input.maxBytes);
    ids.push(...page.items.map((item) => item.ref.objectId));
  }
  assert.deepEqual(
    ids,
    Array.from({ length: 9 }, (_, index) => id(index + 1)),
  );
  const small = a.api.query({ ...input, maxBytes: 1024 });
  error(small, 'LIMIT_EXCEEDED');
  if (!small.ok) {
    const required = Number(small.error.params?.requiredBytes);
    assert.ok(required > 1024);
    const fitted = measured(a.api.query({ ...input, maxBytes: required }), required);
    assert.ok(fitted.items.length >= 1);
  }
});

test('historical graph/read pins retain old identity while review metadata describes the current head', (t) => {
  const f = fixture(t);
  const old = create(f.human, 1, 'Old title');
  review(f.human, old);
  const current = ok(
    f.human.saveObject({
      operationKey: 'new-head',
      targetId: old.id,
      expectedRevision: 1,
      content: { ...old.content, title: 'Current title', body: 'New body' },
    }),
  ).object;
  const owner = ok(
    f.human.createObject({
      operationKey: 'owner',
      id: id(2),
      kind: 'document',
      content: {
        ...content(),
        relations: [{ id: id(100), predicate: 'source', target: pin(old) }],
      },
    }),
  ).object;
  const a = agent(f.space, f.human, 'grant');
  const read = () => ok(a.api.read({ ref: pin(old), section: 'summary', maxBytes: 4096 }));
  let summary = read();
  assert.equal(summary.section, 'summary');
  if (summary.section === 'summary')
    assert.equal(summary.knowledgeReviewState, 'changed-since-review');
  review(f.human, current);
  summary = read();
  if (summary.section === 'summary') {
    assert.equal(summary.title, old.content.title);
    assert.equal(summary.digest, old.digest);
    assert.deepEqual(summary.ref, pin(old));
    assert.equal(summary.currentRevision, 2);
    assert.equal(summary.knowledgeReviewedRevision, 2);
    assert.equal(summary.knowledgeReviewState, 'current-reviewed');
  }
  const graph = ok(
    a.api.expandRelations({
      seedId: owner.id,
      direction: 'outgoing',
      predicates: ['source'],
      maxDepth: 1,
      maxNodes: 5,
      maxEdges: 5,
      maxBytes: 4096,
    }),
  );
  const node = graph.nodes.find((item) => item.ref.objectId === old.id)!;
  assert.equal(node.title, old.content.title);
  assert.equal(node.digest, old.digest);
  assert.equal(node.ref.revision, 1);
  assert.equal(node.currentRevision, 2);
  assert.equal(node.knowledgeReviewState, 'current-reviewed');
});

test('invalid R>H is checked in authorized candidate metadata, without exposing an unauthorized damaged object', (t) => {
  const f = fixture(t);
  create(f.human, 1);
  let damaged = create(f.human, 2);
  damaged = advance(f.human, damaged);
  review(f.human, damaged);
  const a = agent(f.space, f.human, 'scoped', { scope: { mode: 'objects', objectIds: [id(1)] } });
  const fault = new DatabaseSync(join(f.directory, 'space.sqlite'));
  fault.prepare('UPDATE objects SET head=1 WHERE id=?').run(damaged.id);
  fault.close();
  const input: QueryInput = { ...request, filter: { knowledgeReviewStates: ['never-reviewed'] } };
  assert.deepEqual(
    ok(a.api.query(input)).items.map((item) => item.ref.objectId),
    [id(1)],
  );
  error(f.human.query(input), 'INTEGRITY_FAILURE');
});
