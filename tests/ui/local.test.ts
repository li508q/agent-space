import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type { ArtifactReceipt, LocalProgress, PreviewSession } from '../../src/contracts/local.js';
import { createBackup } from '../../src/core/local/artifacts.js';
import {
  scanImport,
  readPreview,
  compileImport,
  captureImportItem,
  importManifestDigest,
} from '../../src/core/local/import-scan.js';
import {
  ArtifactOperation,
  defaultImportChoice,
  loadImportPreview,
  loadImportRun,
  readAcceptedSummary,
  recoveryText,
  savedContext,
} from '../../src/renderer/state/local.js';
import { OperationTask } from '../../src/renderer/state/operation.js';
import { EditorSession } from '../../src/renderer/state/editor.js';
import { agent, content, error, fixture, id, ok } from '../core/helpers.js';

const unknown = { ok: false, error: { code: 'OPERATION_UNKNOWN', retryable: true } } as const;
const sessionFor = (status: SpaceSession['status']): SpaceSession => ({
  bindingId: id(900),
  locationLabel: 'Synthetic',
  status,
});

async function runningImport(t: TestContext) {
  const f = fixture(t),
    source = join(f.root, 'incoming');
  mkdirSync(source);
  for (let i = 0; i < 60; i++)
    writeFileSync(join(source, `${String(i).padStart(2, '0')}.md`), `Synthetic ${i}`);
  const plan = ok(
    await scanImport({ selections: [{ path: source }], profileId: 'plain-files/v1' }),
  );
  const manifest = compileImport(
    plan,
    {
      operationKey: 'approve',
      planId: plan.id,
      expectedPlanDigest: plan.digest,
      choices: readPreview(plan).entries.map(defaultImportChoice),
      groups: [],
    },
    ok(f.human.status()),
  );
  const hash = importManifestDigest(manifest);
  ok(f.human.startImport({ operationKey: 'approve', manifest, expectedManifestDigest: hash }));
  const writer = f.open().human('desktop-installation');
  const operationKeys = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = ok(
      writer.getImport({
        runId: manifest.id,
        limit: 50,
        maxBytes: 65_536,
        ...(cursor ? { afterItemId: cursor } : {}),
      }),
    );
    for (const item of page.items) operationKeys.set(item.id, item.operationKey);
    cursor = page.nextAfterItemId ?? undefined;
  } while (cursor);
  let position = 0;
  function advance(count: number) {
    for (let i = 0; i < count; i++) {
      const item = manifest.items[position++]!;
      const body = captureImportItem(item);
      ok(
        writer.commitImportItem({
          operationKey: operationKeys.get(item.id)!,
          runId: manifest.id,
          expectedManifestDigest: hash,
          itemId: item.id,
          ...(body === undefined ? {} : { body }),
          capturedDigest: body === undefined ? null : item.rawDigest,
        }),
      );
    }
  }
  return { ...f, manifest, advance, session: sessionFor(ok(f.human.status())) };
}

test('preview orchestration loads every bounded Core page and page-local group, while references remain opt-in', async (t) => {
  const f = fixture(t),
    source = join(f.root, 'incoming');
  for (const group of ['A', 'B']) {
    mkdirSync(join(source, 'projects', group), { recursive: true });
    for (let i = 0; i < 12; i++)
      writeFileSync(
        join(source, 'projects', group, `${i}-${'long-title-'.repeat(10)}.md`),
        '---\r\nauthored: true\r\n---\r\n中文 日本語 한국어 Évidence',
      );
  }
  writeFileSync(join(source, 'reference.pdf'), '%PDF synthetic');
  const plan = ok(
    await scanImport({ selections: [{ path: source }], profileId: 'knowledge-project-repos/v1' }),
  );
  const initial: PreviewSession = { handle: 'native-preview', page: readPreview(plan, 0, 4096) };
  assert.ok(initial.page.nextCursor);
  let reads = 0;
  const loaded: number[] = [];
  const api: Pick<DesktopApi, 'readImportPreview'> = {
    readImportPreview: async (request) => {
      reads++;
      assert.equal(request.input.handle, initial.handle);
      assert.equal(request.input.maxBytes, 65_536);
      return { ok: true, value: readPreview(plan, Number(request.input.cursor), 4096) };
    },
  };
  const page = ok(
    await loadImportPreview(api, sessionFor(ok(f.human.status())), initial, (count) =>
      loaded.push(count),
    ),
  );
  assert.ok(reads > 1);
  assert.equal(page.entries.length, plan.sources.length);
  assert.deepEqual(page.groups.map((g) => g.id).sort(), plan.groups.map((g) => g.id).sort());
  assert.equal(page.nextCursor, null);
  assert.equal(new Set(page.entries.map((e) => e.id)).size, page.entries.length);
  assert.deepEqual(
    loaded,
    [...loaded].sort((a, b) => a - b),
  );
  const reference = page.entries.find((e) => e.kind === 'file-reference')!;
  assert.equal(defaultImportChoice(reference).action, 'skip');
  assert.ok(
    page.entries
      .filter((e) => e.kind === 'text')
      .every((e) => defaultImportChoice(e).action === 'managed-copy'),
  );
  error(
    await loadImportPreview(
      {
        readImportPreview: async () => ({
          ok: true,
          value: { ...readPreview(plan), planDigest: '0'.repeat(64) },
        }),
      },
      sessionFor(ok(f.human.status())),
      initial,
    ),
    'IMPORT_PLAN_CHANGED',
  );
  error(
    await loadImportPreview(
      { readImportPreview: async () => ({ ok: true, value: initial.page }) },
      sessionFor(ok(f.human.status())),
      initial,
    ),
    'INTEGRITY_FAILURE',
  );
});

