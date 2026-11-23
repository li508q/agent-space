import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentToolSchema,
  ContentSchema,
  HumanSaveSchema,
  LocaleSchema,
  ProposeSchema,
  QuerySchema,
  ReadSchema,
  RelationSchema,
  ReviewSchema,
  TypedFieldSchema,
} from '../src/contracts/schema.js';
import { HumanQuerySchema } from '../src/contracts/local.js';
import { TextSearchSchema } from '../src/contracts/context.js';

const targetId = '00000000-0000-4000-8000-000000000001';
const proposal = {
  action: 'update',
  operationKey: 'example:proposal:1',
  targetId,
  baseRevision: 1,
  patch: { body: 'A proposed sentence.' },
  purpose: 'Clarify the document',
  reason: 'Use the cited revision',
  sources: [],
};
const content = { title: '', body: 'An independent untitled note.', properties: {}, relations: [] };

test('agent inputs cannot add actor, paths, approval, or protected metadata', () => {
  assert.ok(ProposeSchema.safeParse(proposal).success);
  for (const extra of [
    { actor: 'human' },
    { spacePath: '/example' },
    { accept: true },
    { patch: { protection: [] } },
    { patch: { knowledgeReview: 'reviewed' } },
    { patch: { body: 'update', protection: [] } },
  ])
    assert.equal(ProposeSchema.safeParse({ ...proposal, ...extra }).success, false);
  assert.equal(AgentToolSchema.safeParse('proposal_accept').success, false);
  assert.equal(AgentToolSchema.safeParse('object_save').success, false);
});

test('new-object candidates have no base, no current target, and restricted kinds', () => {
  const candidate = {
    action: 'create',
    operationKey: 'example:create:1',
    purpose: 'Capture a finding',
    reason: 'A new independent note is useful',
    sources: [],
    newObject: { id: targetId, kind: 'document', content },
  };
  assert.ok(ProposeSchema.safeParse(candidate).success);
  assert.ok(ContentSchema.safeParse(content).success);
  for (const invalid of [
    { ...candidate, baseRevision: 1 },
    { ...candidate, targetId },
    { ...candidate, newObject: { ...candidate.newObject, kind: 'asset' } },
    { ...candidate, newObject: { ...candidate.newObject, kind: 'project' } },
    { ...proposal, baseRevision: undefined },
  ])
    assert.equal(ProposeSchema.safeParse(invalid).success, false);
});

test('review binds immutable payload, proposal version, and an explicit target expectation', () => {
  const review = {
    operationKey: 'example:review:1',
    proposalId: targetId,
    expectedProposalVersion: 1,
    expectedPayloadHash: 'a'.repeat(64),
    expectedTarget: { state: 'revision', revision: 1 },
    decision: 'accept',
  };
  assert.ok(ReviewSchema.safeParse(review).success);
  const { expectedTarget: _target, ...reject } = { ...review, decision: 'reject' };
  assert.equal(_target.state, 'revision');
  assert.ok(ReviewSchema.safeParse(reject).success);
  assert.equal(
    ReviewSchema.safeParse({ ...reject, expectedTarget: { state: 'revision', revision: 99 } })
      .success,
    false,
  );

  assert.ok(ReviewSchema.safeParse({ ...review, expectedTarget: { state: 'absent' } }).success);
  assert.equal(
    ReviewSchema.safeParse({ ...review, expectedTarget: { state: 'absent', revision: 1 } }).success,
    false,
  );
  for (const key of ['expectedProposalVersion', 'expectedPayloadHash', 'expectedTarget']) {
    const incomplete: Record<string, unknown> = { ...review };
    delete incomplete[key];
    assert.equal(ReviewSchema.safeParse(incomplete).success, false);
  }
  assert.equal(HumanSaveSchema.safeParse({ targetId, content: {} }).success, false);
});

test('typed fields preserve multilingual labels and distinct null/zero/empty values', () => {
  for (const field of [
    { label: '数值', type: 'number', value: 0 },
    { label: '値', type: 'number', value: null },
    { label: '제목', type: 'text', value: '' },
    { label: 'Completo', type: 'boolean', value: false },
    { label: '日期', type: 'date', value: '2026-11-22' },
  ])
    assert.deepEqual(TypedFieldSchema.parse(field), field);
  for (const field of [
    { label: 'Count', type: 'number', value: '0' },
    { label: 'Count', type: 'number', value: Infinity },
    { label: 'Date', type: 'date', value: '2026-02-30' },
    { label: 'State', type: 'select', options: ['open', 'done'], value: 'unknown' },
  ])
    assert.equal(TypedFieldSchema.safeParse(field).success, false);
  assert.deepEqual(LocaleSchema.options, ['en', 'zh-CN', 'ja', 'ko', 'es']);
});

test('relation predicates distinguish current identity from pinned evidence', () => {
  const current = { mode: 'current', objectId: targetId };
  const pinned = { mode: 'pinned', objectId: targetId, revision: 2 };
  assert.ok(
    RelationSchema.safeParse({ id: targetId, predicate: 'belongs_to', target: current }).success,
  );
  assert.ok(
    RelationSchema.safeParse({ id: targetId, predicate: 'source', target: pinned }).success,
  );
  for (const [predicate, target] of [
    ['belongs_to', pinned],
    ['source', current],
    ['related', pinned],
    ['related', { ...current, revision: 2 }],
  ])
    assert.equal(RelationSchema.safeParse({ id: targetId, predicate, target }).success, false);
});

test('agent reads require a section and byte budget or a separate continuation', () => {
  const request = { ref: { mode: 'current', objectId: targetId }, section: 'body', maxBytes: 4096 };
  assert.ok(ReadSchema.safeParse(request).success);
  assert.ok(ReadSchema.safeParse({ cursor: 'opaque-pinned-continuation', maxBytes: 4096 }).success);
  for (const invalid of [
    { ref: request.ref },
    { ...request, maxBytes: 0 },
    { ...request, maxBytes: 100_000 },
    { ...request, cursor: 'cannot-mix-start-and-continuation' },
  ])
    assert.equal(ReadSchema.safeParse(invalid).success, false);
});

test('review-state sets are strict and canonical across human, agent and text search', () => {
  const filter = {
    text: '知',
    knowledgeReviewStates: ['changed-since-review', 'never-reviewed'],
  };
  const request = { filter, limit: 2, maxBytes: 4096 };
  for (const schema of [QuerySchema, HumanQuerySchema, TextSearchSchema]) {
    const parsed = schema.parse(request);
    assert.deepEqual(parsed.filter.knowledgeReviewStates, [
      'never-reviewed',
      'changed-since-review',
    ]);
    for (const states of [
      [],
      null,
      'current-reviewed',
      ['unknown'],
      ['never-reviewed', 'never-reviewed'],
    ])
      assert.equal(
        schema.safeParse({ ...request, filter: { ...filter, knowledgeReviewStates: states } })
          .success,
        false,
      );
  }
  assert.equal(AgentToolSchema.safeParse('markKnowledgeReviewed').success, false);
  assert.equal(
    QuerySchema.safeParse({ ...request, filter: { ...filter, lifecycle: 'all' } }).success,
    false,
  );
});
