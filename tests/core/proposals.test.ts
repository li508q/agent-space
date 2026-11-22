import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { ProposalReceipt } from '../../src/contracts/core.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

const accept = (p: ProposalReceipt, key: string, revision?: number) => ({
  operationKey: key,
  proposalId: p.id,
  expectedProposalVersion: p.statusVersion,
  expectedPayloadHash: p.payloadHash,
  decision: 'accept' as const,
  expectedTarget:
    revision === undefined
      ? { state: 'absent' as const }
      : { state: 'revision' as const, revision },
});
const update = (key: string, targetId: string, baseRevision: number, body = 'Agent candidate') => ({
  action: 'update' as const,
  operationKey: key,
  targetId,
  baseRevision,
  patch: { body },
  purpose: 'Clarify the note',
  reason: 'Use the inspected material',
  sources: [],
});

test('grants are hash-only, rechecked live, separate creation access, and creation reserves identity', (t) => {
  const f = fixture(t);
  const h = f.human;
  ok(
    h.createObject({ operationKey: 'a', id: id(1), kind: 'document', content: content('Allowed') }),
  );
  ok(
    h.createObject({
      operationKey: 'b',
      id: id(2),
      kind: 'document',
      content: content('Private outside grant', 'Hidden title'),
    }),
  );
  const configured = agent(f.space, h, 'grant', { scope: { mode: 'objects', objectIds: [id(1)] } });
  const beforeBinding = ok(h.status());
  const rebound = ok(
    f.space.agent({
      grantId: configured.grant.id,
      token: configured.token,
      instanceId: beforeBinding.instanceId,
    }),
  );
  assert.deepEqual(ok(h.status()), beforeBinding);
  error(
    f.space.agent({
      grantId: configured.grant.id,
      token: 'wrong-token',
      instanceId: beforeBinding.instanceId,
    }),
    'FORBIDDEN',
  );
  assert.deepEqual(ok(h.status()), beforeBinding);
  ok(rebound.discover());
  const afterDiscover = ok(h.status());
  assert.equal(afterDiscover.authoritySequence, beforeBinding.authoritySequence);
  assert.equal(afterDiscover.activitySequence, beforeBinding.activitySequence + 1);
  const discoveryActivity = ok(
    h.activity({ after: beforeBinding.activitySequence, limit: 10 }),
  ).items;
  assert.equal(discoveryActivity.length, 1);
  assert.equal(discoveryActivity[0]?.tool, 'space_discover');
  assert.equal(discoveryActivity[0]?.stage, 'prepared');
  const retry = ok(h.createGrant({ operationKey: 'grant', spec: configured.spec }));
  assert.equal(retry.token, null);
  assert.deepEqual(retry.grant, configured.grant);
  const db = new DatabaseSync(join(f.directory, 'space.sqlite'));
  t.after(() => db.close());
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM grants').all()).includes(configured.token),
    false,
  );
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM receipts').all()).includes(configured.token),
    false,
  );
  assert.equal(
    readFileSync(join(f.directory, 'space.sqlite')).includes(Buffer.from(configured.token)),
    false,
  );
  assert.equal(JSON.stringify(configured.api), '{}');
  assert.equal('reviewProposal' in configured.api, false);
  assert.equal('saveObject' in configured.api, false);
  assert.equal(
    ok(configured.api.query({ filter: {}, limit: 50, maxBytes: 10000 })).items.length,
    1,
  );
  error(
    configured.api.read({
      ref: { mode: 'current', objectId: id(2) },
      section: 'summary',
      maxBytes: 10000,
    }),
    'FORBIDDEN',
  );
  error(configured.api.propose(update('outside', id(2), 1)), 'FORBIDDEN');
  const newInput = {
    action: 'create' as const,
    operationKey: 'new',
    newObject: {
      id: id(3),
      kind: 'document' as const,
      content: content('Suggested new knowledge'),
    },
    purpose: 'Capture knowledge',
    reason: 'No pre-created target is needed',
    sources: [],
  };
  error(configured.api.propose(newInput), 'FORBIDDEN');
  const whole = agent(f.space, h, 'whole');
  error(whole.api.propose(newInput), 'FORBIDDEN');
  const enabledSpec = { ...whole.spec, creation: { enabled: true, kinds: ['document' as const] } };
  const enabled = ok(
    h.updateGrant({
      operationKey: 'enable-create',
      grantId: whole.grant.id,
      expectedGeneration: 1,
      spec: enabledSpec,
      revoked: false,
    }),
  );
  const candidate = ok(whole.api.propose(newInput));
  assert.equal(candidate.action, 'create');
  assert.equal(candidate.baseRevision, null);
  assert.equal(ok(h.query({ filter: {}, limit: 50, maxBytes: 20000 })).items.length, 2);
  error(h.readObject({ objectId: id(3) }), 'NOT_FOUND');
  assert.deepEqual(ok(whole.api.propose(newInput)), candidate);
  error(whole.api.propose({ ...newInput, operationKey: 'collision' }), 'OBJECT_ID_RESERVED');
  error(
    h.createObject({
      operationKey: 'human-collision',
      id: id(3),
      kind: 'document',
      content: content(),
    }),
    'OBJECT_ID_RESERVED',
  );
  error(
    whole.api.propose({
      ...newInput,
      operationKey: 'not-record',
      newObject: { ...newInput.newObject, id: id(4), kind: 'record' },
    }),
    'FORBIDDEN',
  );
  const applied = ok(h.reviewProposal(accept(candidate, 'apply-new')));
  assert.equal(applied.outcome, 'applied');
  assert.equal(applied.object?.revision, 1);
  assert.deepEqual(ok(h.reviewProposal(accept(candidate, 'apply-new'))), applied);
  error(h.reviewProposal(accept(candidate, 'different-review')), 'PROPOSAL_CHANGED');
  assert.equal(ok(h.query({ filter: {}, limit: 50, maxBytes: 20000 })).items.length, 3);
  const another = ok(
    whole.api.propose({
      ...newInput,
      operationKey: 'another',
      newObject: { ...newInput.newObject, id: id(5) },
    }),
  );
  ok(
    h.reviewProposal({
      operationKey: 'reject-new',
      proposalId: another.id,
      expectedPayloadHash: another.payloadHash,
      expectedProposalVersion: 1,
      decision: 'reject',
    }),
  );
  error(
    whole.api.propose({
      ...newInput,
      operationKey: 'retired-id',
      newObject: { ...newInput.newObject, id: id(5) },
    }),
    'OBJECT_ID_RESERVED',
  );
  const shrunk = { ...whole.spec, scope: { mode: 'objects' as const, objectIds: [id(1)] } };
  ok(
    h.updateGrant({
      operationKey: 'shrink',
      grantId: whole.grant.id,
      expectedGeneration: enabled.generation,
      spec: shrunk,
      revoked: false,
    }),
  );
  error(whole.api.operationStatus({ operationKey: 'new' }), 'FORBIDDEN');
  ok(
    h.updateGrant({
      operationKey: 'revoke',
      grantId: configured.grant.id,
      expectedGeneration: 1,
      spec: configured.spec,
      revoked: true,
    }),
  );
  error(configured.api.query({ filter: {}, limit: 5, maxBytes: 10000 }), 'FORBIDDEN');
  error(
    f.space.agent({
      grantId: configured.grant.id,
      token: configured.token,
      instanceId: ok(h.status()).instanceId,
    }),
    'FORBIDDEN',
  );
});

