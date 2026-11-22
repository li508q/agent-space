import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadPage } from '../../src/contracts/schema.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

const query = { filter: {}, limit: 1, maxBytes: 10000 };

test('Unicode fragment continuations pin old content, enforce actual encoded budget, and recheck scope', (t) => {
  const f = fixture(t);
  const h = f.human;
  const original = '知识🙂 / 記録 / 지식 / cafe\u0301\n'.repeat(200);
  ok(
    h.createObject({
      operationKey: 'note',
      id: id(1),
      kind: 'document',
      content: content(original, 'Long source'),
    }),
  );
  const a = agent(f.space, h, 'grant');
  let result = a.api.read({
    ref: { mode: 'current', objectId: id(1) },
    section: 'body',
    maxBytes: 1800,
  });
  let page = ok(result);
  assert.equal(page.section, 'body');
  const firstCursor = page.nextCursor;
  assert.ok(firstCursor);
  ok(
    h.saveObject({
      operationKey: 'new-head',
      targetId: id(1),
      expectedRevision: 1,
      content: content('Later text'),
    }),
  );
  let recovered = '';
  let previousEnd = 0;
  let pages = 0;
  while (true) {
    assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
    assert.ok(page.returnedBytes <= 1800);
    assert.equal(page.ref.revision, 1);
    assert.equal(page.section, 'body');
    if (page.section === 'body') {
      assert.equal(page.range.start, previousEnd);
      previousEnd = page.range.endExclusive;
      recovered += page.text;
    }
    pages++;
    assert.ok(pages < 1000);
    if (!page.nextCursor) break;
    result = a.api.read({ cursor: page.nextCursor, maxBytes: 1800 });
    page = ok(result);
  }
  assert.equal(recovered, original);
  assert.equal(previousEnd, Array.from(original).length);
  error(a.api.read({ cursor: firstCursor + 'x', maxBytes: 1800 }), 'INVALID_CURSOR');
  ok(
    h.updateGrant({
      operationKey: 'new-generation',
      grantId: a.grant.id,
      expectedGeneration: 1,
      spec: { ...a.spec, label: 'Updated configured label' },
      revoked: false,
    }),
  );
  error(a.api.read({ cursor: firstCursor, maxBytes: 1800 }), 'CURSOR_STALE');
  assert.equal(ok(h.readObject({ objectId: id(1) })).object.content.body, 'Later text');
  const delivered = ok(h.activity({ limit: 50 })).items.filter((e) => e.tool === 'object_read');
  assert.ok(delivered.length);
  assert.ok(delivered.every((e) => e.stage === 'prepared' && e.delivered[0]?.ref.revision === 1));
  assert.ok(delivered[0]?.delivered[0]?.range);
});

test('current-state query cursors ignore activity/drafts/seen and reject authority or filter changes', (t) => {
  const f = fixture(t);
  const h = f.human;
  for (let n = 1; n <= 3; n++)
    ok(
      h.createObject({
        operationKey: 'note:' + n,
        id: id(n),
        kind: 'document',
        content: content('Note ' + n),
      }),
    );
  const a = agent(f.space, h, 'grant');
  const page = ok(a.api.query(query));
  assert.ok(page.nextCursor);
  const before = ok(h.status());
  ok(a.api.read({ ref: page.items[0]!.ref, section: 'summary', maxBytes: 3000 }));
  const after = ok(h.status());
  assert.equal(after.authoritySequence, before.authoritySequence);
  assert.ok(after.activitySequence > before.activitySequence);
  const draft = {
    operationKey: 'draft',
    draftId: id(10),
    generation: 1,
    target: { state: 'existing' as const, objectId: id(1), baseRevision: 1 },
    source: { kind: 'editor' as const },
    content: content('Not accepted'),
  };
  ok(h.saveDraft(draft));
  const second = ok(a.api.query({ ...query, cursor: page.nextCursor }));
  assert.equal(second.items[0]?.ref.objectId, id(2));
  error(
    a.api.query({ ...query, filter: { text: 'Note' }, cursor: page.nextCursor }),
    'INVALID_CURSOR',
  );
  ok(
    h.saveObject({
      operationKey: 'accepted',
      targetId: id(1),
      expectedRevision: 1,
      content: content('Accepted change'),
    }),
  );
  error(a.api.query({ ...query, cursor: page.nextCursor }), 'CURSOR_STALE');
  const activities = ok(h.activity({ limit: 50 }));
  const beforePoll = ok(h.status());
  ok(h.activity({ limit: 50, through: activities.through }));
  assert.deepEqual(ok(h.status()), beforePoll);
  assert.ok(
    activities.items.some(
      (e) => e.tool === 'objects_query' && e.delivered.length === 1 && e.details.scopeDigest,
    ),
  );
  const small = a.api.query({ filter: {}, limit: 50, maxBytes: 1024 });
  if (small.ok) assert.ok(small.value.returnedBytes <= 1024);
  else assert.equal(small.error.code, 'LIMIT_EXCEEDED');
});

