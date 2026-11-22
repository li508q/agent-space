import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Preferences } from '../../src/desktop/preferences.js';
import { Workspace } from '../../src/desktop/workspace.js';
import { LocalCoordinator } from '../../src/desktop/local-coordinator.js';
import type { LocalChoosers } from '../../src/desktop/local-coordinator.js';
import type { SpaceSession } from '../../src/contracts/app.js';
import type { Result } from '../../src/contracts/errors.js';
import type { ConfirmImportHandleSchema } from '../../src/contracts/local.js';
import type { z } from 'zod';
import { coreMethods, platformMethods } from '../../src/desktop/channels.js';

function ok<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(JSON.stringify(r));
  return r.value;
}
function bound<T>(s: SpaceSession, input: T) {
  return {
    bindingId: s.bindingId,
    spaceId: s.status.spaceId,
    instanceId: s.status.instanceId,
    input,
  };
}
function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'agentspace-local-main-'));
  const workspace = new Workspace(new Preferences(join(root, 'app-data')));
  const session = ok(workspace.create(join(root, 'space'), 'Local boundary'));
  const selected = {
    sources: [join(root, 'source.md')] as string[] | null,
    destination: join(root, 'artifact') as string | null,
    backup: join(root, 'artifact') as string | null,
    relink: join(root, 'new-repo') as string | null,
  };
  const choose: LocalChoosers = {
    importSources: async () => selected.sources,
    destination: async () => selected.destination,
    backup: async () => selected.backup,
    relink: async () => selected.relink,
  };
  const local = new LocalCoordinator(workspace, choose);
  writeFileSync(join(root, 'source.md'), '# A source\n中文🙂');
  t.after(() => {
    local.dispose();
    workspace.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, workspace, session, selected, local };
}
async function complete(local: LocalCoordinator, handle: string) {
  // A fast runner can consume thousands of empty event-loop turns before
  // SQLite's asynchronous snapshot finishes. Bound real time, not turn count.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const p = ok(local.readLocalTransfer({ handle }));
    if (p.stage === 'complete' || p.stage === 'failed') return p;
    if (Date.now() >= deadline) assert.fail(`Transfer did not settle; last stage: ${p.stage}`);
    await delay(10);
  }
}
test('native coordinator only accepts chooser handles, binds previews to each active session, and drives real Core imports', async (t) => {
  const f = setup(t);
  const preview = ok(
    await f.local.chooseImport(bound(f.session, { mode: 'files', profileId: 'plain-files/v1' })),
  );
  assert.ok(preview);
  assert.equal(preview.page.entries.length, 1);
  assert.ok(!JSON.stringify(preview).includes(f.root));
  const request: z.infer<typeof ConfirmImportHandleSchema> = {
    handle: preview.handle,
    operationKey: 'confirm',
    expectedPlanDigest: preview.page.planDigest,
    groups: [],
    choices: preview.page.entries.map((i) => ({
      itemId: i.id,
      action: 'managed-copy',
      project: { mode: 'none' },
      useAssetIds: [],
    })),
  };
  const created = ok(f.local.confirmImport(bound(f.session, request)));
  await f.local.idle();
  const result = ok(
    f.workspace.human!.getImport({ runId: created.id, limit: 10, maxBytes: 65536 }),
  );
  assert.equal(result.run.state, 'finished');
  assert.equal(result.items[0]!.relativePath, preview.page.entries[0]!.relativePath);
  assert.equal(
    ok(f.workspace.human!.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length,
    1,
  );
  writeFileSync(join(f.root, 'source.md'), 'Changed after successful import');
  assert.deepEqual(
    ok(f.local.confirmImport(bound(f.session, request))),
    created,
    'response-loss replay returns the original run receipt',
  );
  await f.local.idle();
  assert.equal(ok(f.workspace.human!.status()).authoritySequence, 1);
  f.selected.sources = null;
  assert.equal(
    ok(
      await f.local.chooseImport(bound(f.session, { mode: 'files', profileId: 'plain-files/v1' })),
    ),
    null,
  );
  assert.equal(f.workspace.session?.bindingId, f.session.bindingId);
  ok(f.workspace.create(join(f.root, 'space-b'), 'B'));
  const again = ok(f.workspace.open(join(f.root, 'space')));
  const stale = f.local.confirmImport(bound(again, request));
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'SPACE_MISMATCH');
  for (const forbidden of [
    'startImport',
    'commitImportItem',
    'getImportManifest',
    'relinkExternalAsset',
  ])
    assert.ok(![...coreMethods, ...platformMethods].includes(forbidden as never));
});