test('import result refresh preserves the visible paginated range and exact committed references', async (t) => {
  const f = fixture(t),
    source = join(f.root, 'incoming');
  mkdirSync(source);
  for (let i = 0; i < 9; i++) writeFileSync(join(source, `${i}.md`), `Authored ${i}`);
  const plan = ok(
    await scanImport({ selections: [{ path: source }], profileId: 'plain-files/v1' }),
  );
  const page = readPreview(plan),
    manifest = compileImport(
      plan,
      {
        operationKey: 'approve',
        planId: plan.id,
        expectedPlanDigest: plan.digest,
        choices: page.entries.map(defaultImportChoice),
        groups: [],
      },
      ok(f.human.status()),
    );
  const hash = importManifestDigest(manifest);
  ok(f.human.startImport({ operationKey: 'approve', manifest, expectedManifestDigest: hash }));
  for (const item of manifest.items) {
    const pending = ok(
      f.human.getImport({ runId: manifest.id, limit: 50, maxBytes: 65_536 }),
    ).items.find((entry) => entry.id === item.id)!;
    const body = captureImportItem(item);
    ok(
      f.human.commitImportItem({
        operationKey: pending.operationKey,
        runId: manifest.id,
        expectedManifestDigest: hash,
        itemId: item.id,
        ...(body === undefined ? {} : { body }),
        capturedDigest: body === undefined ? null : item.rawDigest,
      }),
    );
  }
  const api: Pick<DesktopApi, 'getImport'> = {
    getImport: async (request) => f.human.getImport({ ...request.input, limit: 2 }),
  };
  const session = sessionFor(ok(f.human.status()));
  const first = ok(await loadImportRun(api, session, manifest.id, 4));
  assert.equal(first.items.length, 4);
  assert.ok(first.nextAfterItemId);
  const refreshed = ok(await loadImportRun(api, session, manifest.id, first.items.length));
  assert.deepEqual(refreshed.items, first.items);
  const all = ok(await loadImportRun(api, session, manifest.id, 50));
  assert.equal(all.items.length, 9);
  assert.equal(all.nextAfterItemId, null);
  for (const item of all.items) {
    assert.equal(item.state, 'committed');
    assert.ok(item.originalRef);
    assert.equal(
      ok(
        f.human.readObject({
          objectId: item.originalRef.objectId,
          revision: item.originalRef.revision,
        }),
      ).object.content.body,
      `Authored ${item.relativePath.slice(0, 1)}`,
    );
  }
});

test('import pagination restarts when another real Core connection finishes between pages, and publishes one consistent terminal view', async (t) => {
  const f = await runningImport(t);
  let calls = 0;
  const observed: number[] = [];
  const api: Pick<DesktopApi, 'getImport'> = {
    getImport: async (request) => {
      if (++calls === 2) f.advance(60);
      const result = f.human.getImport(request.input);
      if (result.ok) observed.push(result.value.run.progressRevision);
      return result;
    },
  };
  const published = ok(await loadImportRun(api, f.session, f.manifest.id, 100));
  assert.equal(published.run.state, 'finished');
  assert.equal(published.run.committed, 60);
  assert.equal(published.items.length, 60);
  assert.ok(
    published.items.every((item) => item.state === 'committed' && item.originalRef !== null),
  );
  assert.equal(published.nextAfterItemId, null);
  assert.deepEqual(observed, [0, 60, 60, 60]);
  assert.equal(calls, 4);
});

