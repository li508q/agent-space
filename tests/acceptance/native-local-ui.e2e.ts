import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Space } from '../../src/core/index.js';
import type { ImportRunPage } from '../../src/contracts/local.js';
import { t, type Locale } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess as ok } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { installClipboardFixture } from './clipboard-fixture.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const faultEntry = fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url));
type Faults = {
  __agentSpaceTestFault: {
    arm(method: string): void;
    snapshot(): { lost: number; calls: string[] };
  };
};
async function eventually(check: () => boolean, message: string) {
  for (let i = 0; i < 120; i++) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

test(
  'visible folder import keeps human input, recovers one unknown confirmation and explains source reuse',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const f = createAcceptanceFixture();
    const n = await launchNative({
      entry: root,
      userData: join(f.root, 'Import interface profile'),
      mainRequire: faultEntry,
    });
    try {
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1380, height: 900 }),
      );
      const locale = (await n.page.locator('html').getAttribute('lang')) as Locale;
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId(`object-row-${f.ids.retryPolicy}`).click();
      const input = n.page.locator('.cm-content[contenteditable=true]');
      await input.fill('A human edit immediately before importing.');
      const openImporter = async () => {
        const menu = n.page.getByTestId('space-menu');
        if (!(await menu.evaluate((element) => element.parentElement?.hasAttribute('open'))))
          await menu.click();
        await n.page.getByTestId('open-imports').click();
        await n.chooseNextFolder(f.originals);
        await n.page.getByTestId('choose-import-folder').click();
        const dialog = n.page.getByTestId('import-dialog');
        await dialog.getByTestId('confirm-import').waitFor();
        await dialog.getByTestId('import-reuse-notice').scrollIntoViewIfNeeded();
        assert.equal(await dialog.getByTestId('import-reuse-notice').isVisible(), true);
        return dialog;
      };
      const originalHandoff = readFileSync(join(f.originals, 'projects', 'Compass', 'HANDOFF.md'));
      let dialog = await openImporter();
      const repository = dialog
        .locator('.import-entry')
        .filter({ has: n.page.getByRole('heading', { name: /repos\/retry-kit$/ }) });
      await repository.getByTestId('import-item-action').selectOption('external-reference');
      await n.application.evaluate(() =>
        (globalThis as unknown as Faults).__agentSpaceTestFault.arm('confirmImport'),
      );
      await dialog.getByTestId('confirm-import').click();
      await dialog.getByText(t(locale, 'error.OPERATION_UNKNOWN'), { exact: true }).waitFor();
      assert.equal(ok(f.human.listImports({ limit: 20 })).items.length, 1);
      await dialog.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await dialog
        .getByTestId('import-run')
        .getByText(t(locale, 'importRun.finished'), { exact: true })
        .waitFor();
      const lost = await n.application.evaluate(() =>
        (globalThis as unknown as Faults).__agentSpaceTestFault.snapshot(),
      );
      assert.equal(lost.lost, 1);
      assert.equal(lost.calls.length, 2);
      assert.equal(lost.calls[0], lost.calls[1]);
      const firstRun = ok(f.human.listImports({ limit: 20 })).items[0]!;
      assert.equal(ok(f.human.listImports({ limit: 20 })).items.length, 1);
      const first: ImportRunPage = ok(
        f.human.getImport({ runId: firstRun.id, limit: 50, maxBytes: 65536 }),
      );
      assert.equal(first.run.failed, 0);
      const handoff = first.items.find((i) => i.relativePath.endsWith('/HANDOFF.md'));
      assert.ok(handoff?.originalRef);
      const note = ok(f.human.readObject({ objectId: handoff.originalRef.objectId })).object;
      assert.equal(note.content.body, originalHandoff.toString('utf8'));
      assert.equal(note.knowledgeReview, null);
      const membership = note.content.relations.filter((r) => r.predicate === 'belongs_to');
      assert.equal(membership.length, 1);
      const revised = ok(
        f.human.saveObject({
          operationKey: 'import-ui:human-revision',
          targetId: note.id,
          expectedRevision: note.revision,
          content: { ...note.content, body: 'Human correction after import must remain.' },
        }),
      );
      await eventually(
        () =>
          ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object.content.body ===
          'A human edit immediately before importing.',
        'Opening the importer must preserve the previous editor input.',
      );
      assert.deepEqual(
        readFileSync(join(f.originals, 'projects', 'Compass', 'HANDOFF.md')),
        originalHandoff,
      );
      await n.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      dialog = await openImporter();
      const handoffEntry = dialog
        .locator('.import-entry')
        .filter({ has: n.page.getByRole('heading', { name: /projects\/Compass\/HANDOFF\.md$/ }) });
      await handoffEntry
        .getByTestId('import-item-project')
        .selectOption(`existing:${f.ids.fieldNotes}`);
      await dialog.getByTestId('confirm-import').click();
      const run = dialog.getByTestId('import-run');
      await run.getByText(t(locale, 'importRun.finished'), { exact: true }).waitFor();
      const reusedRow = run.locator('.import-result').filter({ hasText: handoff.relativePath });
      await reusedRow.getByText(t(locale, 'import.reusedNotice'), { exact: true }).waitFor();
      assert.equal(ok(f.human.listImports({ limit: 20 })).items.length, 2);
      const current = ok(f.human.readObject({ objectId: note.id })).object;
      assert.equal(current.revision, revised.object.revision);
      assert.equal(current.content.body, revised.object.content.body);
      assert.deepEqual(
        current.content.relations.filter((r) => r.predicate === 'belongs_to'),
        membership,
      );
      await reusedRow.getByRole('button').click();
      const source = n.page.getByTestId('source-reader');
      await source
        .getByText(t(locale, 'source.version', { version: 1 }), { exact: true })
        .waitFor();
      await source.getByText('Next: compare the measured retry rates.', { exact: true }).waitFor();
      assert.ok(!(await source.innerText()).includes('Human correction after import must remain.'));
      await source.getByTestId('source-back').click();

      dialog = await openImporter();
      writeFileSync(
        join(f.originals, 'projects', 'Compass', 'HANDOFF.md'),
        'A later source change after preview.',
      );
      await dialog.getByTestId('confirm-import').click();
      await dialog.getByText(t(locale, 'error.IMPORT_SOURCE_CHANGED'), { exact: true }).waitFor();
      assert.equal(ok(f.human.listImports({ limit: 20 })).items.length, 2);
      assert.equal(
        ok(f.human.readObject({ objectId: note.id })).object.content.body,
        revised.object.content.body,
      );
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      f.dispose();
    }
  },
);