test('typed query and five-language literal search preserve authored text and hide outside scope', (t) => {
  const f = fixture(t);
  const h = f.human;
  const texts = [
    'A clear decision.',
    '项目目标与知识来源',
    '意思決定の記録と資料',
    '프로젝트 지식과 출처',
    'Una decisión y Café.',
  ];
  for (const [i, text] of texts.entries()) {
    const c = content(text, text);
    c.properties = {
      flag:
        i === 0
          ? { label: '数值', type: 'number', value: 0 }
          : { label: '完了', type: 'boolean', value: false },
      empty: { label: '空', type: 'number', value: null },
    };
    c.properties.observed_on = {
      label: '记录日期',
      type: 'date',
      value: i === 0 ? '2026-11-23' : null,
    };
    ok(h.createObject({ operationKey: 'note:' + i, id: id(i + 1), kind: 'document', content: c }));
  }
  const a = agent(f.space, h, 'grant', {
    scope: { mode: 'objects', objectIds: [id(1), id(2), id(3), id(4), id(5)] },
  });
  for (const [text, expected] of [
    ['decision', 1],
    ['知', 2],
    ['知识', 2],
    ['記', 3],
    ['지식', 4],
    ['DECISIÓN', 5],
    ['cafe\u0301', 5],
  ] as const) {
    const p = ok(a.api.query({ filter: { text }, limit: 50, maxBytes: 10000 }));
    assert.deepEqual(
      p.items.map((i) => i.ref.objectId),
      [id(expected)],
    );
  }
  assert.equal(
    ok(
      a.api.query({ filter: { property: { key: 'flag', equals: 0 } }, limit: 50, maxBytes: 10000 }),
    ).items.length,
    1,
  );
  assert.equal(
    ok(
      a.api.query({
        filter: { property: { key: 'flag', equals: false } },
        limit: 50,
        maxBytes: 10000,
      }),
    ).items.length,
    4,
  );
  assert.equal(
    ok(
      a.api.query({
        filter: { property: { key: 'empty', equals: null } },
        limit: 50,
        maxBytes: 10000,
      }),
    ).items.length,
    5,
  );
  assert.equal(
    ok(
      a.api.query({
        filter: { property: { key: 'missing', equals: null } },
        limit: 50,
        maxBytes: 10000,
      }),
    ).items.length,
    0,
  );
  assert.equal(
    ok(
      a.api.query({
        filter: { property: { key: 'observed_on', equals: '2026-11-23' } },
        limit: 20,
        maxBytes: 65536,
      }),
    ).items.length,
    1,
  );
  assert.equal(ok(h.readObject({ objectId: id(5) })).object.content.body, texts[4]);
  const short = ok(
    a.api.read({ ref: { mode: 'current', objectId: id(1) }, section: 'body', maxBytes: 1024 }),
  );
  assert.equal(short.truncated, false);
  if (short.section === 'body') assert.equal(short.text, texts[0]);
  ok(
    h.createObject({
      operationKey: 'outside',
      id: id(6),
      kind: 'document',
      content: content('知识 hidden', 'Outside title'),
    }),
  );
  const scoped = ok(a.api.query({ filter: { text: '知识' }, limit: 50, maxBytes: 10000 }));
  assert.deepEqual(
    scoped.items.map((i) => i.ref.objectId),
    [id(2)],
  );
  assert.equal(JSON.stringify(ok(a.api.changes({ limit: 50 }))).includes(id(6)), false);
  const hiddenRef = {
    id: id(20),
    predicate: 'source' as const,
    target: { mode: 'pinned' as const, objectId: id(6), revision: 1 },
  };
  const current = ok(h.readObject({ objectId: id(1) })).object;
  ok(
    h.saveObject({
      operationKey: 'hidden-relation',
      targetId: id(1),
      expectedRevision: 1,
      content: { ...current.content, relations: [hiddenRef] },
    }),
  );
  const relations = ok(
    a.api.read({ ref: { mode: 'current', objectId: id(1) }, section: 'relations', maxBytes: 5000 }),
  );
  assert.equal(JSON.stringify(relations).includes(id(6)), false);
  assert.equal(relations.unavailableReferences, true);
  if (relations.section === 'relations') assert.deepEqual(relations.entries, []);
  const huge = content('Fields');
  huge.properties = { large: { label: 'A long field', type: 'text', value: 'x'.repeat(20000) } };
  ok(h.createObject({ operationKey: 'large-field', id: id(7), kind: 'record', content: huge }));
  const whole = agent(f.space, h, 'whole');
  const small = whole.api.read({
    ref: { mode: 'current', objectId: id(7) },
    section: 'properties',
    maxBytes: 1024,
  });
  error(small, 'LIMIT_EXCEEDED');
  const large: ReadPage = ok(
    whole.api.read({
      ref: { mode: 'current', objectId: id(7) },
      section: 'properties',
      maxBytes: 65536,
    }),
  );
  if (large.section === 'properties')
    assert.equal(large.entries[0]?.field.value, huge.properties.large!.value);
});

