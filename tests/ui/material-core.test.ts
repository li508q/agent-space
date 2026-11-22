import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type { HumanServices } from '../../src/contracts/core.js';
import type { ObjectContent } from '../../src/contracts/schema.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import {
  fieldInputs,
  makeRelation,
  newField,
  parseField,
  parseFields,
  recordFromFields,
} from '../../src/renderer/state/material.js';
import { agent, content, error, fixture, id, ok } from '../core/helpers.js';

function bridge(human: HumanServices) {
  const session: SpaceSession = {
    bindingId: id(800),
    locationLabel: 'Synthetic test space',
    status: ok(human.status()),
  };
  const api: Pick<
    DesktopApi,
    'createObject' | 'saveObject' | 'saveDraft' | 'discardDraft' | 'operationStatus'
  > = {
    createObject: async (request) => human.createObject(request.input),
    saveObject: async (request) => human.saveObject(request.input),
    saveDraft: async (request) => human.saveDraft(request.input),
    discardDraft: async (request) => human.discardDraft(request.input),
    operationStatus: async (request) => human.operationStatus(request.input),
  };
  return { api, session };
}
const properties: ObjectContent['properties'] = {
  amount: { label: '金額', type: 'number', value: 0 },
  empty: { label: 'Texto vacío', type: 'text', value: '' },
  unknown: { label: '未設定', type: 'text', value: null },
  enabled: { label: '사용 여부', type: 'boolean', value: false },
  date: { label: 'Fecha', type: 'date', value: '2026-02-28' },
  state: { label: '状態', type: 'select', options: ['保留', '完了'], value: '保留' },
  constructor: { label: 'Literal field key', type: 'text' as const, value: 'Authored column' },
};

test('typed form round-trip and label rename preserve keys, zero, null, empty text, false and CRLF in real Core', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const raw = '---\r\nkind: record\r\n---\r\n\r\nAuthored body.\r\n';
  const created = ok(
    human.createObject({
      operationKey: 'initial',
      kind: 'record',
      content: { ...content(raw, 'Registro'), properties },
    }),
  );
  const inputs = fieldInputs(created.object.content.properties);
  inputs.find((row) => row.key === 'amount')!.label = '予算 / Presupuesto / 예산';
  const parsed = parseFields(inputs);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(Object.keys(parsed.properties).sort(), Object.keys(properties).sort());
  const editor = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: created.object.id })),
    { timers: false },
  );
  t.after(() => editor.dispose());
  editor.edit({ ...editor.getSnapshot().content, properties: parsed.properties });
  assert.equal(await editor.keepDraft(), true);
  assert.equal(await editor.saveNow(), true);
  const saved = ok(human.readObject({ objectId: created.object.id })).object;
  assert.equal(saved.kind, 'record');
  assert.equal(saved.content.body, raw);
  assert.equal(saved.content.properties.amount!.label, '予算 / Presupuesto / 예산');
  assert.equal(saved.content.properties.amount!.value, 0);
  assert.equal(saved.content.properties.empty!.value, '');
  assert.equal(saved.content.properties.unknown!.value, null);
  assert.equal(saved.content.properties.enabled!.value, false);
  assert.equal(saved.content.properties.date!.value, '2026-02-28');
  assert.equal(saved.content.properties.state!.value, '保留');
  assert.match(newField('text', id(801)).key, /^f_[a-f0-9]{32}$/);
});

test('invalid values remain invalid rather than becoming zero, a normalized date, or an undeclared choice', (t) => {
  const { human } = fixture(t);
  const row = { ...newField('number', id(802)), label: 'Cantidad', unset: false };
  for (const text of ['', ' ', 'Infinity', 'NaN', '1e999', '1,234,567', '0x10'])
    assert.deepEqual(parseField({ ...row, text }), { ok: false, problem: 'number' });
  assert.deepEqual(parseField({ ...row, text: '0' }), {
    ok: true,
    field: { label: 'Cantidad', type: 'number', value: 0 },
  });
  assert.deepEqual(parseField({ ...row, text: '1,5' }, ','), {
    ok: true,
    field: { label: 'Cantidad', type: 'number', value: 1.5 },
  });
  assert.deepEqual(parseField({ ...row, type: 'date', text: '2026-02-30' }), {
    ok: false,
    problem: 'date',
  });
  assert.deepEqual(parseField({ ...row, type: 'select', options: ['Sí', 'No'], text: 'Tal vez' }), {
    ok: false,
    problem: 'select',
  });
  for (const field of [
    { label: 'Number', type: 'number' as const, value: Infinity },
    { label: 'Date', type: 'date' as const, value: '2026-02-30' },
    { label: 'Choice', type: 'select' as const, options: ['Sí', 'No'], value: 'Tal vez' },
  ])
    error(
      human.createObject({
        operationKey: `invalid-${field.type}`,
        kind: 'record',
        content: { ...content(), properties: { field } },
      }),
      'INVALID_INPUT',
    );
});

