import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type { HumanServices } from '../../src/contracts/core.js';
import { RequestGate } from '../../src/renderer/state/binding.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import { EditorTransitions, type TransitionTicket } from '../../src/renderer/state/transition.js';
import { content, fixture, id, ok } from '../core/helpers.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function bridge(human: HumanServices) {
  const session: SpaceSession = {
    bindingId: id(900),
    locationLabel: 'Synthetic transition space',
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

test('a committed creation with a delayed reply pauses the checked editor until a replacement inherits its lock', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const original = ok(
    human.createObject({
      operationKey: 'original',
      kind: 'document',
      content: content('Original body'),
    }),
  );
  let current: EditorSession | null = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: original.object.id })),
    { timers: false },
  );
  const previous = current,
    reply = deferred<void>(),
    committed = deferred<void>(),
    reads = new RequestGate();
  const navigation = new EditorTransitions({
    current: () => current,
    invalidateReads: () => reads.invalidate(),
    changed: () => {},
  });
  t.after(() => {
    navigation.dispose();
    current?.dispose();
  });
  previous.setBody('Input entered before navigation');
  const work = navigation.run(
    'creating',
    () => previous.prepareToLeave(),
    async (ticket) => {
      const created = ok(
        human.createObject({ operationKey: 'held-create', kind: 'document', content: content() }),
      );
      committed.resolve();
      await reply.promise;
      assert.equal(navigation.claimInstall(ticket), true);
      const next = new EditorSession(
        api,
        session,
        ok(human.readObject({ objectId: created.object.id })),
        { timers: false },
      );
      navigation.inherit(next);
      assert.equal(next.getSnapshot().locked, true);
      previous.dispose();
      current = next;
    },
    () => assert.fail('the original editor is durably saved'),
  );
  await committed.promise;
  assert.equal(previous.getSnapshot().locked, true);
  const checkedGeneration = previous.getSnapshot().generation;
  previous.setBody('Late input must not be accepted after the checked generation');
  assert.equal(previous.getSnapshot().generation, checkedGeneration);
  assert.equal(previous.getSnapshot().content.body, 'Input entered before navigation');
  assert.equal(
    ok(human.readObject({ objectId: original.object.id })).object.content.body,
    'Input entered before navigation',
  );
  reply.resolve();
  await work;
  assert.equal(current.getSnapshot().locked, false);
  assert.equal(ok(human.query({ filter: {}, limit: 50, maxBytes: 65_536 })).items.length, 2);
});

test('composition finishes before navigation locks, and close cancellation cannot release navigation or space locks', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const original = ok(
    human.createObject({ operationKey: 'original', kind: 'record', content: content() }),
  );
  let current = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: original.object.id })),
    { timers: false },
  );
  const previous = current,
    reply = deferred<void>(),
    started = deferred<void>();
  const navigation = new EditorTransitions({
    current: () => current,
    invalidateReads: () => {},
    changed: () => {},
  });
  t.after(() => {
    navigation.dispose();
    current.dispose();
  });
  previous.setComposing(true);
  const work = navigation.run(
    'creating',
    () => previous.prepareToLeave(),
    async (ticket) => {
      started.resolve();
      await reply.promise;
      assert.equal(navigation.claimInstall(ticket), true);
      const created = ok(
        human.createObject({ operationKey: 'replacement', kind: 'record', content: content() }),
      );
      const next = new EditorSession(
        api,
        session,
        ok(human.readObject({ objectId: created.object.id })),
        { timers: false },
      );
      navigation.inherit(next);
      previous.dispose();
      current = next;
    },
    () => assert.fail('composition should save'),
  );
  await tick();
  assert.equal(previous.getSnapshot().locked, false);
  previous.setBody('入力中の確定内容');
  previous.setComposing(false);
  await started.promise;
  assert.equal(navigation.setLock('space', true), true);
  assert.equal(navigation.setLock('close', true), true);
  navigation.setLock('close', false);
  assert.equal(previous.getSnapshot().locked, true);
  reply.resolve();
  await work;
  assert.equal(current.getSnapshot().locked, true);
  navigation.setLock('space', false);
  assert.equal(current.getSnapshot().locked, false);
  assert.equal(
    ok(human.readObject({ objectId: original.object.id })).object.content.body,
    '入力中の確定内容',
  );
});

