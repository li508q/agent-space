import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Space, createExampleSpace } from '../../src/core/index.js';
import { Engine } from '../../src/core/engine.js';
import { Store } from '../../src/core/storage.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

test('real space persists identities, exact revisions, no-op receipts and generation across reopen', (t) => {
  const f = fixture(t);
  const h = f.human;
  const missing = join(f.root, 'missing');
  error(Space.open(missing), 'NOT_FOUND');
  assert.equal(existsSync(missing), false);
  error(Space.create(f.directory, { title: 'Do not overwrite' }), 'INVALID_INPUT');
  const first = ok(
    h.createObject({
      operationKey: 'create:1',
      id: id(1),
      kind: 'document',
      content: content('Original\n中文🙂', ''),
      generation: 0,
    }),
  );
  assert.equal(first.object.revision, 1);
  assert.equal(first.object.content.title, '');
  ok(
    h.createObject({
      operationKey: 'case-id',
      id: id(0xab),
      kind: 'document',
      content: content('Canonical UUID'),
    }),
  );
  error(
    h.createObject({
      operationKey: 'case-collision',
      id: id(0xab).toUpperCase(),
      kind: 'document',
      content: content('Not another identity'),
    }),
    'OBJECT_ID_RESERVED',
  );
  const before = ok(h.status());
  const same = ok(
    h.saveObject({
      operationKey: 'no-op',
      targetId: id(1),
      expectedRevision: 1,
      content: first.object.content,
      generation: 1,
    }),
  );
  assert.equal(same.state, 'unchanged');
  assert.equal(same.changeId, null);
  assert.equal(ok(h.status()).authoritySequence, before.authoritySequence);
  const saved = ok(
    h.saveObject({
      operationKey: 'save:2',
      targetId: id(1),
      expectedRevision: 1,
      content: content('Saved later', 'A note'),
      generation: 2,
    }),
  );
  assert.equal(saved.object.revision, 2);
  assert.equal(saved.generation, 2);
  error(
    h.saveObject({
      operationKey: 'stale',
      targetId: id(1),
      expectedRevision: 1,
      content: saved.object.content,
    }),
    'STALE_REVISION',
  );
  assert.equal(
    ok(h.readObject({ objectId: id(1), revision: 1 })).object.content.body,
    'Original\n中文🙂',
  );
  const status = ok(h.status());
  f.space.close();
  const reopened = f.open().human('desktop-installation');
  assert.deepEqual(ok(reopened.status()), status);
  assert.deepEqual(
    ok(
      reopened.createObject({
        operationKey: 'create:1',
        id: id(1),
        kind: 'document',
        content: content('Original\n中文🙂', ''),
        generation: 0,
      }),
    ),
    first,
  );
  assert.deepEqual(
    ok(
      reopened.saveObject({
        operationKey: 'save:2',
        targetId: id(1),
        expectedRevision: 1,
        content: content('Saved later', 'A note'),
        generation: 2,
      }),
    ),
    saved,
  );
  error(
    reopened.saveObject({
      operationKey: 'save:2',
      targetId: id(1),
      expectedRevision: 2,
      content: content('Different request'),
    }),
    'IDEMPOTENCY_KEY_REUSED',
  );
  const history = ok(reopened.history({ objectId: id(1), limit: 1 }));
  assert.equal(history.items[0]?.revision, 2);
  assert.equal(history.truncated, true);
  assert.equal(
    ok(reopened.history({ objectId: id(1), limit: 1, beforeRevision: history.nextBeforeRevision! }))
      .items[0]?.revision,
    1,
  );
  assert.equal(ok(reopened.operationStatus({ operationKey: 'save:2' })).state, 'recorded');
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.directory, 'space.sqlite')).mode & 0o777, 0o600);
  const example = ok(createExampleSpace(join(f.root, 'example')));
  t.after(() => example.close());
  assert.equal(ok(example.human('reader').status()).example, true);
  assert.equal(
    ok(example.human('reader').query({ filter: {}, limit: 10, maxBytes: 10000 })).items.length,
    1,
  );
});