test('continuously advancing real import pages have a bounded retry result and never publish a mixed snapshot', async (t) => {
  const f = await runningImport(t);
  const prior = ok(
    await loadImportRun(
      { getImport: async (request) => f.human.getImport(request.input) },
      f.session,
      f.manifest.id,
      100,
    ),
  );
  assert.equal(prior.run.progressRevision, 0);
  let calls = 0;
  const result = await loadImportRun(
    {
      getImport: async (request) => {
        calls++;
        if (request.input.afterItemId) f.advance(1);
        return f.human.getImport(request.input);
      },
    },
    f.session,
    f.manifest.id,
    100,
  );
  error(result, 'CURSOR_STALE');
  if (!result.ok) assert.equal(result.error.retryable, true);
  assert.equal(calls, 6); // Three attempts, two real pages each; no unbounded loop.
  assert.equal(prior.run.progressRevision, 0);
  assert.ok(prior.items.every((item) => item.state === 'pending' && item.originalRef === null));
  const refreshed = ok(
    await loadImportRun(
      { getImport: async (request) => f.human.getImport(request.input) },
      f.session,
      f.manifest.id,
      100,
    ),
  );
  assert.equal(refreshed.run.progressRevision, 3);
  assert.equal(refreshed.run.committed, 3);
  assert.equal(
    refreshed.items.filter((item) => item.state === 'committed' && item.originalRef).length,
    3,
  );
});

test('a real backup committed before a structured unknown is recovered by original artifact identity, without the Core receipt ledger', async (t) => {
  const f = fixture(t);
  ok(
    f.human.createObject({
      operationKey: 'note',
      kind: 'document',
      content: content('Original artifact text'),
    }),
  );
  const operationId = randomUUID(),
    destination = join(f.root, 'backup');
  let sends = 0,
    reads = 0,
    completed: ArtifactReceipt | null = null;
  const operation = new ArtifactOperation(
    operationId,
    {
      readLocalTransfer: async ({ handle }) => {
        reads++;
        assert.equal(handle, 'native-transfer');
        assert.ok(completed);
        return {
          ok: true,
          value: {
            stage: 'complete',
            completed: 1,
            total: 1,
            bytes: null,
            receipt: completed,
            error: null,
          },
        };
      },
    },
    async () => {
      sends++;
      completed = ok(await createBackup(f.directory, { operationId, destination }));
      if (sends === 1) return unknown;
      return {
        ok: true,
        value: {
          handle: 'native-transfer',
          kind: 'sqlite-backup',
          destinationLabel: 'Chosen backup',
        },
      };
    },
    'sqlite-backup',
  );
  await operation.start();
  assert.equal(operation.getSnapshot().unknown, true);
  assert.equal(operation.getSnapshot().progress, null);
  await operation.start();
  const state = operation.getSnapshot();
  assert.equal(state.unknown, false);
  assert.equal(state.progress?.stage, 'complete');
  assert.equal(state.progress?.receipt?.operationId, operationId);
  assert.equal(state.progress?.receipt?.counts.objects, 1);
  assert.equal(sends, 2);
  assert.equal(reads, 1);
  await operation.start();
  await operation.refresh();
  assert.equal(sends, 2);
  assert.equal(reads, 1); // A checked receipt remains established evidence.
  assert.equal(ok(f.human.operationStatus({ operationKey: operationId })).state, 'not_found');
});

test('artifact completion without a matching checked receipt never becomes a completed result', async () => {
  const progress: LocalProgress = {
    stage: 'complete',
    completed: 1,
    total: null,
    bytes: null,
    receipt: null,
    error: null,
  };
  const operation = new ArtifactOperation(
    randomUUID(),
    { readLocalTransfer: async () => ({ ok: true, value: progress }) },
    async () => ({
      ok: true,
      value: { handle: 'original', kind: 'readable-export', destinationLabel: 'Export' },
    }),
    'readable-export',
  );
  await operation.start();
  assert.equal(operation.getSnapshot().error, 'INTEGRITY_FAILURE');
  assert.equal(operation.getSnapshot().unknown, true);
  assert.equal(operation.getSnapshot().progress, null);
  const wrong = new ArtifactOperation(
    randomUUID(),
    {
      readLocalTransfer: async () => {
        assert.fail('Wrong-kind session must not be read');
      },
    },
    async () => ({
      ok: true,
      value: { handle: 'wrong', kind: 'sqlite-backup', destinationLabel: 'Wrong artifact' },
    }),
    'restored-space',
  );
  await wrong.start();
  assert.equal(wrong.getSnapshot().error, 'INTEGRITY_FAILURE');
});