test(
  'visible history keeps accepted reasons and old evidence pins, while copied context stays one exact saved object',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const f = createAcceptanceFixture();
    const grant = ok(
      f.human.createGrant({
        operationKey: 'history-ui:grant',
        spec: {
          label: 'Evidence assistant',
          scope: { mode: 'space' },
          capabilities: { read: true, propose: true },
        },
      }),
    );
    assert.ok(grant.token);
    const status = ok(f.human.status());
    const agent = ok(
      f.space.agent({ grantId: grant.grant.id, token: grant.token, instanceId: status.instanceId }),
    );
    const reason = 'The original measurement supports a single retry for transient failures.';
    const body = 'Accepted conclusion supported by the original measurement.';
    const proposal = ok(
      agent.propose({
        operationKey: 'history-ui:proposal',
        action: 'update',
        targetId: f.ids.retryPolicy,
        baseRevision: 1,
        patch: { body },
        purpose: 'Keep the decision understandable',
        reason,
        sources: [{ mode: 'pinned', objectId: f.ids.measurements, revision: 1 }],
      }),
    );
    ok(
      f.human.reviewProposal({
        operationKey: 'history-ui:accept',
        proposalId: proposal.id,
        expectedProposalVersion: proposal.statusVersion,
        expectedPayloadHash: proposal.payloadHash,
        decision: 'accept',
        expectedTarget: { state: 'revision', revision: 1 },
      }),
    );
    const source = ok(f.human.readObject({ objectId: f.ids.measurements })).object;
    ok(
      f.human.saveObject({
        operationKey: 'history-ui:new-source',
        targetId: source.id,
        expectedRevision: 1,
        content: {
          ...source.content,
          body: 'A later source version is not the original evidence.',
        },
      }),
    );
    ok(
      f.human.updateGrant({
        operationKey: 'history-ui:revoke',
        grantId: grant.grant.id,
        expectedGeneration: grant.grant.generation,
        spec: {
          label: grant.grant.label,
          scope: grant.grant.scope,
          capabilities: grant.grant.capabilities,
          creation: grant.grant.creation,
        },
        revoked: true,
      }),
    );
    const n = await launchNative({
      entry: root,
      userData: join(f.root, 'History interface profile'),
    });
    try {
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1380, height: 900 }),
      );
      const locale = (await n.page.locator('html').getAttribute('lang')) as Locale;
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId(`object-row-${f.ids.retryPolicy}`).click();
      await n.page.locator('#history-button').click();
      const history = n.page.getByTestId('history-pane');
      await history.getByTestId('version-evidence-r2').click();
      const accepted = history.getByTestId('accepted-evidence-r2');
      await accepted.getByText(reason, { exact: true }).waitFor();
      const evidence = accepted.locator('button[id^="evidence-"]').first();
      const returnId = await evidence.getAttribute('id');
      await evidence.click();
      const reader = n.page.getByTestId('source-reader');
      await reader
        .getByText(t(locale, 'source.version', { version: 1 }), { exact: true })
        .waitFor();
      await reader
        .getByText('Transient failures recovered after one retry. Persistent failures did not.', {
          exact: true,
        })
        .waitFor();
      assert.ok(
        !(await reader.innerText()).includes(
          'A later source version is not the original evidence.',
        ),
      );
      await reader.getByTestId('source-back').click();
      await n.page.waitForFunction((id) => document.activeElement?.id === id, returnId);
      await history.getByTestId('version-evidence-r1').click();
      await history
        .getByTestId('accepted-evidence-r1')
        .getByText(t(locale, 'evidence.noAgentDeclaration'), { exact: true })
        .waitFor();
      assert.equal(await history.getByRole('alert').count(), 0);
      const clipboard = await installClipboardFixture(n, 'local-ui-saved-context');
      try {
        await n.page.getByTestId('copy-saved-context-details').locator('summary').click();
        await n.page.getByTestId('copy-saved-context').click();
        const note = JSON.parse(await clipboard.readText());
        assert.equal(note.scope, 'one-saved-object');
        assert.equal(note.object.id, f.ids.retryPolicy);
        assert.equal(note.object.revision, 2);
        assert.equal(note.object.body, body);
        assert.ok(
          note.object.relations.some(
            (r: {
              predicate: string;
              target: { mode: string; objectId: string; revision: number };
            }) =>
              r.predicate === 'source' &&
              r.target.mode === 'pinned' &&
              r.target.objectId === f.ids.measurements &&
              r.target.revision === 1,
          ),
        );
        await n.page.getByTestId('nav-library').click();
        await n.page.getByTestId(`object-row-${f.ids.sample}`).click();
        await n.page.getByTestId('record-fields').waitFor();
        await n.page.getByTestId('copy-saved-context-details').locator('summary').click();
        await n.page.getByTestId('copy-saved-context').click();
        const record = JSON.parse(await clipboard.readText());
        assert.equal(record.object.id, f.ids.sample);
        assert.equal(record.object.kind, 'record');
        assert.equal(record.object.properties.attempts.value, 0);
        assert.equal(record.object.properties.error_rate.value, null);
        assert.equal(record.object.properties.observation.value, '');
        assert.equal(record.object.properties.checked.value, false);
        assert.equal(record.object.properties.observation.label, '観察 / 관찰');
      } finally {
        await clipboard.restore();
      }
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      f.dispose();
    }
  },
);