test('typed labels and identity relationships stay distinct from pinned historical evidence', (t) => {
  const f = fixture(t);
  const h = f.human;
  ok(
    h.createObject({
      operationKey: 'project',
      id: id(1),
      kind: 'project',
      content: content('Goal', 'Original project'),
    }),
  );
  ok(
    h.createObject({
      operationKey: 'asset',
      id: id(2),
      kind: 'asset',
      content: content('', 'Reusable asset'),
    }),
  );
  ok(
    h.createObject({
      operationKey: 'source',
      id: id(3),
      kind: 'document',
      content: content('Original source', 'Original source'),
    }),
  );
  const note = content('A connected note');
  note.properties = {
    amount: { label: '数值', type: 'number', value: 0 },
    missing: { label: '不明', type: 'number', value: null },
    empty: { label: '제목', type: 'text', value: '' },
    complete: { label: 'Completo', type: 'boolean', value: false },
  };
  note.relations = [
    { id: id(21), predicate: 'belongs_to', target: { mode: 'current', objectId: id(1) } },
    { id: id(22), predicate: 'source', target: { mode: 'pinned', objectId: id(3), revision: 1 } },
    { id: id(23), predicate: 'uses', target: { mode: 'pinned', objectId: id(2), revision: 1 } },
  ];
  ok(h.createObject({ operationKey: 'note', id: id(4), kind: 'document', content: note }));
  ok(
    h.saveObject({
      operationKey: 'rename',
      targetId: id(1),
      expectedRevision: 1,
      content: content('New goal', 'Renamed project'),
    }),
  );
  ok(
    h.saveObject({
      operationKey: 'source-later',
      targetId: id(3),
      expectedRevision: 1,
      content: content('Revised source', 'Revised source'),
    }),
  );
  const view = ok(h.readObject({ objectId: id(4), revision: 1 }));
  assert.equal(view.relationTargets[0]?.title, 'Renamed project');
  assert.equal(view.relationTargets[0]?.resolved?.revision, 2);
  assert.equal(view.relationTargets[1]?.title, 'Original source');
  assert.equal(view.relationTargets[1]?.resolved?.revision, 1);
  error(
    h.createObject({
      operationKey: 'wrong-target-kind',
      kind: 'document',
      content: {
        ...content(),
        relations: [
          { id: id(24), predicate: 'belongs_to', target: { mode: 'current', objectId: id(3) } },
        ],
      },
    }),
    'INVALID_INPUT',
  );
  const a = agent(f.space, h, 'grant');
  const fields = ok(
    a.api.read({
      ref: { mode: 'current', objectId: id(4) },
      section: 'properties',
      maxBytes: 10000,
    }),
  );
  assert.equal(fields.section, 'properties');
  if (fields.section === 'properties')
    assert.deepEqual(
      Object.fromEntries(fields.entries.map((e) => [e.key, e.field])),
      note.properties,
    );
  error(
    a.api.propose({
      action: 'update',
      operationKey: 'change-label',
      targetId: id(4),
      baseRevision: 1,
      purpose: 'Change fields',
      reason: 'Attempted definition change',
      sources: [],
      patch: {
        properties: {
          ...note.properties,
          amount: { label: 'Different definition', type: 'number', value: 1 },
        },
      },
    }),
    'PROTECTED_FIELD',
  );
  const alias = { mode: 'pinned' as const, objectId: id(3), revision: 1 };
  assert.ok(
    a.api.propose({
      action: 'update',
      operationKey: 'shared-alias',
      targetId: id(4),
      baseRevision: 1,
      purpose: 'Clarify',
      reason: 'A valid shared JS reference is not a cycle',
      sources: [alias],
      patch: { relations: [{ id: id(25), predicate: 'source', target: alias }] },
    }).ok,
  );
});

test('malformed public input, schema versions and capacity fail clearly without mutating authority', (t) => {
  const f = fixture(t);
  const h = f.human;
  const circular: { nested?: unknown } = {};
  circular.nested = circular;
  let deep: unknown = {};
  for (let i = 0; i < 40; i++) deep = { deep };
  for (const input of [undefined, 1n, circular, { value: NaN }, () => 1])
    error(h.createObject(input as never), 'INVALID_INPUT');
  error(h.createObject(deep as never), 'LIMIT_EXCEEDED');
  const getter = Object.defineProperty({}, 'kind', {
    get() {
      throw new Error('Getter must not run');
    },
    enumerable: true,
  });
  error(h.createObject(getter as never), 'INVALID_INPUT');
  error(
    h.createObject({ operationKey: 'bad-unicode', kind: 'document', content: content('\uD800') }),
    'INVALID_INPUT',
  );
  assert.equal(ok(h.status()).authoritySequence, 0);
  const store = Store.open(f.directory);
  t.after(() => store.close());
  const count = Number(store.one('PRAGMA page_count').page_count);
  store.db.exec(`PRAGMA max_page_count=${count}`);
  const engine = new Engine(store);
  error(
    engine.createObject(
      { kind: 'human', namespace: 'limited-writer' },
      {
        operationKey: 'full',
        id: id(50),
        kind: 'document',
        content: content('large body '.repeat(20000)),
      },
    ),
    'LIMIT_EXCEEDED',
  );
  assert.equal(ok(h.status()).authoritySequence, 0);
  error(h.readObject({ objectId: id(50) }), 'NOT_FOUND');
  const db = new DatabaseSync(join(f.directory, 'space.sqlite'));
  t.after(() => db.close());
  db.exec('PRAGMA user_version=2');
  error(h.status(), 'SCHEMA_UNSUPPORTED');
  error(Space.open(f.directory), 'SCHEMA_UNSUPPORTED');
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 2);
  const bad = join(f.root, 'bad');
  mkdirSync(bad);
  const filename = join(bad, 'space.sqlite');
  writeFileSync(filename, 'not a database');
  error(Space.open(bad), 'INTEGRITY_FAILURE');
  assert.equal(readFileSync(filename, 'utf8'), 'not a database');
});