test('a stale artifact status read cannot overwrite the observation from replaying the original request', async () => {
  const failed: LocalProgress = {
    stage: 'failed',
    completed: 0,
    total: null,
    bytes: null,
    receipt: null,
    error: { code: 'STORAGE_BUSY', retryable: true },
  };
  const copying: LocalProgress = {
    stage: 'copying',
    completed: 1,
    total: null,
    bytes: null,
    receipt: null,
    error: null,
  };
  let release!: () => void,
    reads = 0,
    sends = 0;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = new ArtifactOperation(
    randomUUID(),
    {
      readLocalTransfer: async () => {
        reads++;
        if (reads === 2) await wait;
        return { ok: true, value: reads < 3 ? failed : copying };
      },
    },
    async () => {
      sends++;
      return {
        ok: true,
        value: { handle: 'same-operation', kind: 'sqlite-backup', destinationLabel: 'Backup' },
      };
    },
    'sqlite-backup',
  );
  await operation.start();
  const oldRead = operation.refresh(),
    replay = operation.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sends, 2);
  release();
  await Promise.all([oldRead, replay]);
  assert.equal(reads, 3);
  assert.equal(operation.getSnapshot().progress?.stage, 'copying');
  assert.equal(operation.getSnapshot().error, null);
});

test('other-installation recovery keeps the original readable, retains one new draft after unknown, and protects a newer object head', async (t) => {
  const f = fixture(t),
    oldHuman = f.space.human('previous-installation');
  const original = ok(
    f.human.createObject({ operationKey: 'record', kind: 'record', content: content('Base') }),
  ).object;
  const authored = {
    ...content('原稿\r\n日本語 한국어', 'Sin traducir'),
    properties: {
      count: { type: 'number' as const, label: '数量', value: 0 },
      empty: { type: 'text' as const, label: 'Vacío', value: '' },
      flag: { type: 'boolean' as const, label: '확인', value: false },
      unknown: { type: 'text' as const, label: '未設定', value: null },
    },
  };
  const oldId = randomUUID();
  ok(
    oldHuman.saveDraft({
      operationKey: 'old-draft',
      draftId: oldId,
      generation: 7,
      target: { state: 'existing', objectId: original.id, baseRevision: 1 },
      source: { kind: 'editor' },
      content: authored,
    }),
  );
  ok(
    f.human.saveObject({
      operationKey: 'later',
      targetId: original.id,
      expectedRevision: 1,
      content: content('Later persisted head'),
    }),
  );
  const row = ok(f.human.listRecoverableDrafts({ limit: 20 })).items[0]!;
  const view = ok(f.human.readRecoverableDraft({ recoveryRef: row.recoveryRef }));
  const text = recoveryText(view);
  assert.ok(text.includes(authored.body));
  assert.ok(text.includes('"value": false'));
  assert.ok(text.includes('"value": null'));
  const session = sessionFor(ok(f.human.status())),
    newDraftId = randomUUID(),
    input = { operationKey: 'recover-once', recoveryRef: row.recoveryRef, newDraftId };
  let sends = 0;
  const task = new OperationTask(
    { operationStatus: async (request) => f.human.operationStatus(request.input) },
    session,
    input.operationKey,
    async () => {
      sends++;
      const result = f.human.copyRecoverableDraft(input);
      return sends === 1 ? unknown : result;
    },
  );
  await assert.rejects(task.run());
  const copied = ok(await task.run());
  assert.equal(copied.retained, true);
  assert.equal(copied.draftId, newDraftId);
  assert.notEqual(copied.draftId, oldId);
  assert.deepEqual(ok(oldHuman.readDraft({ draftId: oldId })).content, authored);
  assert.equal(ok(f.human.listDrafts({ limit: 20 })).items.length, 1);
  const api = {
    createObject: async (request: Parameters<DesktopApi['createObject']>[0]) =>
      f.human.createObject(request.input),
    saveObject: async (request: Parameters<DesktopApi['saveObject']>[0]) =>
      f.human.saveObject(request.input),
    saveDraft: async (request: Parameters<DesktopApi['saveDraft']>[0]) =>
      f.human.saveDraft(request.input),
    discardDraft: async (request: Parameters<DesktopApi['discardDraft']>[0]) =>
      f.human.discardDraft(request.input),
    operationStatus: async (request: Parameters<DesktopApi['operationStatus']>[0]) =>
      f.human.operationStatus(request.input),
  };
  const editor = new EditorSession(
    api,
    session,
    ok(f.human.readObject({ objectId: original.id })),
    { draft: ok(f.human.readDraft({ draftId: copied.draftId })), timers: false },
  );
  t.after(() => editor.dispose());
  assert.equal(editor.getSnapshot().kind, 'record');
  assert.deepEqual(editor.getSnapshot().content, authored);
  assert.equal(await editor.saveNow(), false);
  assert.equal(editor.getSnapshot().error, 'STALE_REVISION');
  assert.equal(
    ok(f.human.readObject({ objectId: original.id })).object.content.body,
    'Later persisted head',
  );
  assert.equal(
    recoveryText(ok(f.human.readRecoverableDraft({ recoveryRef: row.recoveryRef }))),
    text,
  );
});