test('review binds payload/status; old proposals preserve human work and reject despite revocation', (t) => {
  const f = fixture(t);
  const h = f.human;
  ok(
    h.createObject({
      operationKey: 'note',
      id: id(1),
      kind: 'document',
      content: content('Human draft'),
    }),
  );
  const a = agent(f.space, h, 'grant');
  const candidate = ok(a.api.propose(update('candidate', id(1), 1)));
  const beforeSeen = ok(h.status());
  ok(h.markProposalSeen({ proposalId: candidate.id, seen: true }));
  assert.deepEqual(ok(h.status()), beforeSeen);
  assert.equal(ok(h.getProposal({ proposalId: candidate.id })).proposal.statusVersion, 1);
  error(
    h.reviewProposal({
      ...accept(candidate, 'wrong-hash', 1),
      expectedPayloadHash: '0'.repeat(64),
    }),
    'PROPOSAL_CHANGED',
  );
  error(
    h.reviewProposal({ ...accept(candidate, 'wrong-status', 1), expectedProposalVersion: 7 }),
    'PROPOSAL_CHANGED',
  );
  const human = ok(
    h.saveObject({
      operationKey: 'human-newer',
      targetId: id(1),
      expectedRevision: 1,
      content: content('Later correct human work'),
    }),
  );
  const originalConflictRequest = accept(candidate, 'lost-conflict-response', 2);
  const originalConflict = ok(h.reviewProposal(originalConflictRequest)); // Caller can lose this response.
  assert.equal(originalConflict.outcome, 'conflicted');
  assert.equal(originalConflict.object?.content.body, human.object.content.body);
  const conflicted = originalConflict.proposal;
  ok(
    h.updateGrant({
      operationKey: 'revoke',
      grantId: a.grant.id,
      expectedGeneration: 1,
      spec: a.spec,
      revoked: true,
    }),
  );
  ok(
    h.reviewProposal({
      operationKey: 'later-rejection',
      proposalId: candidate.id,
      expectedPayloadHash: candidate.payloadHash,
      expectedProposalVersion: conflicted.statusVersion,
      decision: 'reject',
    }),
  );
  const beforeReplay = ok(h.status());
  const status = ok(h.operationStatus({ operationKey: 'lost-conflict-response' }));
  assert.equal(status.state, 'recorded');
  if (status.state === 'recorded') {
    assert.equal(status.receipt.business?.kind, 'review');
    if (status.receipt.business?.kind === 'review')
      assert.equal(status.receipt.business.outcome, 'conflicted');
    assert.equal(status.currentProposal?.status, 'rejected');
    assert.equal(JSON.stringify(status).includes('Later correct human work'), false);
  }
  assert.deepEqual(ok(h.reviewProposal(originalConflictRequest)), originalConflict);
  assert.deepEqual(ok(h.status()), beforeReplay);
  assert.equal(ok(h.readObject({ objectId: id(1) })).object.revision, 2);
  assert.equal(
    ok(h.getProposal({ proposalId: candidate.id })).proposal.payloadHash,
    candidate.payloadHash,
  );
});