test('a replacement installed while native close is pending stays locked after navigation completes', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const original = ok(
    human.createObject({
      operationKey: 'original',
      kind: 'document',
      content: content('Persisted'),
    }),
  );
  let current = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: original.object.id })),
    { timers: false },
  );
  const reply = deferred<void>(),
    started = deferred<void>();
  const navigation = new EditorTransitions({
    current: () => current,
    invalidateReads: () => {},
    changed: () => {},
  });
  t.after(() => {
    navigation.dispose();
    current.dispose();
  });
  const work = navigation.run(
    'creating',
    () => current.prepareToLeave(),
    async (ticket) => {
      const created = ok(
        human.createObject({ operationKey: 'new', kind: 'document', content: content() }),
      );
      started.resolve();
      await reply.promise;
      assert.equal(navigation.claimInstall(ticket), true);
      const next = new EditorSession(
        api,
        session,
        ok(human.readObject({ objectId: created.object.id })),
        { timers: false },
      );
      navigation.inherit(next);
      current.dispose();
      current = next;
    },
    () => assert.fail('the original is saved'),
  );
  await started.promise;
  navigation.setLock('close', true);
  let idle = false;
  const waiting = navigation.whenIdle().then(() => {
    idle = true;
  });
  await tick();
  assert.equal(idle, false);
  reply.resolve();
  await work;
  await waiting;
  assert.equal(current.getSnapshot().locked, true);
  current.setBody('Input after close confirmation must be ignored');
  assert.equal(current.getSnapshot().content.body, '');
  navigation.setLock('close', false);
  current.setBody('Input after Keep open');
  assert.equal(current.getSnapshot().content.body, 'Input after Keep open');
});

test('a cancelled late read cannot install or release a newer transition, and a remembered read cannot replace an installed editor', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  let current: EditorSession | null = null;
  const gate = new RequestGate(),
    remembered = gate.begin(session, id(901));
  const navigation = new EditorTransitions({
    current: () => current,
    invalidateReads: () => gate.invalidate(),
    changed: () => {},
  });
  t.after(() => {
    navigation.dispose();
    current?.dispose();
  });
  const oldReply = deferred<void>(),
    newReply = deferred<void>(),
    oldStarted = deferred<void>(),
    newStarted = deferred<void>();
  let oldTicket!: TransitionTicket;
  const old = navigation.run(
    'opening',
    async () => true,
    async (ticket) => {
      oldTicket = ticket;
      oldStarted.resolve();
      await oldReply.promise;
      assert.equal(navigation.claimInstall(ticket), false);
    },
    () => assert.fail('no buffer'),
  );
  await oldStarted.promise;
  assert.equal(gate.accepts(remembered, session), false);
  navigation.cancelOpening();
  const fresh = navigation.run(
    'creating',
    async () => true,
    async (ticket) => {
      newStarted.resolve();
      await newReply.promise;
      const created = ok(
        human.createObject({ operationKey: 'fresh', kind: 'document', content: content() }),
      );
      assert.equal(navigation.claimInstall(ticket), true);
      current = new EditorSession(
        api,
        session,
        ok(human.readObject({ objectId: created.object.id })),
        { timers: false },
      );
      navigation.inherit(current);
    },
    () => assert.fail('no buffer'),
  );
  await newStarted.promise;
  oldReply.resolve();
  await old;
  assert.equal(navigation.isCurrent(oldTicket), false);
  assert.equal(navigation.pending, true);
  assert.equal(navigation.locked, true);
  newReply.resolve();
  await fresh;
  assert.equal(navigation.claimInstall(), false);
});

test('a failed transition releases only its own lock and can be retried', async (t) => {
  const { human } = fixture(t),
    { api, session } = bridge(human);
  const created = ok(
    human.createObject({ operationKey: 'original', kind: 'document', content: content() }),
  );
  const current = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: created.object.id })),
    { timers: false },
  );
  const navigation = new EditorTransitions({
    current: () => current,
    invalidateReads: () => {},
    changed: () => {},
  });
  t.after(() => {
    navigation.dispose();
    current.dispose();
  });
  await assert.rejects(
    navigation.run(
      'opening',
      async () => true,
      async () => {
        navigation.setLock('close', true);
        throw new Error('Synthetic transport failure');
      },
      () => assert.fail('saved'),
    ),
  );
  assert.equal(current.getSnapshot().locked, true);
  navigation.setLock('close', false);
  assert.equal(current.getSnapshot().locked, false);
  let retried = false;
  await navigation.run(
    'opening',
    async () => true,
    async () => {
      retried = true;
    },
    () => assert.fail('saved'),
  );
  assert.equal(retried, true);
});