test('relationships keep one object in two projects and preserve explicit source/asset pins after edits', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const a = ok(
    human.createObject({ operationKey: 'project-a', kind: 'project', content: content('Goal A') }),
  ).object;
  const b = ok(
    human.createObject({ operationKey: 'project-b', kind: 'project', content: content('Goal B') }),
  ).object;
  const source = ok(
    human.createObject({
      operationKey: 'source',
      kind: 'document',
      content: content('Evidence r1'),
    }),
  ).object;
  const asset = ok(
    human.createObject({
      operationKey: 'asset',
      kind: 'asset',
      content: content('Reusable reference'),
    }),
  ).object;
  const relations = [
    makeRelation('belongs_to', a, true),
    makeRelation('belongs_to', b, false),
    makeRelation('source', source, false),
    makeRelation('uses', asset, true),
    makeRelation('continues_from', source, false),
  ];
  const created = ok(
    human.createObject({
      operationKey: 'note',
      kind: 'document',
      content: { ...content('Working note'), relations },
    }),
  ).object;
  ok(
    human.saveObject({
      operationKey: 'source-next',
      targetId: source.id,
      expectedRevision: 1,
      content: content('Evidence r2'),
    }),
  );
  const editor = new EditorSession(api, session, ok(human.readObject({ objectId: created.id })), {
    timers: false,
  });
  t.after(() => editor.dispose());
  editor.setBody('Human correction');
  assert.equal(await editor.saveNow(), true);
  const saved = ok(human.readObject({ objectId: created.id }));
  assert.deepEqual(saved.object.content.relations, relations);
  assert.equal(
    saved.relationTargets.find((target) => target.relationId === relations[2]!.id)!.resolved!
      .revision,
    1,
  );
  for (const project of [a, b]) {
    const found = ok(
      human.query({ filter: { projectId: project.id }, limit: 50, maxBytes: 65_536 }),
    ).items;
    assert.equal(found.length, 1);
    assert.equal(found[0]!.ref.objectId, created.id);
  }
  assert.throws(() => makeRelation('belongs_to', asset, false));
  assert.throws(() => makeRelation('uses', source, true));
  error(
    human.createObject({
      operationKey: 'bad-project-reference',
      kind: 'document',
      content: {
        ...content(),
        relations: [
          { id: id(803), predicate: 'belongs_to', target: { mode: 'current', objectId: asset.id } },
        ],
      },
    }),
    'INVALID_INPUT',
  );
});

test('project and asset edits retain an existing-object recovery draft and save through the same editor', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  for (const kind of ['project', 'asset'] as const) {
    const created = ok(
      human.createObject({ operationKey: `create-${kind}`, kind, content: content() }),
    ).object;
    const editor = new EditorSession(api, session, ok(human.readObject({ objectId: created.id })), {
      timers: false,
    });
    t.after(() => editor.dispose());
    editor.setTitle(`Human ${kind}`);
    editor.setBody('Goals / State / 手動編集');
    assert.equal(await editor.keepDraft(), true);
    const draft = ok(human.readDraft({ draftId: editor.getSnapshot().draft!.draftId }));
    assert.deepEqual(draft.target, { state: 'existing', objectId: created.id, baseRevision: 1 });
    assert.equal(await editor.saveNow(), true);
    assert.equal(
      ok(human.readObject({ objectId: created.id })).object.content.body,
      'Goals / State / 手動編集',
    );
  }
});