test(
  'visible asset relink and project lifecycle preserve identities, shared material and readable incoming links',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const f = createAcceptanceFixture();
    const n = await launchNative({
      entry: root,
      userData: join(f.root, 'Lifecycle interface profile'),
    });
    try {
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1380, height: 900 }),
      );
      const locale = (await n.page.locator('html').getAttribute('lang')) as Locale;
      await n.page.getByTestId('nav-library').click();
      await n.page.getByTestId(`object-row-${f.ids.repository}`).click();
      const uses = n.page.getByTestId('asset-material');
      await uses.getByText('Compass', { exact: true }).waitFor();
      await uses.getByText('Field notes', { exact: true }).waitFor();
      await uses.getByText('Retry policy', { exact: true }).waitFor();
      await n.page.locator('#details-button').click();
      await n.page.getByTestId('relink-asset').click();
      const action = n.page.getByTestId('object-actions');
      await action.getByText(t(locale, 'relink.noUndo'), { exact: true }).waitFor();
      const moved = join(f.root, 'Chosen new repository location');
      mkdirSync(moved);
      const original = ok(f.human.readObject({ objectId: f.ids.repository })).object;
      await n.chooseNextFolder(moved);
      await action.getByTestId('choose-relink').click();
      await action.getByText(moved, { exact: true }).waitFor();
      await action.getByTestId('confirm-object-action').click();
      await action.waitFor({ state: 'hidden' });
      const linked = ok(f.human.readObject({ objectId: f.ids.repository })).object;
      assert.equal(linked.id, original.id);
      assert.equal(linked.revision, original.revision + 1);
      assert.equal(linked.origin.mode, 'external-reference');
      if (linked.origin.mode !== 'external-reference') assert.fail('Expected external origin');
      assert.equal(linked.origin.locator, moved);
      assert.deepEqual(linked.content, original.content);
      await n.page.getByTestId(`object-row-${f.ids.compass}`).click();
      if (!(await n.page.getByTestId('set-lifecycle').isVisible()))
        await n.page.locator('#details-button').click();
      await n.page.getByTestId('set-lifecycle').click();
      await action.getByTestId('confirm-object-action').click();
      await action.waitFor({ state: 'hidden' });
      assert.equal(
        ok(f.human.readObject({ objectId: f.ids.compass })).object.lifecycle,
        'archived',
      );
      await n.page
        .getByTestId('document-pane')
        .getByRole('heading', { name: 'Compass', exact: true })
        .waitFor();
      assert.equal(await n.page.getByTestId('document-title').count(), 0);
      assert.equal(await n.page.locator('.cm-content[contenteditable=true]').count(), 0);
      assert.equal(
        ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object.lifecycle,
        'active',
      );
      assert.equal(
        ok(f.human.readObject({ objectId: f.ids.repository })).object.lifecycle,
        'active',
      );
      assert.equal(
        ok(f.human.readObject({ objectId: f.ids.repository })).object.revision,
        linked.revision,
      );
      await n.page.getByTestId('lifecycle-filter').selectOption('archived');
      await n.page.getByTestId(`object-row-${f.ids.compass}`).waitFor();
      await n.page.locator('#details-button').click();
      await n.page.getByTestId('set-lifecycle').click();
      await action.getByTestId('confirm-object-action').click();
      await action.waitFor({ state: 'hidden' });
      assert.equal(ok(f.human.readObject({ objectId: f.ids.compass })).object.lifecycle, 'active');
      await n.page.getByTestId('project-edit').click();
      await n.page.locator('.cm-content[contenteditable=true]').waitFor();
      assert.equal(
        ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object.content.relations.filter(
          (r) => r.predicate === 'belongs_to',
        ).length,
        2,
      );
      assert.deepEqual(n.pageErrors, []);
    } finally {
      await n.close();
      f.dispose();
    }
  },
);

