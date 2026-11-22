import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type {
  DraftReceipt,
  ObjectSnapshot,
  ObjectView,
  OperationStatus,
  WriteResult,
} from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import { RequestGate } from '../../src/renderer/state/binding.js';
import { OperationTask, UnknownOutcome } from '../../src/renderer/state/operation.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session: SpaceSession = {
  bindingId: uuid(1),
  locationLabel: 'Test space',
  status: {
    spaceId: uuid(2),
    instanceId: uuid(3),
    title: 'Test',
    example: false,
    formatVersion: 2,
    coreContractVersion: 2,
    authoritySequence: 1,
    activitySequence: 0,
  },
};
const snapshot = (revision = 1, body = 'Original\r\nbody\r\n'): ObjectSnapshot => ({
  spaceId: session.status.spaceId,
  instanceId: session.status.instanceId,
  id: uuid(4),
  kind: 'document',
  revision,
  lifecycle: 'active',
  content: { title: '', body, properties: {}, relations: [] },
  policy: { protectedFields: [] },
  origin: { mode: 'managed', label: '' },
  digest: 'a'.repeat(64),
  parentRevision: revision > 1 ? revision - 1 : null,
  createdAt: '2026-11-23T00:00:00Z',
  actor: { kind: 'human', namespace: 'test' },
  changeId: uuid(100 + revision),
  authoritySequence: revision,
  knowledgeReview: null,
});
const view = (object = snapshot()): ObjectView => ({
  object,
  currentRevision: object.revision,
  relationTargets: [],
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type SaveRequest = Parameters<DesktopApi['saveObject']>[0];
type DraftRequest = Parameters<DesktopApi['saveDraft']>[0];
type DiscardRequest = Parameters<DesktopApi['discardDraft']>[0];

class FakeCore {
  object = snapshot();
  requests: SaveRequest[] = [];
  draftWrites: DraftRequest[] = [];
  discards: DiscardRequest[] = [];
  drafts = new Map<string, DraftReceipt>();
  retired = new Set<string>();
  receipts = new Map<string, Result<WriteResult>>();
  blockedSaves: ReturnType<typeof deferred<void>>[] = [];
  blockDiscard: ReturnType<typeof deferred<void>> | null = null;
  dropNextSave = false;
  failSaves = false;
  failDrafts = false;
  lookedUp: string[] = [];
  api: Pick<
    DesktopApi,
    'saveObject' | 'createObject' | 'saveDraft' | 'discardDraft' | 'operationStatus'
  > = {
    saveObject: async (request) => {
      this.requests.push(structuredClone(request));
      const key = request.input.operationKey;
      const replay = this.receipts.get(key);
      if (replay) return replay;
      const blocker = this.blockedSaves.shift();
      if (blocker) await blocker.promise;
      if (this.failSaves) return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: true } };
      if (request.input.expectedRevision !== this.object.revision) {
        return { ok: false, error: { code: 'STALE_REVISION', retryable: false } };
      }
      this.object = {
        ...snapshot(this.object.revision + 1),
        content: structuredClone(request.input.content),
      };
      const result: Result<WriteResult> = {
        ok: true,
        value: {
          state: 'saved',
          object: this.object,
          changeId: this.object.changeId,
          authoritySequence: this.object.authoritySequence,
          generation: request.input.generation ?? null,
        },
      };
      this.receipts.set(key, result);
      if (this.dropNextSave) {
        this.dropNextSave = false;
        throw new Error('reply lost');
      }
      return result;
    },
    createObject: async (request) => ({
      ok: true,
      value: {
        state: 'created',
        object: {
          ...snapshot(),
          id: request.input.id ?? uuid(999),
          kind: request.input.kind,
          content: request.input.content,
        },
        changeId: uuid(101),
        authoritySequence: 1,
        generation: request.input.generation ?? null,
      },
    }),
    saveDraft: async (request) => {
      this.draftWrites.push(structuredClone(request));
      if (this.failDrafts)
        return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: true } };
      if (this.retired.has(request.input.draftId))
        return { ok: false, error: { code: 'STALE_REVISION', retryable: false } };
      const previous = this.drafts.get(request.input.draftId);
      const sameGeneration = this.draftWrites.find(
        (entry) =>
          entry !== request &&
          entry.input.draftId === request.input.draftId &&
          entry.input.generation === request.input.generation,
      );
      if (previous && previous.generation > request.input.generation) {
        return { ok: false, error: { code: 'STALE_REVISION', retryable: false } };
      }
      if (sameGeneration)
        assert.deepEqual(
          sameGeneration.input,
          request.input,
          'one draft generation has one payload',
        );
      const receipt: DraftReceipt = {
        draftId: request.input.draftId,
        generation: request.input.generation,
        target: request.input.target,
        source: request.input.source,
        digest: 'd'.repeat(64),
        retained: true,
        updatedAt: '2026-11-23T00:00:00Z',
      };
      this.drafts.set(receipt.draftId, receipt);
      return { ok: true, value: receipt };
    },
    discardDraft: async (request) => {
      this.discards.push(structuredClone(request));
      if (this.blockDiscard) await this.blockDiscard.promise;
      const receipt = this.drafts.get(request.input.draftId);
      if (!receipt || receipt.generation !== request.input.expectedGeneration) {
        return { ok: false, error: { code: 'STALE_REVISION', retryable: false } };
      }
      this.retired.add(receipt.draftId);
      const retired = { ...receipt, retained: false };
      this.drafts.set(receipt.draftId, retired);
      return { ok: true, value: retired };
    },
    operationStatus: async (request) => {
      this.lookedUp.push(request.input.operationKey);
      const recorded = this.receipts.get(request.input.operationKey);
      const result: OperationStatus = recorded?.ok
        ? {
            state: 'recorded',
            currentProposal: null,
            receipt: {
              operationKey: request.input.operationKey,
              command: 'saveObject',
              requestDigest: 'f'.repeat(64),
              recordedAt: '2026-11-23T00:00:00Z',
              outcome: 'succeeded',
              errorCode: null,
              business: {
                kind: 'object',
                state: 'saved',
                ref: {
                  mode: 'pinned',
                  objectId: recorded.value.object.id,
                  revision: recorded.value.object.revision,
                },
                generation: recorded.value.generation,
                authoritySequence: recorded.value.authoritySequence,
                changeId: recorded.value.changeId,
              },
              objectRef: null,
              proposalId: null,
              changeId: recorded.value.changeId,
            },
          }
        : {
            state: 'not_found',
            operationKey: request.input.operationKey,
            interpretation: 'not_a_failure_confirmation',
          };
      return { ok: true, value: result };
    },
  };
  editor() {
    let next = 200;
    return new EditorSession(this.api, session, view(this.object), {
      timers: false,
      id: () => uuid(next++),
    });
  }
}

