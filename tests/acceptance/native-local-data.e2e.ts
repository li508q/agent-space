import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { SpaceSession } from '../../src/contracts/app.js';
import type { ImportRunPage, LocalProgress } from '../../src/contracts/local.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
function bound<T>(s: SpaceSession, input: T) {
  return {
    bindingId: s.bindingId,
    spaceId: s.status.spaceId,
    instanceId: s.status.instanceId,
    input,
  };
}
async function destination(n: NativeHarness, path: string) {
  await n.application.evaluate(({ dialog }, chosen) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => {
      dialog.showSaveDialog = original;
      return { canceled: false, filePath: chosen };
    };
  }, path);
}
async function completed(n: NativeHarness, handle: string): Promise<LocalProgress> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const p = ok(
      await n.page.evaluate((handle) => window.agentSpace.readLocalTransfer({ handle }), handle),
    );
    if (p.stage === 'complete') {
      assert.ok(p.receipt);
      return p;
    }
    assert.notEqual(p.stage, 'failed', JSON.stringify(p.error));
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Native transfer did not reach verified completion');
}

// Actual preload/Main/Core and native runtime; chooser responses only are substituted.
// Visible importer/recovery controls are verified separately, not inferred here.
test(
  'native local-data bridge preserves original files, later edits, backup scope and restored permissions',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const f = createAcceptanceFixture();
    const draftId = randomUUID();
    ok(
      f.human.saveDraft({
        operationKey: 'foreign:draft',
        draftId,
        generation: 7,
        target: { state: 'existing', objectId: f.ids.retryPolicy, baseRevision: 1 },
        source: {
          kind: 'revision',
          ref: { mode: 'pinned', objectId: f.ids.retryPolicy, revision: 1 },
        },
        content: {
          title: 'Retained human thought',
          body: 'Not yet accepted · 中文🙂',
          properties: {},
          relations: [],
        },
      }),
    );
    const original = readFileSync(join(f.originals, 'knowledge', 'Retry policy.md'));
    const n = await launchNative({ entry: root, userData: join(f.root, 'Native local profile') });
    try {
      await n.chooseNextFolder(f.directory);
      const s = ok(await n.page.evaluate(() => window.agentSpace.openSpace()));
      assert.ok(s);
      assert.equal(s.status.formatVersion, 2);
      const methods = await n.page.evaluate(() => Object.keys(window.agentSpace));
      for (const forbidden of [
        'startImport',
        'commitImportItem',
        'getImportManifest',
        'relinkExternalAsset',
      ])
        assert.ok(!methods.includes(forbidden));
      const doImport = async (operationKey: string): Promise<ImportRunPage> => {
        await n.chooseNextFolder(f.originals);
        const preview = ok(
          await n.page.evaluate(
            (p) => window.agentSpace.chooseImport(p),
            bound(s, { mode: 'folder' as const, profileId: 'knowledge-project-repos/v1' as const }),
          ),
        );
        assert.ok(preview);
        assert.equal(preview.page.summary.truncated, false);
        assert.equal(preview.page.nextCursor, null);
        assert.ok(preview.page.entries.some((e) => e.kind === 'repository'));
        const groups = preview.page.groups.map((g) => ({ groupId: g.id, title: g.title }));
        const choices = preview.page.entries
          .filter((e) => e.kind !== 'group' && e.kind !== 'skipped')
          .map((e) => ({
            itemId: e.id,
            action: e.kind === 'text' ? ('managed-copy' as const) : ('external-reference' as const),
            project: e.groupId
              ? { mode: 'group' as const, groupId: e.groupId }
              : { mode: 'none' as const },
            useAssetIds: [],
          }));
        const run = ok(
          await n.page.evaluate(
            (p) => window.agentSpace.confirmImport(p),
            bound(s, {
              handle: preview.handle,
              operationKey,
              expectedPlanDigest: preview.page.planDigest,
              choices,
              groups,
            }),
          ),
        );
        for (let i = 0; i < 200; i++) {
          const p: ImportRunPage = ok(
            await n.page.evaluate(
              (request) => window.agentSpace.getImport(request),
              bound(s, { runId: run.id, limit: 50, maxBytes: 65536 }),
            ),
          );
          if (p.run.state === 'finished') return p;
          assert.notEqual(p.run.state, 'finished-with-errors', JSON.stringify(p.items));
          assert.equal(p.coordinatorError, undefined);
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        assert.fail('Import did not finish');
      };
      const first = await doImport('native:import:first');
      const imported = first.items.find((i) =>
        i.relativePath.endsWith('knowledge/Retry policy.md'),
      );
      assert.ok(imported?.originalRef);
      const object = ok(f.human.readObject({ objectId: imported.targetId })).object;
      assert.equal(object.content.body, original.toString('utf8'));
      const corrected = ok(
        f.human.saveObject({
          operationKey: 'human:correction',
          targetId: object.id,
          expectedRevision: object.revision,
          content: { ...object.content, body: 'Human correction must survive re-import' },
        }),
      );
      const repeated = await doImport('native:import:again');
      const reused = repeated.items.find((i) => i.relativePath === imported.relativePath);
      assert.equal(reused?.state, 'reused');
      assert.equal(reused?.originalRef?.objectId, object.id);
      assert.equal(reused?.originalRef?.revision, 1);
      assert.equal(
        ok(f.human.readObject({ objectId: object.id })).object.revision,
        corrected.object.revision,
      );
      assert.deepEqual(readFileSync(join(f.originals, 'knowledge', 'Retry policy.md')), original);

      const archived = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.setLifecycle(p),
          bound(s, {
            operationKey: 'native:archive',
            objectId: object.id,
            expectedRevision: corrected.object.revision,
            lifecycle: 'archived' as const,
          }),
        ),
      );
      const active = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.query(p),
          bound(s, { filter: {}, limit: 50, maxBytes: 65536 }),
        ),
      );
      assert.ok(!active.items.some((i) => i.ref.objectId === object.id));
      const archive = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.query(p),
          bound(s, { filter: { lifecycle: 'archived' as const }, limit: 50, maxBytes: 65536 }),
        ),
      );
      assert.ok(archive.items.some((i) => i.ref.objectId === object.id));
      ok(
        await n.page.evaluate(
          (p) => window.agentSpace.setLifecycle(p),
          bound(s, {
            operationKey: 'native:restore-object',
            objectId: object.id,
            expectedRevision: archived.object.revision,
            lifecycle: 'active' as const,
          }),
        ),
      );
      const grant = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.createGrant(p),
          bound(s, {
            operationKey: 'native:local:grant',
            spec: {
              label: 'Backup permission check',
              scope: { mode: 'space' as const },
              capabilities: { read: true, propose: false },
            },
          }),
        ),
      );
      const backupPath = join(f.root, 'Full history backup');
      await destination(n, backupPath);
      const backup = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.backupSpace(p),
          bound(s, { operationId: randomUUID() }),
        ),
      );
      assert.ok(backup);
      const b = await completed(n, backup.handle);
      assert.ok(b.receipt!.counts.retainedDrafts >= 1);
      const exportPath = join(f.root, 'Readable current export');
      await destination(n, exportPath);
      const exported = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.exportCurrent(p),
          bound(s, { operationId: randomUUID() }),
        ),
      );
      assert.ok(exported);
      const e = await completed(n, exported.handle);
      assert.equal(e.receipt!.counts.retainedDrafts, 0);
      assert.equal(e.receipt!.counts.receipts, 0);
      assert.equal(e.receipt!.counts.revisions, e.receipt!.counts.objects);
      assert.equal(e.receipt!.externalTargetBytesIncluded, false);
      await n.chooseNextFolder(backupPath);
      const reviewed = ok(await n.page.evaluate(() => window.agentSpace.chooseBackup()));
      assert.ok(reviewed);
      await destination(n, join(f.root, 'Restored local space'));
      const restored = ok(
        await n.page.evaluate((p) => window.agentSpace.restoreBackup(p), {
          handle: reviewed.handle,
          operationId: randomUUID(),
        }),
      );
      assert.ok(restored);
      await completed(n, restored.handle);
      assert.equal(
        ok(await n.bootstrap()).activeSpace?.bindingId,
        s.bindingId,
        'Restoring does not silently switch the active space',
      );
      const copy = ok(
        await n.page.evaluate((p) => window.agentSpace.openRestoredSpace(p), {
          handle: restored.handle,
        }),
      );
      assert.equal(copy.status.spaceId, s.status.spaceId);
      assert.notEqual(copy.status.instanceId, s.status.instanceId);
      assert.equal(
        ok(await n.page.evaluate((p) => window.agentSpace.listGrants(p), bound(copy, null))).find(
          (g) => g.id === grant.grant.id,
        )?.revoked,
        true,
      );
      const drafts = ok(
        await n.page.evaluate(
          (p) => window.agentSpace.listRecoverableDrafts(p),
          bound(copy, { limit: 10 }),
        ),
      );
      const foreign = drafts.items.find((d) => d.draftId === draftId);
      assert.ok(foreign);
      const forkId = randomUUID();
      ok(
        await n.page.evaluate(
          (p) => window.agentSpace.copyRecoverableDraft(p),
          bound(copy, {
            operationKey: 'native:foreign:fork',
            recoveryRef: foreign.recoveryRef,
            newDraftId: forkId,
          }),
        ),
      );
      assert.equal(
        ok(
          await n.page.evaluate(
            (p) => window.agentSpace.readDraft(p),
            bound(copy, { draftId: forkId }),
          ),
        ).content.body,
        'Not yet accepted · 中文🙂',
      );
      assert.equal(ok(f.human.readDraft({ draftId })).generation, 7);
      assert.equal(
        ok(f.human.listGrants()).find((g) => g.id === grant.grant.id)?.revoked,
        false,
        'Restoration never revokes the original grant',
      );
      const stale = await n.page.evaluate((p) => window.agentSpace.status(p), bound(s, null));
      assert.ok(!stale.ok && stale.error.code === 'SPACE_MISMATCH');
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      f.dispose();
    }
  },
);
