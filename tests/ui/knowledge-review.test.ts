import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type { ObjectView, WriteResult } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import { RecentWork } from '../../src/renderer/state/recent.js';
import { content, fixture, id, ok } from '../core/helpers.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('same-head human review refreshes while the dirty editor base, input and generations stay independent', (t) => {
  const f = fixture(t);
  const object = ok(
    f.human.createObject({ operationKey: 'seed', kind: 'document', content: content('Original') }),
  ).object;
  const session: SpaceSession = {
    bindingId: id(501),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  const api = {
    saveObject: async (request: Parameters<DesktopApi['saveObject']>[0]) =>
      f.human.saveObject(request.input),
    createObject: async (request: Parameters<DesktopApi['createObject']>[0]) =>
      f.human.createObject(request.input),
    saveDraft: async (request: Parameters<DesktopApi['saveDraft']>[0]) =>
      f.human.saveDraft(request.input),
    discardDraft: async (request: Parameters<DesktopApi['discardDraft']>[0]) =>
      f.human.discardDraft(request.input),
    operationStatus: async (request: Parameters<DesktopApi['operationStatus']>[0]) =>
      f.human.operationStatus(request.input),
  };
  const editor = new EditorSession(api, session, ok(f.human.readObject({ objectId: object.id })), {
    timers: false,
  });
  t.after(() => editor.dispose());
  editor.setBody('My retained input');
  const before = editor.getSnapshot();
  ok(
    f.human.markKnowledgeReviewed({
      operationKey: 'review:same-head',
      ref: { mode: 'pinned', objectId: object.id, revision: 1 },
    }),
  );
  editor.observe(ok(f.human.readObject({ objectId: object.id })));
  let state = editor.getSnapshot();
  assert.equal(state.headReview.fresh, true);
  assert.equal(state.headReview.data?.knowledgeReviewState, 'current-reviewed');
  assert.equal(state.headReview.data?.currentRevision, 1);
  assert.equal(state.content.body, before.content.body);
  assert.equal(state.generation, before.generation);
  assert.equal(state.savedGeneration, before.savedGeneration);
  assert.equal(state.revision, before.revision);
  const next = ok(
    f.human.saveObject({
      operationKey: 'external',
      targetId: object.id,
      expectedRevision: 1,
      content: content('External current head'),
    }),
  ).object;
  editor.observe(ok(f.human.readObject({ objectId: object.id })));
  state = editor.getSnapshot();
  assert.equal(state.headReview.data?.knowledgeReviewState, 'changed-since-review');
  assert.equal(state.headReview.data?.currentRevision, next.revision);
  assert.equal(state.revision, 1);
  assert.equal(state.content.body, 'My retained input');
  assert.equal(state.generation, before.generation);
  assert.equal(state.remote?.currentRevision, 2);
  const fromReceipt = new EditorSession(
    api,
    session,
    { object, currentRevision: 1, relationTargets: [] },
    { timers: false, headVerified: false },
  );
  assert.equal(fromReceipt.getSnapshot().headReview.data, null);
  assert.equal(fromReceipt.getSnapshot().headReview.fresh, false);
  fromReceipt.dispose();
});