test(
  'visible backup recovery uses the original operation, opens a new instance explicitly and keeps a foreign draft distinct from accepted content',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const f = createAcceptanceFixture();
    const draftId = randomUUID();
    const draftBody = 'An unsaved human thought from another installation.';
    ok(
      f.human.saveDraft({
        operationKey: 'ui-recovery:original',
        draftId,
        generation: 7,
        target: { state: 'existing', objectId: f.ids.retryPolicy, baseRevision: 1 },
        source: {
          kind: 'revision',
          ref: { mode: 'pinned', objectId: f.ids.retryPolicy, revision: 1 },
        },
        content: {
          title: 'Retained human thought',
          body: draftBody,
          properties: {},
          relations: [],
        },
      }),
    );
    const previous = ok(f.human.readObject({ objectId: f.ids.retryPolicy })).object;
    const acceptedBody = 'A later accepted human revision must remain.';
    const accepted = ok(
      f.human.saveObject({
        operationKey: 'ui-recovery:later',
        targetId: previous.id,
        expectedRevision: previous.revision,
        content: { ...previous.content, body: acceptedBody },
      }),
    );
    const grant = ok(
      f.human.createGrant({
        operationKey: 'ui-recovery:grant',
        spec: {
          label: 'Original-space client',
          scope: { mode: 'space' },
          capabilities: { read: true, propose: false },
        },
      }),
    );
    const n = await launchNative({
      entry: root,
      userData: join(f.root, 'Recovery interface profile'),
      mainRequire: faultEntry,
    });
    let copy: Space | null = null;
    try {
      await n.focus();
      await n.chooseNextFolder(f.directory);
      await n.page.getByTestId('open-space').click();
      await n.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1380, height: 900 }),
      );
      const locale = (await n.page.locator('html').getAttribute('lang')) as Locale;
      const originalSession = ok(await n.bootstrap()).activeSpace!;
      const chooseDestination = async (path: string) => {
        await n.application.evaluate(({ dialog }, chosen) => {
          const original = dialog.showSaveDialog;
          dialog.showSaveDialog = async () => {
            dialog.showSaveDialog = original;
            return { canceled: false, filePath: chosen };
          };
        }, path);
      };
      const menu = n.page.getByTestId('space-menu');
      if (!(await menu.evaluate((element) => element.parentElement?.hasAttribute('open'))))
        await menu.click();
      await n.page.getByTestId('open-data-transfer').click();
      const dialog = n.page.getByTestId('data-transfer-dialog');
      const backupPath = join(f.root, 'UI complete backup');
      await chooseDestination(backupPath);
      await n.application.evaluate(() =>
        (globalThis as unknown as Faults).__agentSpaceTestFault.arm('backupSpace'),
      );
      await dialog.getByTestId('start-backup').click();
      const backupRow = dialog.locator('.transfer-row').filter({
        has: n.page.getByRole('heading', { name: t(locale, 'backup.create'), exact: true }),
      });
      await backupRow.getByText(t(locale, 'transfer.unknown'), { exact: true }).waitFor();
      await backupRow.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await backupRow.getByText(t(locale, 'transfer.verified'), { exact: true }).waitFor();
      const lost = await n.application.evaluate(() =>
        (globalThis as unknown as Faults).__agentSpaceTestFault.snapshot(),
      );
      assert.equal(lost.lost, 1);
      assert.equal(lost.calls.length, 2);
      assert.equal(lost.calls[0], lost.calls[1]);
      const backupManifest = JSON.parse(readFileSync(join(backupPath, 'backup.json'), 'utf8'));
      assert.equal(backupManifest.complete, true);
      assert.ok(backupManifest.counts.retainedDrafts >= 1);
      assert.equal(backupManifest.externalTargetBytesIncluded, false);
      const exportPath = join(f.root, 'UI readable export');
      await chooseDestination(exportPath);
      await dialog.getByTestId('start-export').click();
      const exportRow = dialog.locator('.transfer-row').filter({
        has: n.page.getByRole('heading', { name: t(locale, 'export.current'), exact: true }),
      });
      await exportRow.getByText(t(locale, 'transfer.verified'), { exact: true }).waitFor();
      const exportManifest = JSON.parse(readFileSync(join(exportPath, 'manifest.json'), 'utf8'));
      assert.equal(exportManifest.includesHistory, false);
      assert.equal(exportManifest.counts.retainedDrafts, 0);
      assert.equal(exportManifest.counts.revisions, exportManifest.counts.objects);
      await n.chooseNextFolder(backupPath);
      await dialog.getByTestId('choose-backup').click();
      await dialog.getByTestId('confirm-restore').waitFor();
      const restoredPath = join(f.root, 'UI restored space');
      await chooseDestination(restoredPath);
      await dialog.getByTestId('confirm-restore').click();
      const restoreRow = dialog.locator('.transfer-row').filter({
        has: n.page.getByRole('heading', { name: t(locale, 'restore.title'), exact: true }),
      });
      await restoreRow.getByText(t(locale, 'transfer.verified'), { exact: true }).waitFor();
      assert.equal(ok(await n.bootstrap()).activeSpace?.bindingId, originalSession.bindingId);
      await restoreRow.getByTestId('open-restored-space').click();
      await dialog.waitFor({ state: 'hidden' });
      const restoredSession = ok(await n.bootstrap()).activeSpace!;
      assert.notEqual(restoredSession.status.instanceId, originalSession.status.instanceId);
      copy = ok(Space.open(restoredPath));
      const observer = copy.human('independent-ui-observer');
      assert.equal(ok(observer.listGrants()).find((g) => g.id === grant.grant.id)?.revoked, true);
      assert.equal(ok(f.human.listGrants()).find((g) => g.id === grant.grant.id)?.revoked, false);

      // Capture only this controlled copy in private Main memory; do not replace
      // the person's system clipboard to exercise a recovery affordance.
      const clipboard = await installClipboardFixture(n, 'local-ui-recovery');
      try {
        await n.page.getByTestId('nav-continue').click();
        await n.page.getByTestId('open-recoverable-drafts').click();
        const recovery = n.page.getByTestId('recovery-dialog');
        await recovery.locator('.recovery-list button').first().click();
        await recovery
          .getByRole('heading', { name: 'Retained human thought', exact: true })
          .waitFor();
        await recovery.getByTestId('copy-recovery-text').click();
        assert.equal(await clipboard.readText(), `Retained human thought\n\n${draftBody}`);
        await recovery.getByTestId('retain-recovered-draft').click();
        await recovery.getByTestId('resume-recovered-draft').click();
        await recovery.waitFor({ state: 'hidden' });
        const editor = n.page.locator('.cm-content[contenteditable=true]');
        await editor.getByText(draftBody, { exact: true }).waitFor();
        await n.page
          .getByRole('status')
          .filter({ hasText: t(locale, 'editor.conflict') })
          .waitFor();
        assert.equal(await n.page.getByTestId('copy-saved-context').isDisabled(), true);
        assert.equal(
          ok(observer.readObject({ objectId: f.ids.retryPolicy })).object.content.body,
          acceptedBody,
        );
        assert.equal(
          ok(observer.readObject({ objectId: f.ids.retryPolicy })).object.revision,
          accepted.object.revision,
        );
        assert.equal(
          ok(copy.human('acceptance-installation').readDraft({ draftId })).generation,
          7,
        );
        assert.equal(ok(f.human.readDraft({ draftId })).generation, 7);
      } finally {
        await clipboard.restore();
      }
      assert.deepEqual(n.pageErrors, []);
    } finally {
      copy?.close();
      await n.close();
      f.dispose();
    }
  },
);