test('acceptance is atomic, preserves user policy/review ownership and immutable candidate history', (t) => {
  const f = fixture(t);
  const h = f.human;
  const c = content('Before');
  c.properties = { count: { label: '数量', type: 'number', value: 0 } };
  ok(h.createObject({ operationKey: 'note', id: id(1), kind: 'document', content: c }));
  ok(
    h.createObject({
      operationKey: 'source',
      id: id(2),
      kind: 'document',
      content: content('A fixed source'),
    }),
  );
  const a = agent(f.space, h, 'grant');
  const changed = {
    ...c,
    body: 'Accepted text',
    properties: { count: { label: '数量', type: 'number' as const, value: 1 } },
    relations: [
      {
        id: id(20),
        predicate: 'source' as const,
        target: { mode: 'pinned' as const, objectId: id(2), revision: 1 },
      },
    ],
  };
  const candidate = ok(
    a.api.propose({
      ...update('candidate', id(1), 1),
      patch: changed,
      sources: [{ mode: 'pinned', objectId: id(2), revision: 1 }],
    }),
  );
  const applied = ok(h.reviewProposal(accept(candidate, 'accept', 1)));
  assert.deepEqual(applied.object?.content, changed);
  assert.equal(ok(h.history({ objectId: id(1), limit: 50 })).items.length, 2);
  assert.equal(applied.object?.knowledgeReview, null);
  ok(
    h.markKnowledgeReviewed({
      operationKey: 'knowledge-reviewed',
      ref: { mode: 'pinned', objectId: id(1), revision: 2 },
    }),
  );
  const policy = ok(
    h.setPolicy({
      operationKey: 'protect',
      objectId: id(1),
      expectedRevision: 2,
      policy: { protectedFields: ['body'] },
    }),
  );
  assert.equal(policy.object.knowledgeReview?.reviewedRevision, 2);
  error(a.api.propose(update('protected', id(1), 3, 'Override protected text')), 'PROTECTED_FIELD');
  error(
    a.api.propose({
      ...update('bad-owner', id(1), 3),
      patch: { knowledgeReview: 'reviewed' },
    } as never),
    'INVALID_INPUT',
  );
  error(
    h.undoChange({ operationKey: 'undo-old', changeId: applied.changeId, expectedRevision: 3 }),
    'STALE_REVISION',
  );
  assert.deepEqual(ok(h.readObject({ objectId: id(1) })).object.policy, {
    protectedFields: ['body'],
  });
  const db = new DatabaseSync(join(f.directory, 'space.sqlite'));
  t.after(() => db.close());
  assert.throws(() =>
    db.prepare('UPDATE proposals SET payload_json=? WHERE id=?').run('{}', candidate.id),
  );
  assert.throws(() =>
    db.prepare('UPDATE revisions SET content_json=? WHERE object_id=?').run('{}', id(1)),
  );
  assert.equal(
    ok(h.getProposal({ proposalId: candidate.id })).proposal.payloadHash,
    candidate.payloadHash,
  );
});