test('opening/observing preserves raw Markdown and CRLF without a write', () => {
  const core = new FakeCore();
  const editor = core.editor();
  editor.observe(view());
  assert.equal(editor.getSnapshot().content.body, 'Original\r\nbody\r\n');
  assert.equal(editor.getSnapshot().content.title, '');
  assert.equal(editor.dirty, false);
  assert.equal(core.requests.length, 0);
  editor.dispose();
});

test('a save acknowledgement does not label newer input Saved and rebases its draft with a fresh generation', async () => {
  const core = new FakeCore();
  const first = deferred<void>(),
    second = deferred<void>();
  core.blockedSaves.push(first, second);
  const editor = core.editor();
  editor.setBody('First input');
  const save = editor.saveNow();
  await tick();
  editor.setBody('Later input');
  await editor.keepDraft();
  const retainedBefore = editor.getSnapshot().draft;
  assert.equal(retainedBefore?.generation, 2);
  first.resolve();
  await tick();
  assert.equal(editor.getSnapshot().content.body, 'Later input');
  assert.notEqual(editor.getSnapshot().saveState, 'saved');
  assert.equal(editor.getSnapshot().savedGeneration, 1);
  assert.ok(editor.getSnapshot().generation > retainedBefore!.generation);
  const rebased = core.draftWrites.at(-1)!.input;
  assert.equal(rebased.target.state, 'existing');
  if (rebased.target.state === 'existing') assert.equal(rebased.target.baseRevision, 2);
  assert.ok(rebased.generation > retainedBefore!.generation);
  second.resolve();
  assert.equal(await save, true);
  assert.equal(core.object.content.body, 'Later input');
  assert.equal(editor.getSnapshot().saveState, 'saved');
  assert.equal(editor.dirty, false);
  editor.dispose();
});

test('an uncertain save retains and replays the original request/key before later edits', async () => {
  const core = new FakeCore();
  core.dropNextSave = true;
  const editor = core.editor();
  editor.setBody('Committed before response loss');
  assert.equal(await editor.saveNow(), false);
  assert.equal(editor.getSnapshot().saveState, 'checking');
  const first = core.requests[0]!;
  editor.setBody('New input after loss');
  assert.equal(await editor.saveNow(), true);
  assert.deepEqual(core.requests[1], first);
  assert.equal(core.lookedUp[0], first.input.operationKey);
  assert.notEqual(core.requests[2]!.input.operationKey, first.input.operationKey);
  assert.equal(core.object.content.body, 'New input after loss');
  editor.dispose();
});