test('confirm detects changed preview bytes before writing a journal or accepted content', async (t) => {
  const f = setup(t);
  const preview = ok(
    await f.local.chooseImport(bound(f.session, { mode: 'folder', profileId: 'plain-files/v1' })),
  );
  assert.ok(preview);
  writeFileSync(join(f.root, 'source.md'), 'A newer snapshot');
  const changed = f.local.confirmImport(
    bound(f.session, {
      handle: preview.handle,
      operationKey: 'confirm',
      expectedPlanDigest: preview.page.planDigest,
      groups: [],
      choices: preview.page.entries.map((i) => ({
        itemId: i.id,
        action: 'managed-copy' as const,
        project: { mode: 'none' as const },
        useAssetIds: [],
      })),
    }),
  );
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.error.code, 'IMPORT_SOURCE_CHANGED');
  assert.equal(ok(f.workspace.human!.listImports({ limit: 10 })).items.length, 0);
  assert.equal(
    ok(f.workspace.human!.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length,
    0,
  );
});

test('native artifact operations publish destination receipts, reset grants on restore, and do not auto-open a new space', async (t) => {
  const f = setup(t),
    h = f.workspace.human!;
  ok(
    h.createObject({
      operationKey: 'note',
      kind: 'document',
      content: { title: 'A note', body: 'Saved', properties: {}, relations: [] },
    }),
  );
  const grant = ok(
    h.createGrant({
      operationKey: 'grant',
      spec: {
        label: 'Test client',
        scope: { mode: 'space' },
        capabilities: { read: true, propose: false },
      },
    }),
  );
  const op = { operationId: randomUUID() };
  const transfer = ok(await f.local.transfer(bound(f.session, op), 'sqlite-backup'));
  assert.ok(transfer);
  const finished = await complete(f.local, transfer.handle);
  assert.equal(finished.stage, 'complete');
  assert.deepEqual(ok(await f.local.transfer(bound(f.session, op), 'sqlite-backup')), transfer);
  assert.ok(!JSON.stringify(transfer).includes(f.root));
  const backup = ok(await f.local.chooseBackup());
  assert.ok(backup);
  f.selected.destination = join(f.root, 'restored');
  const restore = ok(
    await f.local.restoreBackup({ handle: backup.handle, operationId: randomUUID() }),
  );
  assert.ok(restore);
  assert.equal((await complete(f.local, restore.handle)).stage, 'complete');
  assert.equal(f.workspace.session?.bindingId, f.session.bindingId);
  const opened = ok(f.local.openRestoredSpace({ handle: restore.handle }));
  assert.notEqual(opened.status.instanceId, f.session.status.instanceId);
  assert.equal(opened.status.spaceId, f.session.status.spaceId);
  assert.equal(
    ok(f.workspace.human!.listGrants()).find((g) => g.id === grant.grant.id)?.revoked,
    true,
  );
  assert.equal(readFileSync(join(f.root, 'source.md'), 'utf8'), '# A source\n中文🙂');
});