test('a record proposal copy recovers typed fields and kind without flattening or accepting the original candidate', async (t) => {
  const { human, space } = fixture(t),
    { api, session } = bridge(human);
  const access = agent(space, human, 'grant-record', {
    creation: { enabled: true, kinds: ['record'] },
  });
  const candidateId = id(804);
  const proposed = { ...content('Author body', 'Candidate record'), properties };
  const candidate = ok(
    access.api.propose({
      operationKey: 'record-proposal',
      action: 'create',
      newObject: { id: candidateId, kind: 'record', content: proposed },
      purpose: 'Keep a typed reference',
      reason: 'Retain the authored field values.',
      sources: [],
    }),
  );
  const view = ok(human.getProposal({ proposalId: candidate.id }));
  const first = new EditorSession(api, session, null, {
    content: view.proposedContent,
    kind: 'record',
    source: { kind: 'proposal', proposalId: candidate.id },
    timers: false,
  });
  assert.equal(await first.keepDraft(), true);
  const kept = ok(human.readDraft({ draftId: first.getSnapshot().draft!.draftId }));
  assert.deepEqual(kept.target, { state: 'new', kind: 'record' });
  first.dispose();
  const recovered = new EditorSession(api, session, null, { draft: kept, timers: false });
  t.after(() => recovered.dispose());
  assert.equal(recovered.getSnapshot().kind, 'record');
  assert.deepEqual(recovered.getSnapshot().content, proposed);
  assert.equal(await recovered.saveNow(), true);
  const saved = ok(human.readObject({ objectId: recovered.getSnapshot().objectId! })).object;
  assert.equal(saved.kind, 'record');
  assert.deepEqual(saved.content.properties, properties);
  assert.notEqual(saved.id, candidateId);
  error(human.readObject({ objectId: candidateId }), 'NOT_FOUND');
  assert.equal(ok(human.getProposal({ proposalId: candidate.id })).proposal.status, 'pending');
  const reused = recordFromFields(saved.content.properties);
  assert.deepEqual(Object.keys(reused.properties).sort(), Object.keys(properties).sort());
  for (const [key, field] of Object.entries(reused.properties)) {
    assert.equal(field.value, null);
    assert.equal(field.label, properties[key]!.label);
    assert.equal(field.type, properties[key]!.type);
  }
  assert.deepEqual(reused.relations, []);
  assert.equal(reused.body, '');
  assert.equal(reused.title, '');
});

test('a stale typed edit keeps the complete human buffer and restores as a draft without overwriting the newer record', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const created = ok(
    human.createObject({
      operationKey: 'record-base',
      kind: 'record',
      content: { ...content('Original'), properties },
    }),
  ).object;
  const editor = new EditorSession(api, session, ok(human.readObject({ objectId: created.id })), {
    timers: false,
  });
  const inputs = fieldInputs(properties);
  inputs.find((field) => field.key === 'amount')!.label = 'Human label / 人のラベル';
  const fields = parseFields(inputs);
  assert.equal(fields.ok, true);
  if (!fields.ok) return;
  const humanBuffer = {
    ...editor.getSnapshot().content,
    properties: fields.properties,
    body: 'Unmerged human note',
  };
  editor.edit(humanBuffer);
  ok(
    human.saveObject({
      operationKey: 'another-writer',
      targetId: created.id,
      expectedRevision: 1,
      content: { ...created.content, body: 'Later persisted record' },
    }),
  );
  assert.equal(await editor.saveNow(), false);
  assert.equal(editor.getSnapshot().error, 'STALE_REVISION');
  assert.deepEqual(editor.getSnapshot().content, humanBuffer);
  assert.equal(await editor.keepDraft(), true);
  const retained = ok(human.readDraft({ draftId: editor.getSnapshot().draft!.draftId }));
  editor.dispose();
  const current = ok(human.readObject({ objectId: created.id }));
  const restored = new EditorSession(api, session, current, { draft: retained, timers: false });
  t.after(() => restored.dispose());
  assert.equal(restored.getSnapshot().kind, 'record');
  assert.deepEqual(restored.getSnapshot().content, humanBuffer);
  assert.equal(restored.getSnapshot().remote?.currentRevision, 2);
  assert.equal(await restored.saveNow(), false);
  assert.equal(
    ok(human.readObject({ objectId: created.id })).object.content.body,
    'Later persisted record',
  );
});