test('retiring a saved draft cannot erase or reuse the draft for later input', async () => {
  const core = new FakeCore();
  const editor = core.editor();
  editor.setBody('First');
  await editor.keepDraft();
  const oldId = editor.getSnapshot().draft!.draftId;
  core.blockDiscard = deferred<void>();
  const save = editor.saveNow();
  await tick();
  assert.equal(core.discards[0]!.input.draftId, oldId);
  editor.setBody('Later');
  await editor.keepDraft();
  const fresh = editor.getSnapshot().draft!;
  assert.notEqual(fresh.draftId, oldId);
  const blocker = deferred<void>();
  core.blockedSaves.push(blocker);
  core.blockDiscard.resolve();
  core.blockDiscard = null;
  await tick();
  assert.equal(editor.getSnapshot().draft?.draftId, fresh.draftId);
  assert.equal(editor.getSnapshot().draft?.retained, true);
  assert.ok(core.retired.has(oldId));
  blocker.resolve();
  assert.equal(await save, true);
  editor.dispose();
});

test('composition defers saving and a background update cannot replace composing input', async () => {
  const core = new FakeCore();
  const editor = core.editor();
  editor.setComposing(true);
  editor.setBody('入力中');
  const save = editor.saveNow();
  editor.observe(view(snapshot(2, 'Background update')));
  await tick();
  assert.equal(core.requests.length, 0);
  assert.equal(editor.getSnapshot().content.body, '入力中');
  assert.equal(editor.getSnapshot().remote?.currentRevision, 2);
  editor.setComposing(false);
  assert.equal(await save, true);
  editor.dispose();
});

test('navigation refuses loss when both save and draft fail; a durable current draft is a safe exit', async () => {
  const core = new FakeCore();
  const editor = core.editor();
  core.failSaves = core.failDrafts = true;
  editor.setBody('Do not lose this');
  assert.equal(await editor.prepareToLeave(), false);
  assert.equal(editor.getSnapshot().content.body, 'Do not lose this');
  core.failDrafts = false;
  // A known failed attempt is terminal; use a new edit/generation for the next retention.
  editor.setBody('Do not lose this either');
  assert.equal(await editor.prepareToLeave(), true);
  assert.equal(editor.getSnapshot().draftState, 'kept');
  assert.equal(editor.getSnapshot().saveState, 'error');
  editor.dispose();
});

test('explicit draft discard retires identity; the next edit gets a fresh ID', async () => {
  const core = new FakeCore();
  const editor = core.editor();
  editor.setBody('Draft one');
  await editor.keepDraft();
  const id = editor.getSnapshot().draft!.draftId;
  assert.equal(await editor.discardEdits(), true);
  assert.ok(core.retired.has(id));
  editor.setBody('Draft two');
  await editor.keepDraft();
  assert.notEqual(editor.getSnapshot().draft!.draftId, id);
  assert.equal(core.drafts.get(id)!.retained, false);
  editor.dispose();
});

test('view callbacks check binding, object and epoch, including A→B→A', () => {
  const gate = new RequestGate();
  const ticket = gate.begin(session, uuid(4));
  const reopened = { ...session, bindingId: uuid(800) };
  assert.equal(gate.accepts(ticket, reopened, uuid(4)), false);
  assert.equal(gate.accepts(ticket, session, uuid(5)), false);
  gate.begin(session, uuid(4));
  assert.equal(gate.accepts(ticket, session, uuid(4)), false);
});

test('not_found after transport loss is not treated as a known failure', async () => {
  const core = new FakeCore();
  let calls = 0;
  const task = new OperationTask(
    core.api,
    session,
    'same-key',
    async (): Promise<Result<number>> => {
      if (++calls === 1) throw new Error('IPC failure');
      return { ok: true, value: 7 };
    },
  );
  await assert.rejects(task.run(), UnknownOutcome);
  assert.deepEqual(await task.run(), { ok: true, value: 7 });
  assert.equal(core.lookedUp[0], 'same-key');
  assert.equal(calls, 2);
});

test('a close lock waits for composition and refuses new input until cancellation', () => {
  const core = new FakeCore();
  const editor = core.editor();
  editor.setComposing(true);
  assert.equal(editor.lockInput(true), false);
  editor.setBody('入力を保持');
  editor.setComposing(false);
  assert.equal(editor.lockInput(true), true);
  const generation = editor.getSnapshot().generation;
  editor.setBody('Input after confirmed close generation');
  assert.equal(editor.getSnapshot().generation, generation);
  assert.equal(editor.getSnapshot().content.body, '入力を保持');
  editor.lockInput(false);
  editor.setBody('Input after cancellation');
  assert.ok(editor.getSnapshot().generation > generation);
  editor.dispose();
});
