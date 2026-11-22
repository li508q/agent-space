import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import {
  createBackup,
  exportCurrent,
  inspectBackup,
  restoreBackup,
} from '../../src/core/local/artifacts.js';
import { validateDatabase } from '../../src/core/local/validate.js';
import { Store } from '../../src/core/storage.js';
import { Engine } from '../../src/core/engine.js';
import { Space } from '../../src/core/index.js';
import { agent, content, error, fixture, id, ok } from './helpers.js';

function receiptBytes(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(
        'SELECT namespace,op_key,result_json,summary_json FROM receipts ORDER BY namespace,op_key',
      )
      .all();
  } finally {
    db.close();
  }
}
function replaceSnapshot(source: string, destination: string): void {
  const child = spawnSync(
    process.execPath,
    ['tests/core/local-restore-replace-worker.mjs', source, destination],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
}

test('restore rejects a same-instance backup replacement during acquisition, then the original operation restores only reviewed bytes and protects later edits', async (t) => {
  const f = fixture(t),
    h = f.human;
  const note = ok(
    h.createObject({
      operationKey: 'reviewed',
      kind: 'document',
      content: content('Reviewed backup text'),
    }),
  ).object;
  const granted = agent(f.space, h, 'grant');
  ok(
    h.saveDraft({
      operationKey: 'draft',
      draftId: randomUUID(),
      generation: 1,
      target: { state: 'existing', objectId: note.id, baseRevision: 1 },
      source: { kind: 'editor' },
      content: content('Retained draft'),
    }),
  );
  const b1 = join(f.root, 'reviewed-backup'),
    b2 = join(f.root, 'later-backup');
  ok(await createBackup(f.directory, { operationId: randomUUID(), destination: b1 }));
  const reviewed = ok(await inspectBackup(b1)).manifest;
  const original = join(f.root, 'reviewed.sqlite');
  replaceSnapshot(join(b1, 'backup.sqlite'), original);
  ok(
    h.saveObject({
      operationKey: 'later',
      targetId: note.id,
      expectedRevision: 1,
      content: content('Later text not in reviewed backup'),
    }),
  );
  ok(await createBackup(f.directory, { operationId: randomUUID(), destination: b2 }));
  const newer = ok(await inspectBackup(b2)).manifest;
  assert.equal(newer.snapshot.instanceId, reviewed.snapshot.instanceId);
  assert.notEqual(newer.database.sha256, reviewed.database.sha256);
  const request = {
    operationId: randomUUID(),
    destination: join(f.root, 'restored-race'),
    expectedBackupDigest: reviewed.database.sha256,
  };
  let replaced = false;
  const raced = await restoreBackup(b1, request, (p) => {
    if (p.stage === 'copying' && !replaced) {
      replaced = true;
      replaceSnapshot(join(b2, 'backup.sqlite'), join(b1, 'backup.sqlite'));
    }
  });
  assert.ok(replaced);
  error(raced, 'IMPORT_SOURCE_CHANGED');
  assert.equal(existsSync(join(request.destination, 'space.sqlite')), false);
  const intent = JSON.parse(readFileSync(join(request.destination, '.operation.json'), 'utf8')) as {
    receipt: unknown;
  };
  assert.equal(intent.receipt, null);
  error(await inspectBackup(b1), 'INTEGRITY_FAILURE');
  // Correcting the source must not get trapped behind the rejected B2 scratch.
  replaceSnapshot(original, join(b1, 'backup.sqlite'));
  const restored = ok(await restoreBackup(b1, request));
  assert.deepEqual(restored.counts, reviewed.counts);
  assert.deepEqual(restored.snapshot, {
    ...reviewed.snapshot,
    instanceId: restored.snapshot.instanceId,
  });
  assert.notEqual(restored.snapshot.instanceId, reviewed.snapshot.instanceId);
  const opened = ok(Space.open(request.destination));
  t.after(() => opened.close());
  const human = opened.human('restored-installation');
  assert.equal(
    ok(human.readObject({ objectId: note.id })).object.content.body,
    'Reviewed backup text',
  );
  assert.equal(ok(human.readObject({ objectId: note.id })).object.revision, 1);
  error(
    opened.agent({
      grantId: granted.grant.id,
      token: granted.token,
      instanceId: restored.snapshot.instanceId,
    }),
    'FORBIDDEN',
  );
  ok(
    human.saveObject({
      operationKey: 'human-after-restore',
      targetId: note.id,
      expectedRevision: 1,
      content: content('Later correct human edit'),
    }),
  );
  assert.deepEqual(ok(await restoreBackup(b1, request)), restored);
  assert.equal(
    ok(human.readObject({ objectId: note.id })).object.content.body,
    'Later correct human edit',
  );
  // An interrupted publication without a completed destination receipt cannot
  // be reconstructed from newer human heads or overwrite them during retry.
  const unfinished = JSON.parse(
    readFileSync(join(request.destination, '.operation.json'), 'utf8'),
  ) as { receipt: unknown };
  unfinished.receipt = null;
  writeFileSync(join(request.destination, '.operation.json'), JSON.stringify(unfinished));
  error(await restoreBackup(b1, request), 'INTEGRITY_FAILURE');
  assert.equal(
    ok(human.readObject({ objectId: note.id })).object.content.body,
    'Later correct human edit',
  );
});

test('restore rejects both poisoned reusable scratch and replacement of the acquired staging file, without poisoning a same-operation retry', async (t) => {
  const f = fixture(t),
    h = f.human;
  const note = ok(
    h.createObject({ operationKey: 'first', kind: 'document', content: content('Reviewed B1') }),
  ).object;
  const b1 = join(f.root, 'b1'),
    b2 = join(f.root, 'b2');
  ok(await createBackup(f.directory, { operationId: randomUUID(), destination: b1 }));
  const original = ok(await inspectBackup(b1)).manifest;
  ok(
    h.saveObject({
      operationKey: 'second',
      targetId: note.id,
      expectedRevision: 1,
      content: content('Unconfirmed B2'),
    }),
  );
  ok(await createBackup(f.directory, { operationId: randomUUID(), destination: b2 }));
  for (const mode of ['cached', 'after-copy'] as const) {
    const request = {
      operationId: randomUUID(),
      destination: join(f.root, mode),
      expectedBackupDigest: original.database.sha256,
    };
    const findWork = () => {
      const name = readdirSync(f.root).find((name) =>
        name.startsWith('.agentspace-work-' + request.operationId + '-'),
      );
      assert.ok(name);
      return join(f.root, name, 'snapshot.sqlite');
    };
    if (mode === 'cached') {
      // A failed attempt establishes the real owned intent/work area; it publishes nothing.
      error(
        await restoreBackup(b1, request, (p) => {
          if (p.stage === 'copying') throw new Error('Interrupted acquisition fixture');
        }),
        'STORAGE_FAILURE',
      );
      replaceSnapshot(join(b2, 'backup.sqlite'), findWork());
    }
    let injected = mode === 'cached';
    const result = await restoreBackup(b1, request, (p) => {
      if (mode === 'after-copy' && p.stage === 'validating' && !injected) {
        injected = true;
        replaceSnapshot(join(b2, 'backup.sqlite'), findWork());
      }
    });
    assert.ok(injected);
    error(result, 'IMPORT_SOURCE_CHANGED');
    assert.equal(
      existsSync(findWork()),
      false,
      'Rejected private scratch is invalidated before retry',
    );
    assert.equal(existsSync(join(request.destination, 'space.sqlite')), false);
    const intent = JSON.parse(
      readFileSync(join(request.destination, '.operation.json'), 'utf8'),
    ) as { receipt: unknown };
    assert.equal(intent.receipt, null);
    assert.equal(ok(await inspectBackup(b1)).manifest.database.sha256, original.database.sha256);
    const restored = ok(await restoreBackup(b1, request));
    assert.deepEqual(restored.counts, original.counts);
    const s = ok(Space.open(request.destination));
    try {
      assert.equal(
        ok(s.human('reader').readObject({ objectId: note.id })).object.content.body,
        'Reviewed B1',
      );
    } finally {
      s.close();
    }
  }
});

test('closed-backup acquisition preserves its confirmed bytes across Node and the Electron SQLite runtime', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Pinned macOS Electron Node-mode interoperability check');
    return;
  }
  const f = fixture(t);
  const note = ok(
    f.human.createObject({
      operationKey: 'note',
      kind: 'document',
      content: content('Exact backup 中文🙂\r\n'),
    }),
  ).object;
  const backup = join(f.root, 'reviewed backup');
  ok(await createBackup(f.directory, { operationId: randomUUID(), destination: backup }));
  const reviewed = ok(await inspectBackup(backup)).manifest;
  const executable = createRequire(import.meta.url)('electron') as string;
  const restored = spawnSync(
    executable,
    [
      'tests/core/local-restore-runtime-worker.mjs',
      backup,
      join(f.root, 'restored runtime'),
      note.id,
      reviewed.database.sha256,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  assert.equal(restored.status, 0, restored.stderr);
  const result = JSON.parse(restored.stdout) as {
    electron: string;
    node: string;
    body: string;
    snapshot: typeof reviewed.snapshot;
    counts: typeof reviewed.counts;
  };
  assert.equal(result.electron, '45.4.1');
  assert.equal(result.node, '24.22.3');
  assert.equal(result.body, note.content.body);
  assert.notEqual(result.snapshot.instanceId, reviewed.snapshot.instanceId);
  assert.deepEqual(
    { ...result.snapshot, instanceId: reviewed.snapshot.instanceId },
    reviewed.snapshot,
  );
  assert.deepEqual(result.counts, reviewed.counts);
});
test('consistent backup and readable current export are distinct; restore resets instance/grants while receipts and old-install drafts survive', async (t) => {
  const f = fixture(t),
    h = f.human;
  const note = ok(
    h.createObject({
      operationKey: 'create',
      id: id(1),
      kind: 'document',
      content: content('\uFEFF旧版\r\n🙂', 'Knowledge'),
    }),
  );
  const currentContent = content('新版\n', 'Knowledge');
  currentContent.properties = {
    amount: { label: '数量', type: 'number', value: 0 },
    unknown: { label: '不明', type: 'text', value: null },
    empty: { label: '제목', type: 'text', value: '' },
    done: { label: 'Completo', type: 'boolean', value: false },
    day: { label: '日付', type: 'date', value: '2026-11-23' },
    status: { label: 'Estado', type: 'select', options: ['nuevo', 'listo'], value: 'nuevo' },
  };
  ok(
    h.saveObject({
      operationKey: 'save',
      targetId: id(1),
      expectedRevision: 1,
      content: currentContent,
    }),
  );
  const repo = ok(
    h.createObject({
      operationKey: 'repo',
      id: id(2),
      kind: 'asset',
      content: content('', 'Repository'),
      origin: {
        mode: 'external-reference',
        label: 'Repository',
        locator: '/synthetic/missing-repository',
      },
    }),
  );
  ok(
    h.setLifecycle({
      operationKey: 'archive',
      objectId: repo.object.id,
      expectedRevision: 1,
      lifecycle: 'archived',
    }),
  );
  ok(
    h.saveDraft({
      operationKey: 'draft',
      draftId: id(3),
      generation: 8,
      target: { state: 'existing', objectId: id(1), baseRevision: 1 },
      source: { kind: 'revision', ref: { mode: 'pinned', objectId: id(1), revision: 1 } },
      content: content('Unsaved human material', 'Draft'),
    }),
  );
  const a = agent(f.space, h, 'grant');
  ok(
    a.api.propose({
      action: 'update',
      operationKey: 'proposal',
      targetId: id(1),
      baseRevision: 2,
      purpose: 'Clarify',
      reason: 'A test candidate',
      sources: [{ mode: 'pinned', objectId: id(1), revision: 1 }],
      patch: { body: 'Candidate' },
    }),
  );
  const before = ok(h.status()),
    beforeReceipts = receiptBytes(join(f.directory, 'space.sqlite'));
  const backupRequest = { operationId: randomUUID(), destination: join(f.root, 'backup') };
  validateDatabase(join(f.directory, 'space.sqlite'));
  const backup = ok(await createBackup(f.directory, backupRequest));
  assert.equal(backup.snapshot.authoritySequence, before.authoritySequence);
  assert.equal(backup.snapshot.activitySequence, before.activitySequence);
  assert.equal(backup.counts.revisions, 4);
  assert.equal(backup.counts.proposals, 1);
  assert.equal(backup.counts.retainedDrafts, 1);
  assert.equal(backup.externalTargetBytesIncluded, false);
  assert.deepEqual(ok(await createBackup(f.directory, backupRequest)), backup);
  assert.deepEqual(ok(h.status()), before);
  assert.deepEqual(receiptBytes(join(f.directory, 'space.sqlite')), beforeReceipts);
  const exported = ok(
    await exportCurrent(f.directory, {
      operationId: randomUUID(),
      destination: join(f.root, 'export'),
    }),
  );
  assert.equal(exported.counts.objects, 2);
  assert.equal(exported.counts.revisions, 2);
  assert.equal(exported.counts.proposals, 0);
  assert.equal(exported.counts.receipts, 0);
  assert.equal(exported.counts.retainedDrafts, 0);
  assert.equal(readFileSync(join(f.root, 'export/objects', id(1) + '.md'), 'utf8'), '新版\n');
  const typed = JSON.parse(
    readFileSync(join(f.root, 'export/objects', id(1) + '.json'), 'utf8'),
  ) as { content: { properties: unknown } };
  assert.deepEqual(typed.content.properties, currentContent.properties);
  const metadata = JSON.parse(
    readFileSync(join(f.root, 'export/objects', id(2) + '.json'), 'utf8'),
  ) as { lifecycle: string };
  assert.equal(metadata.lifecycle, 'archived');
  assert.ok(!readdirSync(join(f.root, 'export')).some((s) => /sqlite|snapshot/.test(s)));
  assert.equal(
    ok(await inspectBackup(join(f.root, 'backup'))).validation.counts.receipts,
    beforeReceipts.length,
  );
  const restoreRequest = { operationId: randomUUID(), destination: join(f.root, 'restored') };
  const restored = ok(await restoreBackup(join(f.root, 'backup'), restoreRequest));
  assert.notEqual(restored.snapshot.instanceId, before.instanceId);
  assert.equal(restored.snapshot.spaceId, before.spaceId);
  assert.equal(restored.disabledGrants, 1);
  assert.deepEqual(receiptBytes(join(f.root, 'restored/space.sqlite')), beforeReceipts);
  const reopened = ok(Space.open(join(f.root, 'restored')));
  t.after(() => reopened.close());
  error(
    reopened.agent({ grantId: a.grant.id, token: a.token, instanceId: before.instanceId }),
    'SPACE_MISMATCH',
  );
  error(
    reopened.agent({
      grantId: a.grant.id,
      token: a.token,
      instanceId: restored.snapshot.instanceId,
    }),
    'FORBIDDEN',
  );
  const newHuman = reopened.human('new-installation');
  assert.deepEqual(
    ok(newHuman.readObject({ objectId: id(1) })).object.content.properties,
    currentContent.properties,
  );
  const drafts = ok(newHuman.listRecoverableDrafts({ limit: 10 }));
  assert.equal(drafts.items.length, 1);
  const ref = drafts.items[0]!.recoveryRef;
  assert.equal(
    ok(newHuman.readRecoverableDraft({ recoveryRef: ref })).content.body,
    'Unsaved human material',
  );
  const forkRequest = { operationKey: 'recover', recoveryRef: ref, newDraftId: id(4) };
  const fork = ok(newHuman.copyRecoverableDraft(forkRequest));
  assert.equal(fork.generation, 1);
  assert.equal(fork.copiedFrom.generation, 8);
  assert.deepEqual(ok(newHuman.copyRecoverableDraft(forkRequest)), fork);
  assert.equal(ok(newHuman.readDraft({ draftId: id(4) })).content.body, 'Unsaved human material');
  assert.equal(
    ok(reopened.human('desktop-installation').readDraft({ draftId: id(3) })).generation,
    8,
  );
  assert.equal(
    ok(newHuman.readObject({ objectId: note.object.id, revision: 1 })).object.content.body,
    '\uFEFF旧版\r\n🙂',
  );
  // A destination receipt reports its original outcome even after later legitimate edits.
  ok(
    newHuman.saveObject({
      operationKey: 'later',
      targetId: id(1),
      expectedRevision: 2,
      content: content('Later restored edit'),
    }),
  );
  assert.deepEqual(ok(await restoreBackup(join(f.root, 'backup'), restoreRequest)), restored);
  assert.equal(
    ok(newHuman.readObject({ objectId: id(1) })).object.content.body,
    'Later restored edit',
  );
});

test('artifact validation rejects corruption, foreign destinations and unknown schema without altering the source', async (t) => {
  const f = fixture(t);
  ok(f.human.createObject({ operationKey: 'note', kind: 'document', content: content('A note') }));
  const request = { operationId: randomUUID(), destination: join(f.root, 'backup') };
  ok(await createBackup(f.directory, request));
  error(
    await createBackup(f.directory, { ...request, operationId: randomUUID() }),
    'DESTINATION_EXISTS',
  );
  const db = new DatabaseSync(join(request.destination, 'backup.sqlite'));
  db.exec('CREATE TRIGGER malicious AFTER UPDATE ON objects BEGIN DELETE FROM grants; END;');
  db.close();
  error(await inspectBackup(request.destination), 'INTEGRITY_FAILURE');
  assert.throws(
    () => validateDatabase(join(request.destination, 'backup.sqlite')),
    /INTEGRITY_FAILURE/,
  );
  assert.equal(ok(f.human.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length, 1);
  const before = readFileSync(join(request.destination, 'backup.json'));
  writeFileSync(join(request.destination, 'backup.json'), '{}');
  error(
    await restoreBackup(request.destination, {
      operationId: randomUUID(),
      destination: join(f.root, 'invalid-restore'),
    }),
    'INTEGRITY_FAILURE',
  );
  writeFileSync(join(request.destination, 'backup.json'), before);
});

test('process exit before publishing a backup leaves an incomplete destination; same operation resumes the already consistent snapshot', async (t) => {
  const f = fixture(t),
    h = f.human;
  const made = ok(
    h.createObject({
      operationKey: 'first',
      kind: 'document',
      content: content('Before the snapshot'),
    }),
  );
  const request = { operationId: randomUUID(), destination: join(f.root, 'backup') },
    requestFile = join(f.root, 'backup-request.json');
  writeFileSync(requestFile, JSON.stringify(request));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['tests/core/local-artifact-worker.mjs', f.directory, requestFile],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    child.stderr.on('data', (b) => (err += String(b)));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
  error(await inspectBackup(request.destination), 'NOT_FOUND');
  error(Space.open(request.destination), 'NOT_FOUND');
  ok(
    h.saveObject({
      operationKey: 'later',
      targetId: made.object.id,
      expectedRevision: 1,
      content: content('After the interrupted snapshot'),
    }),
  );
  const completed = ok(await createBackup(f.directory, request));
  assert.equal(completed.snapshot.authoritySequence, 1);
  const restored = ok(
    await restoreBackup(request.destination, {
      operationId: randomUUID(),
      destination: join(f.root, 'restored'),
    }),
  );
  assert.equal(restored.snapshot.authoritySequence, 1);
  const s = ok(Space.open(join(f.root, 'restored')));
  t.after(() => s.close());
  assert.equal(
    ok(s.human('reader').readObject({ objectId: made.object.id })).object.content.body,
    'Before the snapshot',
  );
});

test('online snapshot remains internally consistent when another real process commits between backup steps', async (t) => {
  const f = fixture(t);
  const made = ok(
    f.human.createObject({
      operationKey: 'large',
      kind: 'document',
      content: content('Initial snapshot '.repeat(35000)),
    }),
  );
  const marker = join(f.root, 'writer-committed');
  const writer = spawn(
    process.execPath,
    ['tests/core/local-snapshot-writer.mjs', f.directory, made.object.id, marker],
    { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  t.after(() => {
    if (writer.exitCode === null) writer.kill();
  });
  let err = '';
  writer.stderr!.on('data', (b) => (err += String(b)));
  const exited = new Promise<void>((resolve, reject) => {
    writer.on('error', reject);
    writer.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
  await new Promise<void>((resolve) => writer.once('message', () => resolve()));
  let injected = false;
  const backup = ok(
    await createBackup(
      f.directory,
      { operationId: randomUUID(), destination: join(f.root, 'backup') },
      (p) => {
        if (
          p.stage !== 'copying' ||
          p.completed === 0 ||
          p.total === null ||
          p.completed >= p.total ||
          injected
        )
          return;
        injected = true;
        writer.send('write');
        const end = Date.now() + 5000,
          sleeper = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(marker) && Date.now() < end) Atomics.wait(sleeper, 0, 0, 5);
        assert.ok(
          existsSync(marker),
          'The independent writer must commit while the online copy is in progress',
        );
      },
    ),
  );
  await exited;
  assert.ok(injected);
  assert.equal(ok(f.human.readObject({ objectId: made.object.id })).object.revision, 2);
  const validated = ok(await inspectBackup(join(f.root, 'backup')));
  assert.deepEqual(backup.snapshot, validated.validation.identity);
  const db = new DatabaseSync(join(f.root, 'backup/backup.sqlite'), { readOnly: true });
  try {
    const head = Number(
      db.prepare('SELECT head FROM objects WHERE id=?').get(made.object.id)!.head,
    );
    assert.equal(backup.snapshot.authoritySequence, head);
    assert.equal(backup.counts.revisions, head);
  } finally {
    db.close();
  }
});

test('SQLite-full source at the real 512 MiB page ceiling can still be backed up and exported without audit writes', async (t) => {
  const f = fixture(t);
  ok(
    f.human.createObject({
      operationKey: 'note',
      kind: 'document',
      content: content('Must remain exportable', 'Capacity'),
    }),
  );
  const store = Store.open(f.directory);
  t.after(() => store.close());
  const statement = store.db.prepare(
    "INSERT INTO activity(kind,actor_json,recorded_at,delivered_json,details_json) VALUES ('capacity-fixture',?,?,'[]',?)",
  );
  const actor = JSON.stringify({ kind: 'human', namespace: 'human:capacity-fixture' }),
    date = new Date().toISOString();
  for (const size of [4_000_000, 65_536, 512]) {
    const padding = JSON.stringify({ padding: 'x'.repeat(size) });
    let full = false;
    for (let n = 0; n < 3000; n++) {
      try {
        statement.run(actor, date, padding);
      } catch (e) {
        assert.equal(Number((e as { errcode: number }).errcode) & 255, 13);
        full = true;
        break;
      }
    }
    assert.ok(full);
  }
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  assert.equal(
    Number(store.one('PRAGMA max_page_count').max_page_count) *
      Number(store.one('PRAGMA page_size').page_size),
    536870912,
  );
  assert.ok(statSync(join(f.directory, 'space.sqlite')).size > 536_000_000);
  const engine = new Engine(store);
  error(
    engine.createObject(
      { kind: 'human', namespace: 'capacity-writer' },
      { operationKey: 'full-write', kind: 'document', content: content('new '.repeat(100_000)) },
    ),
    'LIMIT_EXCEEDED',
  );
  const before = ok(f.human.status()),
    receipts = receiptBytes(join(f.directory, 'space.sqlite'));
  const backed = ok(
    await createBackup(f.directory, {
      operationId: randomUUID(),
      destination: join(f.root, 'full-backup'),
    }),
  );
  assert.equal(backed.snapshot.activitySequence, before.activitySequence);
  const exported = ok(
    await exportCurrent(f.directory, {
      operationId: randomUUID(),
      destination: join(f.root, 'full-export'),
    }),
  );
  assert.equal(exported.counts.objects, 1);
  assert.deepEqual(ok(f.human.status()), before);
  assert.deepEqual(receiptBytes(join(f.directory, 'space.sqlite')), receipts);
});