test('an original save receipt arriving after a later reviewed head cannot become current review metadata', async (t) => {
  const f = fixture(t);
  const object = ok(
    f.human.createObject({ operationKey: 'seed', kind: 'document', content: content('Original') }),
  ).object;
  const session: SpaceSession = {
    bindingId: id(502),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  const reply = deferred<Result<WriteResult>>();
  let committed: WriteResult | null = null,
    starts = 0;
  const api = {
    createObject: async (request: Parameters<DesktopApi['createObject']>[0]) =>
      f.human.createObject(request.input),
    saveObject: async (request: Parameters<DesktopApi['saveObject']>[0]) => {
      const result = f.human.saveObject(request.input);
      if (!committed && result.ok) {
        committed = result.value;
        return reply.promise;
      }
      return result;
    },
    saveDraft: async (request: Parameters<DesktopApi['saveDraft']>[0]) =>
      f.human.saveDraft(request.input),
    discardDraft: async (request: Parameters<DesktopApi['discardDraft']>[0]) =>
      f.human.discardDraft(request.input),
    operationStatus: async (request: Parameters<DesktopApi['operationStatus']>[0]) =>
      f.human.operationStatus(request.input),
  };
  const editor = new EditorSession(api, session, ok(f.human.readObject({ objectId: object.id })), {
    timers: false,
    onSaveStarting: () => {
      starts++;
    },
  });
  t.after(() => editor.dispose());
  editor.setBody('First committed input');
  const saving = editor.saveNow();
  await tick();
  assert.equal(editor.getSnapshot().headReview.fresh, false);
  const later = ok(
    f.human.saveObject({
      operationKey: 'later',
      targetId: object.id,
      expectedRevision: 2,
      content: content('Later current content'),
    }),
  ).object;
  ok(
    f.human.markKnowledgeReviewed({
      operationKey: 'review:later',
      ref: { mode: 'pinned', objectId: object.id, revision: later.revision },
    }),
  );
  editor.setBody('New input while the old receipt waits');
  assert.ok(committed);
  reply.resolve({ ok: true, value: committed });
  assert.equal(await saving, false);
  assert.ok(starts >= 2);
  assert.equal(editor.getSnapshot().error, 'STALE_REVISION');
  assert.equal(editor.getSnapshot().headReview.fresh, false);
  assert.equal(editor.getSnapshot().headReview.data?.currentRevision, 1);
  const before = editor.getSnapshot();
  editor.observe(ok(f.human.readObject({ objectId: object.id })));
  assert.equal(editor.getSnapshot().headReview.data?.currentRevision, 3);
  assert.equal(editor.getSnapshot().headReview.data?.knowledgeReviewState, 'current-reviewed');
  assert.equal(editor.getSnapshot().content.body, before.content.body);
  assert.equal(editor.getSnapshot().generation, before.generation);
});

test('MRU persists only ten instance positions, caps all overlapping current reads at two, and rejects late errors', async (t) => {
  const f = fixture(t);
  const session: SpaceSession = {
    bindingId: id(503),
    locationLabel: 'Synthetic',
    status: ok(f.human.status()),
  };
  for (let n = 1; n <= 12; n++)
    ok(
      f.human.createObject({
        operationKey: `seed:${n}`,
        id: id(n),
        kind: 'document',
        content: content('Private body must never enter UI storage', `Title ${n}`),
      }),
    );
  const saved = storage();
  let concurrent = 0,
    maximum = 0;
  const pending: {
    objectId: string;
    resolve: (result: Result<ObjectView>) => void;
    done: boolean;
  }[] = [];
  const recent = new RecentWork(
    {
      readObject: async (request) => {
        concurrent++;
        maximum = Math.max(maximum, concurrent);
        const reply = deferred<Result<ObjectView>>();
        pending.push({ objectId: request.input.objectId, resolve: reply.resolve, done: false });
        try {
          return await reply.promise;
        } finally {
          concurrent--;
        }
      },
    },
    session,
    saved,
  );
  t.after(() => recent.dispose());
  for (let n = 1; n <= 12; n++) recent.remember(id(n), n);
  const stored = [...saved.values.values()].join('');
  assert.ok(!stored.includes('Private body') && !stored.includes('Title'));
  const positions = JSON.parse(stored) as { items: { objectId: string; lastOpenedAt: number }[] };
  assert.equal(positions.items.length, 10);
  assert.deepEqual(Object.keys(positions.items[0]!).sort(), ['lastOpenedAt', 'objectId']);
  const old = recent.refresh();
  assert.equal(pending.length, 2);
  recent.invalidate();
  const fresh = recent.refresh();
  for (const item of pending.slice(0, 2)) {
    item.done = true;
    item.resolve({ ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } });
  }
  await tick();
  assert.equal(
    recent.getSnapshot().loading,
    true,
    'An obsolete failure/finally cannot stop the current load',
  );
  for (let round = 0; round < 20 && recent.getSnapshot().loading; round++) {
    for (const item of pending.filter((entry) => !entry.done)) {
      item.done = true;
      item.resolve(f.human.readObject({ objectId: item.objectId }));
    }
    await tick();
  }
  await old;
  await fresh;
  assert.equal(maximum, 2);
  assert.equal(recent.getSnapshot().loading, false);
  assert.equal(recent.getSnapshot().items.length, 10);
  assert.ok(recent.getSnapshot().items.every((item) => item.fresh && !item.error && item.summary));
  const reopened = new RecentWork(
    { readObject: async (request) => f.human.readObject(request.input) },
    session,
    saved,
  );
  await reopened.refresh();
  assert.equal(reopened.getSnapshot().items.length, 10);
  reopened.remember(id(999), 20);
  await reopened.refresh();
  assert.equal(reopened.getSnapshot().items[0]?.missing, true);
  reopened.remove(id(999));
  assert.equal(reopened.getSnapshot().items.length, 9);
  assert.ok(f.human.readObject({ objectId: id(12) }).ok);
  const otherInstance = new RecentWork(
    { readObject: async (request) => f.human.readObject(request.input) },
    { ...session, bindingId: id(504), status: { ...session.status, instanceId: id(505) } },
    saved,
  );
  assert.deepEqual(otherInstance.getSnapshot().items, []);
  otherInstance.dispose();
  reopened.dispose();
  const unavailable = new RecentWork(
    { readObject: async (request) => f.human.readObject(request.input) },
    session,
    {
      getItem: () => {
        throw new Error('Synthetic UI storage failure');
      },
      setItem: () => {},
    },
  );
  assert.equal(unavailable.getSnapshot().storageUnavailable, true);
  unavailable.dispose();
});
