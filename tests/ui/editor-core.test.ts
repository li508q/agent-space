import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type { Result } from '../../src/contracts/errors.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import { OperationTask } from '../../src/renderer/state/operation.js';
import { content, fixture, id, ok } from '../core/helpers.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const unknown = { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } } as const;

test('real Core commit + structured IPC unknown replays exactly once without labelling later input Saved', async (t) => {
  const { human } = fixture(t);
  const created = ok(
    human.createObject({ operationKey: 'initial', kind: 'document', content: content('Original') }),
  );
  const session: SpaceSession = {
    bindingId: id(700),
    locationLabel: 'Synthetic test space',
    status: ok(human.status()),
  };
  let lost = false;
  let release!: () => void;
  const second = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Parameters<DesktopApi['saveObject']>[0][] = [];
  const lookedUp: string[] = [];
  const api: Pick<
    DesktopApi,
    'saveObject' | 'createObject' | 'saveDraft' | 'discardDraft' | 'operationStatus'
  > = {
    createObject: async (request) => human.createObject(request.input),
    saveObject: async (request) => {
      requests.push(structuredClone(request));
      if (lost && requests.length > 2) await second;
      const result = human.saveObject(request.input);
      if (!lost && result.ok) {
        lost = true;
        return unknown;
      }
      return result;
    },
    saveDraft: async (request) => human.saveDraft(request.input),
    discardDraft: async (request) => human.discardDraft(request.input),
    operationStatus: async (request) => {
      lookedUp.push(request.input.operationKey);
      return human.operationStatus(request.input);
    },
  };
  const editor = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: created.object.id })),
    { timers: false },
  );
  t.after(() => editor.dispose());
  editor.setBody('Committed before structured unknown');
  assert.equal(await editor.saveNow(), false);
  assert.equal(editor.getSnapshot().saveState, 'checking');
  assert.equal(editor.getSnapshot().savedGeneration, 0);
  const original = requests[0]!;
  const receipt = ok(human.operationStatus({ operationKey: original.input.operationKey }));
  assert.equal(receipt.state, 'recorded');
  if (receipt.state === 'recorded') {
    assert.equal(receipt.receipt.business?.kind, 'object');
    if (receipt.receipt.business?.kind === 'object')
      assert.equal(receipt.receipt.business.generation, 1);
  }
  assert.equal(ok(human.history({ objectId: created.object.id, limit: 20 })).items.length, 2);
  editor.setBody('Later input survives');
  const recover = editor.saveNow();
  await tick();
  assert.deepEqual(requests[1], original);
  assert.deepEqual(lookedUp, [original.input.operationKey]);
  assert.equal(editor.getSnapshot().content.body, 'Later input survives');
  assert.notEqual(editor.getSnapshot().saveState, 'saved');
  assert.equal(editor.getSnapshot().savedGeneration, 1);
  assert.equal(ok(human.history({ objectId: created.object.id, limit: 20 })).items.length, 2);
  release();
  assert.equal(await recover, true);
  assert.equal(
    ok(human.readObject({ objectId: created.object.id })).object.content.body,
    'Later input survives',
  );
  assert.equal(ok(human.history({ objectId: created.object.id, limit: 20 })).items.length, 3);
});

test('real Core draft commit + structured unknown recovers the original retained generation', async (t) => {
  const { human } = fixture(t);
  const created = ok(
    human.createObject({ operationKey: 'initial', kind: 'document', content: content('Original') }),
  );
  const session: SpaceSession = {
    bindingId: id(701),
    locationLabel: 'Synthetic test space',
    status: ok(human.status()),
  };
  const authority = session.status.authoritySequence;
  const writes: Parameters<DesktopApi['saveDraft']>[0][] = [];
  let lost = false;
  const api: Pick<
    DesktopApi,
    'saveObject' | 'createObject' | 'saveDraft' | 'discardDraft' | 'operationStatus'
  > = {
    createObject: async (request) => human.createObject(request.input),
    saveObject: async (request) => human.saveObject(request.input),
    saveDraft: async (request) => {
      writes.push(structuredClone(request));
      const result = human.saveDraft(request.input);
      if (!lost && result.ok) {
        lost = true;
        return unknown;
      }
      return result;
    },
    discardDraft: async (request) => human.discardDraft(request.input),
    operationStatus: async (request) => human.operationStatus(request.input),
  };
  const editor = new EditorSession(
    api,
    session,
    ok(human.readObject({ objectId: created.object.id })),
    { timers: false },
  );
  t.after(() => editor.dispose());
  editor.setBody('Draft with unknown reply');
  assert.equal(await editor.keepDraft(), false);
  assert.equal(editor.getSnapshot().draftState, 'checking');
  assert.equal(await editor.keepDraft(), true);
  assert.deepEqual(writes[1], writes[0]);
  const retained = ok(human.listDrafts({ limit: 20 })).items;
  assert.equal(retained.length, 1);
  assert.equal(retained[0]!.generation, 1);
  assert.equal(editor.getSnapshot().draft?.draftId, retained[0]!.draftId);
  assert.equal(editor.getSnapshot().saveState, 'dirty');
  assert.equal(editor.getSnapshot().savedGeneration, 0);
  assert.equal(ok(human.status()).authoritySequence, authority);
});

test('known retryable failures remain terminal results rather than unknown outcomes', async (t) => {
  const { human } = fixture(t);
  const session: SpaceSession = {
    bindingId: id(702),
    locationLabel: 'Synthetic test space',
    status: ok(human.status()),
  };
  let sends = 0,
    lookups = 0;
  const task = new OperationTask(
    {
      operationStatus: async (request) => {
        lookups++;
        return human.operationStatus(request.input);
      },
    },
    session,
    'busy-once',
    async (): Promise<Result<number>> => {
      sends++;
      return { ok: false, error: { code: 'STORAGE_BUSY', retryable: true } };
    },
  );
  assert.equal((await task.run()).ok, false);
  assert.equal((await task.run()).ok, false);
  assert.equal(task.unknown, false);
  assert.equal(sends, 1);
  assert.equal(lookups, 0);
});
