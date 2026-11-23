import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpaceSession } from '../../src/contracts/app.js';
import {
  accessObjects,
  candidatePage,
  checkedReference,
  codepoints,
  contextBrief,
  contextLimits,
  contextReference,
  directCandidates,
  preparationKey,
  selectedReferences,
  summaryReference,
  type ContextCandidate,
} from '../../src/renderer/state/collaboration.js';
import { agent, content, error, fixture, id, ok } from '../core/helpers.js';

test('a historical project brief fixes declared links separately from current active membership', (t) => {
  const f = fixture(t);
  const source = ok(
    f.human.createObject({
      operationKey: 'source',
      kind: 'document',
      content: content('Original evidence', 'Evidence K1'),
    }),
  ).object;
  const asset = ok(
    f.human.createObject({
      operationKey: 'asset',
      kind: 'asset',
      content: content('Reusable asset', 'Asset K1'),
    }),
  ).object;
  const project = ok(
    f.human.createObject({
      operationKey: 'project',
      kind: 'project',
      content: {
        ...content('Saved goal\r\n' + '目標😀'.repeat(150), 'Project K1'),
        relations: [
          { id: id(101), predicate: 'uses', target: { mode: 'current', objectId: asset.id } },
          {
            id: id(102),
            predicate: 'source',
            target: { mode: 'pinned', objectId: source.id, revision: 1 },
          },
        ],
      },
      origin: {
        mode: 'imported-copy',
        label: 'Imported copy',
        locator: '/synthetic/private/original.md',
      },
    }),
  ).object;
  const assetK2 = ok(
    f.human.saveObject({
      operationKey: 'asset-k2',
      targetId: asset.id,
      expectedRevision: 1,
      content: content('Changed asset', 'Asset K2'),
    }),
  ).object;
  ok(
    f.human.saveObject({
      operationKey: 'project-k2',
      targetId: project.id,
      expectedRevision: 1,
      content: content('Later project goal', 'Project K2'),
    }),
  );
  const member = ok(
    f.human.createObject({
      operationKey: 'new-member',
      kind: 'document',
      content: {
        ...content('Current member body', 'Current member'),
        relations: [
          {
            id: id(103),
            predicate: 'belongs_to',
            target: { mode: 'current', objectId: project.id },
          },
        ],
      },
    }),
  ).object;
  const session: SpaceSession = {
    bindingId: id(901),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  const historical = ok(f.human.readObject({ objectId: project.id, revision: 1 }));
  assert.equal(historical.currentRevision, 2);
  const direct = directCandidates(historical);
  assert.equal(direct[0]!.declared.mode, 'current');
  assert.deepEqual(direct[0]!.reference!.ref, { mode: 'pinned', objectId: asset.id, revision: 2 });
  assert.deepEqual(direct[1]!.reference!.ref, { mode: 'pinned', objectId: source.id, revision: 1 });
  const members = ok(
    f.human.query({
      filter: { projectId: project.id, lifecycle: 'active' },
      limit: 20,
      maxBytes: 32768,
    }),
  );
  assert.deepEqual(
    members.items.map((item) => item.ref.objectId),
    [member.id],
  );
  const references = [
    contextReference(project),
    contextReference(assetK2),
    contextReference(source),
  ];
  const before = ok(f.human.status()).authoritySequence;
  const brief = JSON.parse(
    contextBrief(session, 'Compare these versions', references, project, {
      direct,
      members: members.items.map(summaryReference),
    }),
  );
  assert.equal(brief.format, 'agentspace-brief/v1');
  assert.equal(brief.scope.completeProjectSnapshot, false);
  assert.deepEqual(brief.referenceGroups.startingSavedVersion, [references[0]!.ref]);
  assert.deepEqual(brief.referenceGroups.directLinksInStartingVersion, [
    references[1]!.ref,
    references[2]!.ref,
  ]);
  assert.deepEqual(brief.referenceGroups.currentActiveProjectMaterialAsQueried, []);
  const retained = JSON.parse(contextBrief(session, '', [contextReference(member)], project));
  assert.deepEqual(retained.referenceGroups.currentActiveProjectMaterialAsQueried, []);
  assert.deepEqual(retained.referenceGroups.earlierSelectedResults, [contextReference(member).ref]);
  assert.equal(brief.references[0].title, 'Project K1');
  assert.equal(brief.references[0].ref.revision, 1);
  assert.equal(brief.projectGoalExcerpt.text, codepoints(project.content.body, 280));
  assert.equal(Array.from(brief.projectGoalExcerpt.text).length, 280);
  assert.equal(brief.projectGoalExcerpt.truncated, true);
  assert.ok(!JSON.stringify(brief).includes('/synthetic/private'));
  assert.ok(!JSON.stringify(brief).includes('Current member'));
  assert.ok(!JSON.stringify(brief).includes('Project K2'));
  assert.equal(ok(f.human.status()).authoritySequence, before, 'Preparation is read-only.');
  assert.deepEqual(ok(f.human.listGrants()), []);
  assert.equal(summaryReference(members.items[0]!).digest, member.digest);
});

test('Unicode task and excerpt limits do not split surrogate pairs or leak an unchecked seed', (t) => {
  const f = fixture(t);
  const seed = ok(
    f.human.createObject({
      operationKey: 'seed',
      kind: 'project',
      content: content('😀'.repeat(281), 'Unchecked project title'),
    }),
  ).object;
  const note = ok(
    f.human.createObject({
      operationKey: 'note',
      kind: 'document',
      content: content('Unselected body must not appear', 'Selected note'),
    }),
  ).object;
  const session: SpaceSession = {
    bindingId: id(902),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  const task = '😀'.repeat(1000);
  assert.equal(task.length, 2000);
  assert.equal(codepoints(task + 'x', 1000), task);
  const payload = contextBrief(session, task, [contextReference(note)], seed);
  const brief = JSON.parse(payload);
  assert.equal(brief.task, task);
  assert.equal(brief.projectGoalExcerpt, undefined);
  assert.ok(!payload.includes(seed.content.title));
  assert.ok(!payload.includes(note.content.body));
  assert.throws(() => contextBrief(session, task + '😀', [contextReference(note)], seed));
  assert.throws(() => contextBrief(session, '', [], seed));
  const included = JSON.parse(contextBrief(session, '', [contextReference(seed)], seed));
  assert.equal(included.projectGoalExcerpt.text, '😀'.repeat(280));
});

test('selection keeps same-ID versions independent, while authorization deduplicates identities', (t) => {
  const f = fixture(t);
  const k1 = ok(
    f.human.createObject({
      operationKey: 'k1',
      kind: 'document',
      content: content('One', 'Same object'),
    }),
  ).object;
  const k2 = ok(
    f.human.saveObject({
      operationKey: 'k2',
      targetId: k1.id,
      expectedRevision: 1,
      content: content('Two', 'Same object'),
    }),
  ).object;
  let selected = [contextReference(k1), contextReference(k2)];
  assert.equal(accessObjects(selected).length, 1);
  for (let index = 0; index < 18; index++)
    selected = selectedReferences(
      selected,
      { ...contextReference(k1), ref: { mode: 'pinned', objectId: id(200 + index), revision: 1 } },
      true,
    )!;
  assert.equal(selected.length, contextLimits.references);
  assert.equal(
    selectedReferences(
      selected,
      { ...contextReference(k1), ref: { mode: 'pinned', objectId: id(300), revision: 1 } },
      true,
    ),
    null,
  );
  assert.equal(selectedReferences(selected, contextReference(k2), true)!.length, 20);
  assert.equal(selectedReferences(selected, contextReference(k1), false)!.length, 19);
  const session: SpaceSession = {
    bindingId: id(903),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  const view = ok(f.human.readObject({ objectId: k1.id, revision: 1 }));
  assert.equal(checkedReference(session, contextReference(k1), view).error, null);
  assert.equal(
    checkedReference(session, { ...contextReference(k1), digest: k2.digest }, view).error,
    'INTEGRITY_FAILURE',
  );
  assert.equal(checkedReference(session, contextReference(k2), view).error, 'INTEGRITY_FAILURE');
  assert.equal(
    checkedReference(
      { ...session, status: { ...session.status, instanceId: id(999) } },
      contextReference(k1),
      view,
    ).error,
    'SPACE_MISMATCH',
  );
  assert.notEqual(preparationKey(session, k1), preparationKey(session, k2));
  assert.notEqual(
    preparationKey(session, k1),
    preparationKey({ ...session, bindingId: id(904) }, k1),
  );
});

test('direct candidates page by items and UTF-8 bytes without silently changing a pin', () => {
  const candidates: ContextCandidate[] = Array.from({ length: 45 }, (_, index) => ({
    key: String(index),
    declared: { mode: 'current', objectId: id(index + 1) },
    reference: {
      ref: { mode: 'pinned', objectId: id(index + 1), revision: 2 },
      title: '資料'.repeat(120),
      kind: 'document',
      digest: null,
    },
  }));
  const first = candidatePage(candidates, 0),
    second = candidatePage(candidates, first.next!),
    third = candidatePage(candidates, second.next!);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 5);
  assert.equal(third.next, null);
  for (const page of [first, second, third]) {
    assert.ok(Buffer.byteLength(JSON.stringify({ items: page.items }), 'utf8') <= 32768);
    assert.ok(page.items.every((item) => item.reference?.ref.revision === 2));
  }
});

test('using prepared object IDs does not grant linked objects or turn a pin into a version ACL', (t) => {
  const f = fixture(t);
  const original = ok(
    f.human.createObject({ operationKey: 'original', kind: 'document', content: content('K1') }),
  ).object;
  const issued = agent(f.space, f.human, 'explicit-create', {
    scope: {
      mode: 'objects',
      objectIds: accessObjects([contextReference(original)]).map((item) => item.id),
    },
  });
  const added = ok(
    f.human.createObject({
      operationKey: 'added',
      kind: 'document',
      content: content('Separate material'),
    }),
  ).object;
  const later = ok(
    f.human.saveObject({
      operationKey: 'later',
      targetId: original.id,
      expectedRevision: 1,
      content: {
        ...original.content,
        body: 'K2',
        relations: [
          { id: id(400), predicate: 'related', target: { mode: 'current', objectId: added.id } },
        ],
      },
    }),
  ).object;
  assert.equal(
    ok(
      issued.api.read({
        ref: { mode: 'current', objectId: original.id },
        section: 'body',
        maxBytes: 4096,
      }),
    ).ref.revision,
    later.revision,
  );
  assert.equal(
    ok(
      issued.api.read({
        ref: { mode: 'pinned', objectId: original.id, revision: 1 },
        section: 'body',
        maxBytes: 4096,
      }),
    ).ref.revision,
    1,
  );
  error(
    issued.api.read({
      ref: { mode: 'current', objectId: added.id },
      section: 'body',
      maxBytes: 4096,
    }),
    'FORBIDDEN',
  );
  assert.equal(ok(f.human.listGrants()).length, 1);
});