test('conditional undo refuses ABA and later changes; creation undo archives without erasing identity', (t) => {
  const f = fixture(t);
  const h = f.human;
  const created = ok(
    h.createObject({ operationKey: 'a', id: id(1), kind: 'document', content: content('A') }),
  );
  const b = ok(
    h.saveObject({
      operationKey: 'b',
      targetId: id(1),
      expectedRevision: 1,
      content: content('B'),
    }),
  );
  const undo = ok(
    h.undoChange({ operationKey: 'undo-b', changeId: b.changeId!, expectedRevision: 2 }),
  );
  assert.equal(undo.object.content.body, 'A');
  assert.equal(undo.object.revision, 3);
  error(
    h.undoChange({ operationKey: 'aba', changeId: b.changeId!, expectedRevision: 3 }),
    'STALE_REVISION',
  );
  error(
    h.undoChange({ operationKey: 'old-create', changeId: created.changeId!, expectedRevision: 3 }),
    'STALE_REVISION',
  );
  const fresh = ok(
    h.createObject({
      operationKey: 'fresh',
      id: id(2),
      kind: 'document',
      content: content('Still in history'),
    }),
  );
  const archived = ok(
    h.undoChange({ operationKey: 'archive-new', changeId: fresh.changeId!, expectedRevision: 1 }),
  );
  assert.equal(archived.state, 'archived');
  assert.equal(archived.object.revision, 2);
  assert.equal(
    ok(h.readObject({ objectId: id(2), revision: 1 })).object.content.body,
    'Still in history',
  );
  assert.equal(ok(h.query({ filter: {}, limit: 50, maxBytes: 10000 })).items.length, 1);
  error(
    h.createObject({
      operationKey: 'reuse-archive',
      id: id(2),
      kind: 'document',
      content: content(),
    }),
    'OBJECT_ID_RESERVED',
  );
  const restored = ok(
    h.undoChange({
      operationKey: 'undo-archive',
      changeId: archived.changeId!,
      expectedRevision: 2,
    }),
  );
  assert.equal(restored.state, 'restored');
});