test('saved context states its exact one-object scope and retains authored fields and pinned evidence', (t) => {
  const f = fixture(t),
    source = ok(
      f.human.createObject({
        operationKey: 'source',
        kind: 'document',
        content: content('Evidence'),
      }),
    ).object;
  const object = ok(
    f.human.createObject({
      operationKey: 'note',
      kind: 'record',
      content: {
        ...content('Full body\r\n选中段落', 'Título original'),
        properties: { value: { label: 'ラベル', type: 'boolean', value: false } },
        relations: [
          {
            id: randomUUID(),
            predicate: 'source',
            target: { mode: 'pinned', objectId: source.id, revision: 1 },
          },
        ],
      },
    }),
  ).object;
  const session = sessionFor(ok(f.human.status()));
  const full = JSON.parse(savedContext(session, object));
  assert.equal(full.scope, 'one-saved-object');
  assert.equal(full.object.body, object.content.body);
  assert.equal(full.object.revision, 1);
  assert.equal(full.object.digest, object.digest);
  const selected = JSON.parse(savedContext(session, object, '选中段落'));
  assert.equal(selected.scope, 'one-saved-object-selected-body');
  assert.equal(selected.object.body, undefined);
  assert.equal(selected.object.bodySelection, '选中段落');
  assert.deepEqual(selected.object.properties, object.content.properties);
  assert.deepEqual(selected.object.relations, object.content.relations);
  assert.throws(() =>
    savedContext({ ...session, status: { ...session.status, instanceId: randomUUID() } }, object),
  );
});

test('history explanation reads a fixed accepted target, while direct human saves have a neutral absence', async (t) => {
  const f = fixture(t),
    session = sessionFor(ok(f.human.status()));
  const source = ok(
    f.human.createObject({
      operationKey: 'source',
      kind: 'document',
      content: content('Old source'),
    }),
  ).object;
  const target = ok(
    f.human.createObject({
      operationKey: 'target',
      kind: 'document',
      content: content('Human note'),
    }),
  ).object;
  const api: Pick<DesktopApi, 'readAcceptedChange'> = {
    readAcceptedChange: async (request) => f.human.readAcceptedChange(request.input),
  };
  assert.equal(ok(await readAcceptedSummary(api, session, target.changeId, target.id, 1)), null);
  const a = agent(f.space, f.human, 'grant');
  const proposal = ok(
    a.api.propose({
      action: 'update',
      operationKey: 'proposal',
      targetId: target.id,
      baseRevision: 1,
      patch: { body: 'Proposed' },
      purpose: '共同の文脈',
      reason: 'Razón declarada',
      sources: [{ mode: 'pinned', objectId: source.id, revision: 1 }],
    }),
  );
  const applied = ok(
    f.human.reviewProposal({
      operationKey: 'accept',
      proposalId: proposal.id,
      expectedProposalVersion: proposal.statusVersion,
      expectedPayloadHash: proposal.payloadHash,
      decision: 'accept',
      expectedTarget: { state: 'revision', revision: 1 },
    }),
  );
  assert.ok(applied.changeId);
  ok(
    f.human.saveObject({
      operationKey: 'source-next',
      targetId: source.id,
      expectedRevision: 1,
      content: content('New source'),
    }),
  );
  const explanation = ok(await readAcceptedSummary(api, session, applied.changeId, target.id, 2));
  assert.equal(explanation?.declared.reason, 'Razón declarada');
  assert.equal(explanation?.declared.purpose, '共同の文脈');
  const evidence = ok(
    f.human.readAcceptedChange({
      changeId: applied.changeId,
      section: 'evidence',
      maxBytes: 65_536,
    }),
  );
  assert.equal(evidence.section, 'evidence');
  if (evidence.section === 'evidence')
    assert.deepEqual(evidence.items[0]!.ref, { mode: 'pinned', objectId: source.id, revision: 1 });
  error(
    await readAcceptedSummary(api, session, applied.changeId, target.id, 3),
    'INTEGRITY_FAILURE',
  );
});