test('recovery drafts persist their base/source/generation without becoming accepted work', (t) => {
  const f = fixture(t);
  const h = f.human;
  ok(
    h.createObject({
      operationKey: 'note',
      id: id(1),
      kind: 'document',
      content: content('Accepted r1'),
    }),
  );
  const before = ok(h.status());
  const input = {
    operationKey: 'draft:1',
    draftId: id(10),
    generation: 1,
    target: { state: 'existing' as const, objectId: id(1), baseRevision: 1 },
    source: { kind: 'editor' as const },
    content: content('Unaccepted buffer'),
  };
  const draft = ok(h.saveDraft(input));
  assert.equal(draft.retained, true);
  assert.deepEqual(ok(h.status()), before);
  assert.deepEqual(ok(h.saveDraft(input)), draft);
  error(
    h.saveDraft({
      ...input,
      operationKey: 'same-generation-different',
      content: content('Overwrite race'),
    }),
    'IDEMPOTENCY_KEY_REUSED',
  );
  ok(
    h.saveObject({
      operationKey: 'external-head',
      targetId: id(1),
      expectedRevision: 1,
      content: content('External r2'),
    }),
  );
  ok(
    h.saveDraft({
      ...input,
      operationKey: 'draft:2',
      generation: 2,
      content: content('Retained against old base'),
    }),
  );
  error(h.saveDraft({ ...input, operationKey: 'old-generation' }), 'STALE_REVISION');
  const opened = f.open().human('desktop-installation');
  const read = ok(opened.readDraft({ draftId: id(10) }));
  assert.equal(read.content.body, 'Retained against old base');
  assert.equal(read.target.state, 'existing');
  assert.equal(ok(opened.readObject({ objectId: id(1) })).object.content.body, 'External r2');
  assert.equal(ok(opened.listDrafts({ limit: 10 })).items.length, 1);
  assert.equal(
    ok(f.space.human('different-installation').listDrafts({ limit: 10 })).items.length,
    0,
  );
  error(
    opened.discardDraft({ operationKey: 'wrong-discard', draftId: id(10), expectedGeneration: 1 }),
    'STALE_REVISION',
  );
  ok(opened.discardDraft({ operationKey: 'discard', draftId: id(10), expectedGeneration: 2 }));
  error(
    opened.saveDraft({ ...input, operationKey: 'late-resurrection', generation: 3 }),
    'STALE_REVISION',
  );
  const status = ok(opened.operationStatus({ operationKey: 'draft:2' }));
  if (status.state === 'recorded')
    assert.deepEqual(status.receipt.business, {
      kind: 'draft',
      draftId: id(10),
      generation: 2,
      retained: true,
      digest: read.digest,
    });
});
