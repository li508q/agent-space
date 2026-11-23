import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CloseCoordinator, type CloseState } from '../../src/renderer/state/close.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('closing waits for composition, then keeps input locked through the ready response', async () => {
  const composition = deferred<void>(),
    prepared = deferred<boolean>(),
    response = deferred<{ ok: true; value: { closed: boolean } }>();
  let locked = false;
  const sends: string[] = [];
  const states: CloseState[] = [];
  const close = new CloseCoordinator({
    afterComposition: () => composition.promise,
    lockInput: (value) => {
      locked = value;
      return true;
    },
    prepare: () => prepared.promise,
    respond: async (id, decision) => {
      sends.push(`${id}:${decision}`);
      return response.promise;
    },
    changed: (state) => states.push(state),
    error: () => assert.fail('unexpected close failure'),
  });
  const start = close.start('first');
  assert.equal(locked, false);
  composition.resolve();
  await tick();
  assert.equal(locked, true);
  prepared.resolve(true);
  await tick();
  assert.deepEqual(sends, ['first:ready']);
  assert.equal(locked, true);
  response.resolve({ ok: true, value: { closed: false } });
  await start;
  assert.equal(locked, false);
  assert.equal(states.at(-1), null);
});

test('a cancelled old nonce never locks input or sends late ready; a new nonce can proceed', async () => {
  const oldComposition = deferred<void>(),
    newComposition = deferred<void>();
  let count = 0,
    locked = false;
  const sends: string[] = [];
  const close = new CloseCoordinator({
    afterComposition: () => (++count === 1 ? oldComposition.promise : newComposition.promise),
    lockInput: (value) => {
      locked = value;
      return true;
    },
    prepare: async () => true,
    respond: async (id, decision) => {
      sends.push(`${id}:${decision}`);
      return { ok: true, value: { closed: true } };
    },
    changed: () => {},
    error: () => assert.fail('unexpected close failure'),
  });
  const old = close.start('old');
  close.cancel('old');
  const fresh = close.start('fresh');
  oldComposition.resolve();
  await old;
  assert.equal(locked, false);
  assert.deepEqual(sends, []);
  newComposition.resolve();
  await fresh;
  assert.equal(locked, true);
  assert.deepEqual(sends, ['fresh:ready']);
  close.cancel('old');
  assert.equal(locked, true);
  close.cancel('fresh');
  assert.equal(locked, false);
});

test('cancellation during persistence invalidates its late ready and restores editing', async () => {
  const prepare = deferred<boolean>();
  let locked = false;
  const sends: string[] = [];
  const close = new CloseCoordinator({
    afterComposition: async () => {},
    lockInput: (value) => {
      locked = value;
      return true;
    },
    prepare: () => prepare.promise,
    respond: async (id, decision) => {
      sends.push(`${id}:${decision}`);
      return { ok: true, value: { closed: true } };
    },
    changed: () => {},
    error: () => {},
  });
  const pending = close.start('cancelled');
  await tick();
  assert.equal(locked, true);
  close.cancel('cancelled');
  assert.equal(locked, false);
  prepare.resolve(true);
  await pending;
  assert.deepEqual(sends, []);
});

test('an unknown ready response keeps input frozen until native cancellation', async () => {
  let locked = false;
  const close = new CloseCoordinator({
    afterComposition: async () => {},
    lockInput: (value) => {
      locked = value;
      return true;
    },
    prepare: async () => true,
    respond: async () => ({ ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } }),
    changed: () => {},
    error: () => {},
  });
  await close.start('unknown-ready');
  assert.equal(locked, true);
  await close.keepOpen('unknown-ready');
  assert.equal(locked, true);
  close.cancel('unknown-ready');
  assert.equal(locked, false);
});

test('discard waits for native confirmation and cancellation restores editing', async () => {
  const response = deferred<{ ok: true; value: { closed: boolean } }>();
  let locked = false;
  const sends: string[] = [];
  const states: CloseState[] = [];
  const close = new CloseCoordinator({
    afterComposition: async () => {},
    lockInput: (value) => {
      locked = value;
      return true;
    },
    prepare: async () => false,
    respond: async (id, decision) => {
      sends.push(`${id}:${decision}`);
      return response.promise;
    },
    changed: (state) => states.push(state),
    error: () => assert.fail('Discard must reach the native confirmation without editing content.'),
  });
  await close.start('confirmation');
  assert.equal(states.at(-1)?.stage, 'blocked');
  const pending = close.discard('confirmation');
  await tick();
  assert.deepEqual(sends, ['confirmation:discard']);
  assert.equal(states.at(-1)?.stage, 'responding');
  assert.equal(locked, true);
  response.resolve({ ok: true, value: { closed: false } });
  await pending;
  assert.equal(locked, false);
  assert.equal(close.pendingId, null);
  assert.equal(states.at(-1), null);
});