test('restored pending run requires native reattachment and a fresh immutable approval before reading sources', async (t) => {
  const f = setup(t);
  const preview = ok(
    await f.local.chooseImport(bound(f.session, { mode: 'files', profileId: 'plain-files/v1' })),
  );
  assert.ok(preview);
  const run = ok(
    f.local.confirmImport(
      bound(f.session, {
        handle: preview.handle,
        operationKey: 'approve',
        expectedPlanDigest: preview.page.planDigest,
        groups: [],
        choices: preview.page.entries.map((i) => ({
          itemId: i.id,
          action: 'managed-copy' as const,
          project: { mode: 'none' as const },
          useAssetIds: [],
        })),
      }),
    ),
  );
  ok(
    f.workspace.human!.pauseImport({
      operationKey: 'pause',
      runId: run.id,
      expectedManifestDigest: run.manifestDigest,
    }),
  );
  await f.local.idle();
  const backup = ok(
    await f.local.transfer(bound(f.session, { operationId: randomUUID() }), 'sqlite-backup'),
  );
  assert.ok(backup);
  assert.equal((await complete(f.local, backup.handle)).stage, 'complete');
  const selected = ok(await f.local.chooseBackup());
  assert.ok(selected);
  f.selected.destination = join(f.root, 'restored');
  const restore = ok(
    await f.local.restoreBackup({ handle: selected.handle, operationId: randomUUID() }),
  );
  assert.ok(restore);
  assert.equal((await complete(f.local, restore.handle)).stage, 'complete');
  const opened = ok(f.local.openRestoredSpace({ handle: restore.handle }));
  rmSync(join(f.root, 'source.md'));
  f.selected.sources = null;
  const resume = {
    operationKey: 'resume',
    runId: run.id,
    expectedManifestDigest: run.manifestDigest,
  };
  const cancelled = ok(await f.local.resumeImport(bound(opened, resume)));
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(
    ok(f.workspace.human!.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length,
    0,
  );
  const newSource = join(f.root, 'new-source.md');
  writeFileSync(newSource, 'Reconfirmed content');
  f.selected.sources = [newSource];
  const reattached = ok(await f.local.resumeImport(bound(opened, resume)));
  assert.equal(reattached.state, 'confirmation-required');
  if (reattached.state !== 'confirmation-required') assert.fail();
  assert.equal(
    ok(f.workspace.human!.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length,
    0,
  );
  const p = reattached.preview;
  const newRun = ok(
    f.local.confirmImport(
      bound(opened, {
        handle: p.handle,
        operationKey: 'approve-new',
        expectedPlanDigest: p.page.planDigest,
        groups: [],
        choices: p.page.entries.map((i) => ({
          itemId: i.id,
          action: 'managed-copy' as const,
          project: { mode: 'none' as const },
          useAssetIds: [],
        })),
      }),
    ),
  );
  await f.local.idle();
  assert.notEqual(newRun.id, run.id);
  assert.equal(
    ok(
      f.workspace.human!.getImportManifest({
        runId: newRun.id,
        expectedManifestDigest: newRun.manifestDigest,
      }),
    ).parentRunId,
    run.id,
  );
  assert.equal(
    ok(f.workspace.human!.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length,
    1,
  );
});

test('relink confirmation keeps one frozen request on response-loss replay and exposes no raw path write', async (t) => {
  const f = setup(t),
    h = f.workspace.human!;
  const asset = ok(
    h.createObject({
      operationKey: 'asset',
      kind: 'asset',
      content: { title: 'Repo', body: '', properties: {}, relations: [] },
      origin: { mode: 'external-reference', label: 'Repo', locator: '/synthetic/old/repo' },
    }),
  );
  writeFileSync(f.selected.relink!, 'External target');
  const selection = ok(
    await f.local.chooseRelink(
      bound(f.session, { objectId: asset.object.id, expectedRevision: 1 }),
    ),
  );
  assert.ok(selection);
  const request = bound(f.session, {
    handle: selection.handle,
    operationKey: 'relink',
    expectedRevision: 1,
  });
  const changed = ok(f.local.confirmRelink(request));
  assert.equal(changed.object.id, asset.object.id);
  rmSync(f.selected.relink!);
  assert.deepEqual(
    ok(f.local.confirmRelink(request)),
    changed,
    'later disappearance cannot replace the original durable outcome',
  );
  assert.equal(ok(h.history({ objectId: asset.object.id, limit: 10 })).items.length, 2);
});
