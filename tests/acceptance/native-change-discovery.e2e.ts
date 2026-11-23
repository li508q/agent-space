import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { supportedLocales, t, type Locale } from '../../src/renderer/i18n/index.js';
import { bound } from '../../src/renderer/state/binding.js';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.coordination/7B');
const sourcePin = (id: string) => ({ mode: 'pinned' as const, objectId: id, revision: 1 });
async function eventually(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (check()) return;
    await delay(40);
  }
  assert.fail(message);
}
async function open(native: NativeHarness, fixture: ReturnType<typeof createAcceptanceFixture>) {
  await native.focus();
  await native.chooseNextFolder(fixture.directory);
  await native.page.getByTestId('open-space').click();
  await native.page.getByTestId('workbench').waitFor();
}
function grant(fixture: ReturnType<typeof createAcceptanceFixture>) {
  const issued = requireSuccess(
    fixture.human.createGrant({
      operationKey: '7b:grant',
      spec: {
        label: 'Change discovery client',
        scope: { mode: 'space' },
        capabilities: { read: true, propose: true },
        creation: { enabled: true, kinds: ['document'] },
      },
    }),
  );
  const agent = requireSuccess(
    fixture.space.agent({
      grantId: issued.grant.id,
      token: issued.token!,
      instanceId: requireSuccess(fixture.human.status()).instanceId,
    }),
  );
  return { issued, agent };
}
async function snapshot(native: NativeHarness, name: string) {
  mkdirSync(evidence, { recursive: true });
  const capture = await native.application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const image = await window.capturePage();
    return {
      png: image.toPNG().toString('base64'),
      contentBounds: window.getContentBounds(),
      zoom: window.webContents.getZoomFactor(),
      size: image.getSize(),
    };
  });
  writeFileSync(join(evidence, name + '.png'), Buffer.from(capture.png, 'base64'));
  writeFileSync(
    join(evidence, name + '.geometry.json'),
    JSON.stringify(
      { contentBounds: capture.contentBounds, zoom: capture.zoom, size: capture.size },
      null,
      2,
    ),
  );
}
async function backSource(native: NativeHarness) {
  await native.page.getByTestId('source-reader').getByTestId('source-back').click();
}
async function selectProcessed(native: NativeHarness) {
  await native.page.getByTestId('nav-review').click();
  await native.page.getByTestId('review-processed').click();
}

test(
  '7B real SDK decisions, human saves, restart and fixed evidence remain discoverable without search',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const userData = join(fixture.root, 'Change discovery');
    let native = await launchNative({ entry: root, userData });
    let client: Client | null = null;
    try {
      await open(native, fixture);
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const humanBody = 'H1: a human saved this before the proposal.';
      await native.page.getByTestId('markdown-input').fill(humanBody);
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
            .content.body === humanBody,
        'Visible human save must persist.',
      );
      const h1 = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      const { issued } = grant(fixture);
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const launch = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.agentConfiguration(request),
          bound(session, { grantId: issued.grant.id, token: issued.token! }),
        ),
      );
      client = new Client(
        { name: '7B discovery', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      await client.connect(
        new StdioClientTransport({
          command: launch.command,
          args: launch.args,
          env: {
            ...getDefaultEnvironment(),
            ...launch.env,
            AGENTSPACE_USER_DATA: join(fixture.root, 'Agent profile'),
          },
          stderr: 'pipe',
        }),
      );
      assert.equal(
        (
          await client.callTool({
            name: 'object_read',
            arguments: {
              ref: sourcePin(fixture.ids.measurements),
              section: 'body',
              maxBytes: 8192,
            },
          })
        ).isError,
        false,
      );
      const reason = 'Original reason: K1 measurements support one retry.';
      const appliedBody = 'A2: accepted result, before the later human correction.';
      const result = await client.callTool({
        name: 'proposal_create',
        arguments: {
          action: 'update',
          operationKey: '7b:update',
          targetId: h1.id,
          baseRevision: h1.revision,
          patch: { body: appliedBody },
          purpose: 'Apply a supported clarification',
          reason,
          sources: [sourcePin(fixture.ids.measurements)],
        },
      });
      const candidate = requireSuccess(result.structuredContent as Result<ProposalReceipt>);
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${candidate.id}`).click();
      await native.page.getByTestId('accept-proposal').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.getProposal({ proposalId: candidate.id })).proposal
            .status === 'applied',
        'UI must apply the real SDK proposal.',
      );
      const accepted = requireSuccess(fixture.human.readObject({ objectId: h1.id })).object;
      await native.page.getByTestId('open-proposal-result').click();
      const laterBody = 'K3: later human correction must remain current.';
      await native.page.getByTestId('markdown-input').fill(laterBody);
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: h1.id })).object.content.body ===
          laterBody,
        'Later human save must persist.',
      );
      const source = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.measurements }),
      ).object;
      requireSuccess(
        fixture.human.saveObject({
          operationKey: '7b:sourceK2',
          targetId: source.id,
          expectedRevision: source.revision,
          content: { ...source.content, body: 'K2 source differs from the original evidence.' },
        }),
      );
      const newId = randomUUID();
      const rejected = requireSuccess(
        (
          await client.callTool({
            name: 'proposal_create',
            arguments: {
              action: 'create',
              operationKey: '7b:reject-create',
              newObject: {
                id: newId,
                kind: 'document',
                content: {
                  title: 'Never accepted',
                  body: 'A candidate only.',
                  properties: {},
                  relations: [],
                },
              },
              purpose: 'Keep this suggestion available',
              reason: 'Original candidate reason.',
              sources: [sourcePin(source.id)],
            },
          })
        ).structuredContent as Result<ProposalReceipt>,
      );
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${rejected.id}`).click();
      await native.page.getByTestId('reject-proposal').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.getProposal({ proposalId: rejected.id })).proposal.status ===
          'rejected',
        'UI must reject the candidate.',
      );
      assert.equal(fixture.human.readObject({ objectId: newId }).ok, false);
      const createdId = randomUUID();
      const created = requireSuccess(
        (
          await client.callTool({
            name: 'proposal_create',
            arguments: {
              action: 'create',
              operationKey: '7b:accept-create',
              newObject: {
                id: createdId,
                kind: 'document',
                content: {
                  title: 'Accepted new note',
                  body: 'Created once after review.',
                  properties: {},
                  relations: [],
                },
              },
              purpose: 'Retain a separate accepted result',
              reason: 'Source K1 remains pinned.',
              sources: [sourcePin(source.id)],
            },
          })
        ).structuredContent as Result<ProposalReceipt>,
      );
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${created.id}`).click();
      await native.page.getByTestId('accept-proposal').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.getProposal({ proposalId: created.id })).proposal.status ===
          'applied',
        'UI creates an accepted object.',
      );
      await client.close();
      client = null;
      await native.close();
      native = await launchNative({ entry: root, userData });
      await native.page.getByTestId('workbench').waitFor();
      await native.focus();
      await selectProcessed(native);
      await native.page.getByTestId(`proposal-row-${candidate.id}`).click();
      const review = native.page.getByTestId('proposal-review');
      await review.getByText(reason, { exact: true }).waitFor();
      assert.ok((await review.innerText()).includes(appliedBody));
      await native.page.getByTestId('open-proposal-saved-version').click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByText(appliedBody, { exact: true }).waitFor();
      await reader
        .locator('details > summary')
        .filter({
          hasText: t(
            (await native.page.locator('html').getAttribute('lang')) as Locale,
            'evidence.title',
          ),
        })
        .click();
      await reader
        .getByTestId(`accepted-evidence-r${accepted.revision}`)
        .getByText(reason, { exact: true })
        .waitFor();
      // The accepted result is read-only; current editing reads the later K3.
      await reader.getByTestId('source-edit-current').click();
      await native.page.getByTestId('markdown-input').waitFor();
      assert.equal(await native.page.getByTestId('markdown-input').textContent(), laterBody);
      await native.page.getByTestId('return-to-reading').click();
      await reader.getByText(appliedBody, { exact: true }).waitFor();
      await backSource(native);
      await native.page.waitForFunction(
        (id) => document.activeElement?.id === id,
        `proposal-result-${candidate.id}`,
      );
      // Exact cited source is read from the original proposal even after current K2.
      const sourceId = `proposal-source-${candidate.id}-0`;
      await native.page.locator(`[id="${sourceId}"]`).click();
      await reader
        .getByText('Transient failures recovered after one retry. Persistent failures did not.', {
          exact: false,
        })
        .waitFor();
      await backSource(native);
      await native.page.waitForFunction((id) => document.activeElement?.id === id, sourceId);
      assert.equal(await review.getByText(reason, { exact: true }).count(), 1);
      assert.equal(
        await native.page.getByTestId('review-processed').getAttribute('aria-pressed'),
        'true',
      );
      await selectProcessed(native);
      await native.page.getByTestId(`proposal-row-${rejected.id}`).click();
      await review.getByText('Original candidate reason.', { exact: true }).waitFor();
      assert.equal(await review.getByTestId('open-proposal-saved-version').count(), 0);
      assert.equal(await review.getByTestId('accept-proposal').count(), 0);
      await selectProcessed(native);
      await native.page.getByTestId(`proposal-row-${created.id}`).click();
      await native.page.getByTestId('open-proposal-saved-version').click();
      await reader.getByText('Created once after review.', { exact: true }).waitFor();
      await backSource(native);
      const changes = requireSuccess(fixture.human.changes({ limit: 50 })).items;
      const rejectEvent = changes.find(
        (c) => c.action === 'proposal.rejected' && c.proposalId === rejected.id,
      )!;
      const applyEvent = changes.find(
        (c) => c.action === 'proposal.applied' && c.proposalId === candidate.id,
      )!;
      await native.page.getByTestId('open-activity').click();
      const activity = native.page.getByTestId('activity-pane');
      await activity.getByTestId(`change-row-${h1.changeId}`).waitFor();
      await activity.locator(`[id="change-version-${h1.changeId}"]`).click();
      await reader.getByText(humanBody, { exact: true }).waitFor();
      await backSource(native);
      await activity.waitFor();
      await native.page.waitForFunction(
        (id) => document.activeElement?.id === id,
        `change-version-${h1.changeId}`,
      );
      assert.equal(await native.page.locator('dialog[open]').count(), 1);
      await activity.getByTestId(`change-proposal-${applyEvent.id}`).click();
      await review.getByText(reason, { exact: true }).waitFor();
      await native.page.getByTestId('return-activity').click();
      await activity.waitFor();
      await activity.getByTestId(`change-proposal-${rejectEvent.id}`).click();
      await review.getByText('Original candidate reason.', { exact: true }).waitFor();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: h1.id })).object.content.body,
        laterBody,
      );
      assert.deepEqual(
        requireSuccess(fixture.human.getProposal({ proposalId: candidate.id })).proposal.payload
          .sources,
        [sourcePin(source.id)],
      );
      assert.equal(fixture.human.readObject({ objectId: newId }).ok, false);
      await snapshot(native, 'processed-reopened');
      assert.deepEqual(native.pageErrors, []);
      writeFileSync(
        join(evidence, 'restart.json'),
        JSON.stringify(
          {
            fixture: 'synthetic',
            mode: 'source build',
            humanChange: h1.changeId,
            appliedChange: applyEvent.id,
            rejectedChange: rejectEvent.id,
            acceptedRevision: accepted.revision,
            currentRevision: requireSuccess(fixture.human.readObject({ objectId: h1.id })).object
              .revision,
            originalPinsRetained: true,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await recordFocus(native, 'case1-failure').catch(() => undefined);
      mkdirSync(focusEvidence, { recursive: true });
      const state = await native.page.evaluate(() => ({
        view: document.querySelector('[data-testid="workbench"]')?.getAttribute('data-compact'),
        listOpen: document
          .querySelector('[data-testid="workbench"]')
          ?.getAttribute('data-list-open'),
        rows: Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid^="proposal-row-"]'),
          (row) => ({ id: row.dataset.testid, visible: row.getClientRects().length > 0 }),
        ),
      }));
      writeFileSync(
        join(focusEvidence, 'case1-failure-state.json'),
        JSON.stringify(state, null, 2),
      );
      throw error;
    } finally {
      await client?.close().catch(() => undefined);
      await native.close();
      fixture.dispose();
    }
  },
);

type DiscoveryFault = {
  method: string | null;
  mode: 'fail' | 'hold';
  status: string | null;
  afterOnly: boolean;
  held: boolean;
  release: (() => void) | null;
  calls: number;
  failAfterRelease: boolean;
  statusSequence: number;
};
type FaultMain = typeof globalThis & { __discoveryFault: DiscoveryFault };
async function installFault(native: NativeHarness) {
  await native.application.evaluate(({ ipcMain }) => {
    const registry = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (
            event: unknown,
            request: { input?: { status?: string; afterId?: string } },
          ) => Promise<unknown>
        >;
      }
    )._invokeHandlers;
    if (!(registry instanceof Map)) throw new Error('Unsupported real IPC handler registry.');
    const state: DiscoveryFault = {
      method: null,
      mode: 'fail',
      status: null,
      afterOnly: false,
      held: false,
      release: null,
      calls: 0,
      failAfterRelease: false,
      statusSequence: -1,
    };
    (globalThis as FaultMain).__discoveryFault = state;
    for (const method of [
      'changes',
      'listProposals',
      'getProposal',
      'reviewProposal',
      'status',
      'saveObject',
      'saveDraft',
      'readObject',
    ]) {
      const name = 'agentspace:method:' + method,
        handler = registry.get(name);
      if (!handler) throw new Error('Missing actual handler.');
      ipcMain.removeHandler(name);
      ipcMain.handle(name, async (event, request) => {
        const match =
          state.method === method &&
          (!state.status || request?.input?.status === state.status) &&
          (!state.afterOnly || !!request?.input?.afterId);
        if (match && method === 'saveObject' && state.mode === 'fail')
          return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
        const result = await handler(event, request);
        if (method === 'status') {
          const status = result as Result<{ authoritySequence: number }>;
          if (status.ok) state.statusSequence = status.value.authoritySequence;
        }
        if (match) {
          state.calls++;
          state.method = null;
          if (state.mode === 'hold') {
            state.held = true;
            await new Promise<void>((resolve) => {
              state.release = resolve;
            });
            state.held = false;
            if (state.failAfterRelease) throw new Error('Synthetic held read failed.');
          } else throw new Error('Synthetic read reply lost after the real handler.');
        }
        return result;
      });
    }
  });
}
async function arm(
  native: NativeHarness,
  method: string,
  mode: 'fail' | 'hold' = 'fail',
  status: string | null = null,
  afterOnly = false,
) {
  await native.application.evaluate(
    (_, configuration) => {
      Object.assign((globalThis as FaultMain).__discoveryFault, configuration, {
        calls: 0,
        failAfterRelease: false,
        held: false,
        release: null,
      });
    },
    { method, mode, status, afterOnly },
  );
}
async function release(native: NativeHarness) {
  await native.application.evaluate(() => {
    const state = (globalThis as FaultMain).__discoveryFault;
    state.method = null;
    state.release?.();
    state.release = null;
  });
}

function bulkFixture() {
  const fixture = createAcceptanceFixture();
  const { agent } = grant(fixture);
  const applied: string[] = [],
    rejected: string[] = [];
  for (let index = 0; index < 53; index++) {
    const target = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
    ).object;
    const p = requireSuccess(
      agent.propose({
        operationKey: `7b:bulk:${index}`,
        action: 'update',
        targetId: target.id,
        baseRevision: target.revision,
        patch: { body: `Accepted change ${index}` },
        purpose: `Accepted proposal ${index}`,
        reason: 'Synthetic pagination evidence.',
        sources: [sourcePin(fixture.ids.measurements)],
      }),
    );
    requireSuccess(
      fixture.human.reviewProposal({
        operationKey: `7b:bulk-accept:${index}`,
        proposalId: p.id,
        expectedPayloadHash: p.payloadHash,
        expectedProposalVersion: p.statusVersion,
        decision: 'accept',
        expectedTarget: { state: 'revision', revision: target.revision },
      }),
    );
    applied.push(p.id);
  }
  for (let index = 0; index < 3; index++) {
    const target = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
    ).object;
    const p = requireSuccess(
      agent.propose({
        operationKey: `7b:bulk-reject:${index}`,
        action: 'update',
        targetId: target.id,
        baseRevision: target.revision,
        patch: { body: 'A rejected suggestion.' },
        purpose: `Rejected proposal ${index}`,
        reason: 'Original rejection candidate reason.',
        sources: [sourcePin(fixture.ids.measurements)],
      }),
    );
    requireSuccess(
      fixture.human.reviewProposal({
        operationKey: `7b:bulk-reject-decision:${index}`,
        proposalId: p.id,
        expectedPayloadHash: p.payloadHash,
        expectedProposalVersion: p.statusVersion,
        decision: 'reject',
      }),
    );
    rejected.push(p.id);
  }
  requireSuccess(
    agent.read({ ref: sourcePin(fixture.ids.measurements), section: 'body', maxBytes: 8192 }),
  );
  for (let index = 0; index < 55; index++) {
    const target = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.independent }),
    ).object;
    requireSuccess(
      fixture.human.saveObject({
        operationKey: `7b:after-prepared:${index}`,
        targetId: target.id,
        expectedRevision: target.revision,
        content: { ...target.content, body: `Human accumulation ${index}` },
      }),
    );
  }
  return { ...fixture, applied: applied.sort(), rejected: rejected.sort(), agent };
}

test(
  '7B numerical windows, processed append retries, sparse prepared and old replies use actual Core records',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const fixture = bulkFixture();
    const alternate = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Discovery boundaries'),
    });
    try {
      await open(native, fixture);
      await installFault(native);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page.getByTestId('open-activity').click();
      const activity = native.page.getByTestId('activity-pane');
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="change-row-"]').length === 50,
      );
      const sequences = await activity
        .locator('[data-sequence]')
        .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-sequence'))));
      const top = requireSuccess(fixture.human.status()).authoritySequence;
      assert.deepEqual(
        sequences,
        Array.from({ length: 50 }, (_, i) => top - i),
      );
      await activity.getByRole('button', { name: t(locale, 'common.close'), exact: true }).focus();
      await tabTo(native, 'activity-earlier', true);
      assert.equal(
        await native.page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
        'activity-earlier',
      );
      requireFocus(await recordFocus(native, 'activity-pagination-more-tab'), 'Activity More');
      await arm(native, 'changes');
      await native.page.keyboard.press('Enter');
      await activity
        .getByRole('button', { name: t(locale, 'common.retry'), exact: true })
        .waitFor();
      assert.equal(await activity.locator('[data-sequence]').count(), 50);
      await activity.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="change-row-"]').length === 100,
      );
      const older = await activity
        .locator('[data-sequence]')
        .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-sequence'))));
      assert.deepEqual(
        older,
        Array.from({ length: 100 }, (_, i) => top - i),
      );
      await activity.getByTestId('activity-prepared').click();
      await activity.getByText(t(locale, 'activity.emptyPrepared'), { exact: true }).waitFor();
      await activity.getByTestId('activity-earlier').click();
      await activity.locator('.delivered-reference').first().waitFor();
      await activity.getByTestId('activity-changes').click();
      assert.equal(await activity.locator('[data-sequence]').count(), 100);
      await arm(native, 'changes', 'hold');
      await activity.getByTestId('activity-refresh').click();
      await waitHeld(native);
      await activity.getByTestId('activity-prepared').click();
      await release(native);
      assert.equal(
        await activity.getByTestId('activity-prepared').getAttribute('aria-pressed'),
        'true',
      );
      await native.page.keyboard.press('Escape');
      await selectProcessed(native);
      const applied = native.page.getByTestId('proposal-group-applied'),
        rejected = native.page.getByTestId('proposal-group-rejected');
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="proposal-group-applied"] .material-row')
            .length === 50,
      );
      assert.equal(await rejected.locator('.material-row').count(), 3);
      await arm(native, 'listProposals', 'fail', 'applied', true);
      await applied.getByTestId('proposal-more-applied').click();
      await applied.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).waitFor();
      assert.equal(await applied.locator('.material-row').count(), 50);
      assert.equal(await rejected.locator('.material-row').count(), 3);
      await applied.getByRole('button', { name: t(locale, 'common.retry'), exact: true }).click();
      await native.page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="proposal-group-applied"] .material-row')
            .length === 53,
      );
      const ids = await applied
        .locator('.material-row')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-testid')!.slice('proposal-row-'.length)),
        );
      assert.deepEqual(ids, fixture.applied);
      await arm(native, 'listProposals', 'hold', 'applied');
      await native.page.getByTestId('review-refresh').click();
      await waitHeld(native);
      await native.page.getByTestId('review-unresolved').click();
      await release(native);
      await native.page
        .getByTestId('proposal-group-pending')
        .getByText(t(locale, 'review.emptyGroup'), { exact: true })
        .waitFor();
      assert.equal(await native.page.getByTestId('proposal-group-applied').count(), 0);
      await native.page.getByTestId('open-activity').click();
      await activity.getByTestId('activity-changes').click();
      await arm(native, 'changes', 'hold');
      await activity.getByTestId('activity-earlier').click();
      await waitHeld(native);
      await native.page.keyboard.press('Escape');
      await native.chooseNextFolder(alternate.directory);
      await native.page.getByTestId('space-menu').click();
      await native.page.getByTestId('open-space-menu').click();
      const alternateId = requireSuccess(alternate.human.status()).spaceId;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (requireSuccess(await native.bootstrap()).activeSpace?.status.spaceId === alternateId)
          break;
        await delay(20);
      }
      assert.equal(
        requireSuccess(await native.bootstrap()).activeSpace?.status.spaceId,
        alternateId,
      );
      await native.page.getByTestId('open-activity').click();
      const alternateChanges = requireSuccess(alternate.human.changes({ limit: 50 }))
        .items.map((c) => c.id)
        .sort();
      await native.page.waitForFunction(
        (count) => document.querySelectorAll('[data-testid^="change-row-"]').length === count,
        alternateChanges.length,
      );
      assert.deepEqual(
        (
          await native.page
            .locator('[data-testid^="change-row-"]')
            .evaluateAll((rows) =>
              rows.map((row) => row.getAttribute('data-testid')!.slice('change-row-'.length)),
            )
        ).sort(),
        alternateChanges,
        'No held old-space event may enter the new binding.',
      );
      await native.page.keyboard.press('Escape');
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('space-menu').click();
      await native.page.getByTestId('open-space-menu').click();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          requireSuccess(await native.bootstrap()).activeSpace?.status.spaceId ===
          requireSuccess(fixture.human.status()).spaceId
        )
          break;
        await delay(20);
      }
      await native.page.getByTestId('open-activity').click();
      await native.page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="change-row-"]').length === 50,
      );
      await release(native);
      await native.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      assert.deepEqual(
        await native.page
          .locator('[data-sequence]')
          .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-sequence')))),
        Array.from({ length: 50 }, (_, i) => top - i),
        'Fresh A must not inherit the held append from its previous binding.',
      );
      await snapshot(native, 'bounded-groups');
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => undefined);
      await native.close();
      fixture.dispose();
      alternate.dispose();
    }
  },
);

async function waitHeld(native: NativeHarness) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await native.application.evaluate(() => (globalThis as FaultMain).__discoveryFault.held))
      return;
    await delay(20);
  }
  assert.fail('The old real IPC result must be held before continuing.');
}

test(
  '7B an old pending detail released after a real decision cannot revive actions or replace the accepted head',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const { agent } = grant(fixture);
    const native = await launchNative({ entry: root, userData: join(fixture.root, 'Old detail') });
    try {
      await open(native, fixture);
      await installFault(native);
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      for (const decision of ['accept', 'reject'] as const) {
        const target = requireSuccess(
          fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
        ).object;
        const body = `New accepted head for ${decision}`;
        const p = requireSuccess(
          agent.propose({
            operationKey: `7b:old-detail:${decision}`,
            action: 'update',
            targetId: target.id,
            baseRevision: target.revision,
            patch: { body },
            purpose: `Race ${decision}`,
            reason: 'Keep the original declaration.',
            sources: [sourcePin(fixture.ids.measurements)],
          }),
        );
        await native.page.getByTestId('nav-review').click();
        await native.page.getByTestId(`proposal-row-${p.id}`).click();
        await native.page.getByTestId('accept-proposal').waitFor();
        await arm(native, 'getProposal', 'hold');
        if (decision === 'reject')
          await native.application.evaluate(() => {
            (globalThis as FaultMain).__discoveryFault.failAfterRelease = true;
          });
        const other = requireSuccess(
          fixture.human.readObject({ objectId: fixture.ids.independent }),
        ).object;
        requireSuccess(
          fixture.human.saveObject({
            operationKey: `7b:trigger-detail:${decision}`,
            targetId: other.id,
            expectedRevision: other.revision,
            content: { ...other.content, body: `Trigger refresh ${decision}` },
          }),
        );
        await waitHeld(native);
        await native.page.getByTestId(`${decision}-proposal`).click();
        await eventually(
          () =>
            requireSuccess(fixture.human.getProposal({ proposalId: p.id })).proposal.status ===
            (decision === 'accept' ? 'applied' : 'rejected'),
          'The real review must settle before releasing the old read.',
        );
        await release(native);
        await native.page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const review = native.page.getByTestId('proposal-review');
        assert.equal(
          await review.getByText(t(locale, 'error.OPERATION_UNKNOWN'), { exact: true }).count(),
          0,
          'The failed old read cannot overwrite a newer decision notice.',
        );
        assert.equal(
          await review.getByTestId('accept-proposal').count(),
          0,
          'An old pending reply must not revive decision controls.',
        );
        assert.equal(
          await review.locator('.status-tag').innerText(),
          t(locale, decision === 'accept' ? 'proposal.applied' : 'proposal.rejected'),
        );
        if (decision === 'accept') {
          assert.ok(
            (await review.locator('.current-content').textContent())?.includes(body),
            'The old pending current snapshot must not replace the accepted head.',
          );
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: target.id })).object.content.body,
            body,
          );
        }
      }
      const receiptTarget = requireSuccess(
        fixture.human.createObject({
          operationKey: '7b:receipt-target',
          id: randomUUID(),
          kind: 'document',
          content: { title: 'Receipt target', body: 'K1 original.', properties: {}, relations: [] },
        }),
      ).object;
      const receiptCandidate = requireSuccess(
        agent.propose({
          operationKey: '7b:receipt-proposal',
          action: 'update',
          targetId: receiptTarget.id,
          baseRevision: 1,
          patch: { body: 'K2 accepted receipt.' },
          purpose: 'Keep the accepted version distinct',
          reason: 'Original receipt declaration.',
          sources: [sourcePin(fixture.ids.measurements)],
        }),
      );
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${receiptCandidate.id}`).click();
      await native.page.getByTestId('accept-proposal').waitFor();
      await arm(native, 'reviewProposal', 'hold');
      await native.page.getByTestId('accept-proposal').click();
      await waitHeld(native);
      const k2 = requireSuccess(fixture.human.readObject({ objectId: receiptTarget.id })).object;
      assert.equal(k2.revision, 2);
      requireSuccess(
        fixture.human.saveObject({
          operationKey: '7b:receipt-humanK3',
          targetId: k2.id,
          expectedRevision: k2.revision,
          content: { ...k2.content, body: 'K3 newer human head, observed before receipt.' },
        }),
      );
      const receiptReview = native.page.getByTestId('proposal-review');
      await receiptReview
        .locator('.current-content')
        .getByText('K3 newer human head, observed before receipt.', { exact: true })
        .waitFor();
      await release(native);
      await native.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      assert.ok(
        (await receiptReview.locator('.current-content').textContent())?.includes(
          'K3 newer human head, observed before receipt.',
        ),
      );
      assert.equal(
        await receiptReview.getByTestId('open-proposal-saved-version').innerText(),
        t(locale, 'review.savedResult', { version: 2 }),
      );
      await receiptReview.getByTestId('open-proposal-saved-version').click();
      await native.page
        .getByTestId('source-reader')
        .getByText('K2 accepted receipt.', { exact: true })
        .waitFor();
      await backSource(native);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: k2.id })).object.revision,
        3,
      );
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: k2.id })).object.content.body,
        'K3 newer human head, observed before receipt.',
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => undefined);
      await native.close();
      fixture.dispose();
    }
  },
);

async function visibleControl(native: NativeHarness, id: string) {
  const button = native.page.getByTestId(id);
  await button.scrollIntoViewIfNeeded();
  const geometry = await button.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  assert.ok(
    geometry.width > 0 &&
      geometry.height > 0 &&
      geometry.left >= -1 &&
      geometry.top >= -1 &&
      geometry.right <= geometry.viewport.width + 1 &&
      geometry.bottom <= geometry.viewport.height + 1,
    `${id}: ${JSON.stringify(geometry)}`,
  );
  await button.focus();
  return geometry;
}

test(
  '7B five locales keep activity and processed controls keyboard reachable at 980px and native 200% zoom',
  { skip: process.platform !== 'darwin', timeout: 120_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const { agent } = grant(fixture);
    const p = requireSuccess(
      agent.propose({
        operationKey: '7b:locale-proposal',
        action: 'update',
        targetId: fixture.ids.retryPolicy,
        baseRevision: 1,
        patch: { body: 'Accepted multilingual result.' },
        purpose: 'Inspect a durable result · 中文 日本語 한국어 café',
        reason: 'Original multilingual reason.',
        sources: [sourcePin(fixture.ids.measurements)],
      }),
    );
    requireSuccess(
      fixture.human.reviewProposal({
        operationKey: '7b:locale-accept',
        proposalId: p.id,
        expectedProposalVersion: p.statusVersion,
        expectedPayloadHash: p.payloadHash,
        decision: 'accept',
        expectedTarget: { state: 'revision', revision: 1 },
      }),
    );
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Discovery locales'),
    });
    const results = [];
    try {
      await open(native, fixture);
      await installFault(native);
      const combinations: (readonly [Locale, 1 | 2, 980 | 1024])[] = [
        ['en', 2, 1024],
        ...supportedLocales.flatMap((locale) =>
          [1, 2].map((scale) => [locale, scale, 980] as readonly [Locale, 1 | 2, 980 | 1024]),
        ),
      ];
      for (const [locale, scale, width] of combinations) {
        await native.setWindowBounds({ width, height: width === 1024 ? 688 : 850 });
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption(String(scale));
        await native.page.waitForFunction(
          ({ locale, scale }) =>
            document.documentElement.lang === locale &&
            document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
              String(scale),
          { locale, scale },
        );
        await native.page.keyboard.press('Escape');
        assert.equal(
          await native.application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
          ),
          scale,
        );
        await native.page.getByTestId('open-activity').click();
        const activity = native.page.getByTestId('activity-pane');
        const controls = [];
        controls.push(await visibleControl(native, 'activity-changes'));
        assert.equal(
          await native.page.getByTestId('activity-changes').innerText(),
          t(locale, 'activity.changes'),
        );
        controls.push(await visibleControl(native, 'activity-prepared'));
        await native.page.keyboard.press('Enter');
        controls.push(await visibleControl(native, 'activity-changes'));
        await native.page.keyboard.press('Enter');
        await arm(native, 'changes');
        controls.push(await visibleControl(native, 'activity-refresh'));
        await native.page.keyboard.press('Enter');
        const retry = activity.getByRole('button', {
          name: t(locale, 'common.retry'),
          exact: true,
        });
        await retry.waitFor();
        await native.page.keyboard.press('Tab');
        assert.ok(await retry.evaluate((element) => element === document.activeElement));
        const prefix = `activity-${locale}-${width}-${scale}x`;
        const retryGeometry = await recordFocus(native, `${prefix}-retry-tab`);
        requireFocus(retryGeometry, `${prefix} Retry`);
        await native.page.keyboard.press('Enter');
        await activity
          .getByTestId(
            `change-row-${requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object.changeId}`,
          )
          .waitFor();
        const versionId = `change-version-${requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object.changeId}`;
        await native.page.getByTestId('activity-refresh').focus();
        await tabTo(native, versionId);
        const source = await recordFocus(native, `${prefix}-source-tab`);
        requireFocus(source, `${prefix} source`);
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('source-reader')
          .getByText('Accepted multilingual result.', { exact: true })
          .waitFor();
        await tabTo(native, 'source-back', true);
        requireFocus(await focusGeometry(native), `${prefix} Reader back`);
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction((id) => document.activeElement?.id === id, versionId);
        const returned = await recordFocus(native, `${prefix}-source-return`);
        requireFocus(returned, `${prefix} returned source`);
        assert.ok(Math.abs(returned.rect.top - source.rect.top) <= 1);
        assert.ok(
          Math.abs(
            returned.scrollAncestors.find((item) => item.classes === 'modal')!.scrollTop -
              source.scrollAncestors.find((item) => item.classes === 'modal')!.scrollTop,
          ) <= 1,
        );
        await snapshot(native, prefix);
        await native.page.keyboard.press('Escape');
        await selectProcessed(native);
        controls.push(await visibleControl(native, 'review-unresolved'));
        controls.push(await visibleControl(native, 'review-processed'));
        await native.page.getByTestId(`proposal-row-${p.id}`).click();
        controls.push(await visibleControl(native, 'open-proposal-saved-version'));
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('source-reader')
          .getByText('Accepted multilingual result.', { exact: true })
          .waitFor();
        await visibleControl(native, 'source-back');
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction(
          (id) => document.activeElement?.id === id,
          `proposal-result-${p.id}`,
        );
        const overflow = await native.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 1);
        await snapshot(native, `processed-${locale}-${width}-${scale}x`);
        results.push({
          locale,
          scale,
          width,
          controls,
          retryGeometry,
          source,
          returned,
          overflow,
          keyboardResultAndReturn: true,
        });
      }
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        join(evidence, 'locales.json'),
        JSON.stringify({ fixture: 'synthetic', mode: 'source build', results }, null, 2),
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);

test(
  '7B activity reading and current editing return to the same retained human draft after a save failure',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Discovery draft'),
    });
    try {
      await open(native, fixture);
      await installFault(native);
      const original = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.independent }),
      ).object;
      const fixed = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      await native.page.getByTestId(`object-row-${original.id}`).click();
      await arm(native, 'saveObject');
      const draft = 'An unsaved human draft survives activity, current editing and return.';
      await native.page.getByTestId('markdown-input').fill(draft);
      await native.page.getByTestId('save-now').click();
      await native.page.getByTestId('open-activity').click();
      const activity = native.page.getByTestId('activity-pane');
      await activity.locator(`[id="change-version-${fixed.changeId}"]`).click();
      const reader = native.page.getByTestId('source-reader');
      await reader.getByTestId('source-edit-current').click();
      await native.page.waitForFunction(
        (body) =>
          Array.from(
            document.querySelectorAll('[data-testid="markdown-input"] .cm-line'),
            (line) => line.textContent,
          ).join('\n') === body,
        fixed.content.body,
      );
      assert.equal(
        (
          await native.page.getByTestId('markdown-input').locator('.cm-line').allTextContents()
        ).join('\n'),
        fixed.content.body,
      );
      await native.page.getByTestId('return-to-reading').click();
      await reader.waitFor();
      await backSource(native);
      await activity.waitFor();
      await native.page.waitForFunction(
        (id) => document.activeElement?.id === id,
        `change-version-${fixed.changeId}`,
      );
      assert.equal(await native.page.locator('dialog[open]').count(), 1);
      await native.page.keyboard.press('Escape');
      assert.equal(await native.page.getByTestId('markdown-input').textContent(), draft);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: original.id })).object.content.body,
        original.content.body,
      );
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixed.id })).object.content.body,
        fixed.content.body,
      );
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const drafts = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.listDrafts(request),
          bound(session, { limit: 50 }),
        ),
      );
      assert.ok(
        drafts.items.length > 0,
        'The original human draft remains in the real persistent draft store.',
      );
      await snapshot(native, 'draft-return');
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await release(native).catch(() => undefined);
      await native.close();
      fixture.dispose();
    }
  },
);

const focusEvidence = join(root, '.coordination/7B-modal-focus');
async function focusGeometry(native: NativeHarness) {
  return native.page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const r = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const scrollAncestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      const borderTop = parseFloat(style.borderTopWidth) || 0,
        borderRight = parseFloat(style.borderRightWidth) || 0,
        borderBottom = parseFloat(style.borderBottomWidth) || 0,
        borderLeft = parseFloat(style.borderLeftWidth) || 0;
      const horizontalScrollbar =
        style.overflowX === 'scroll' ||
        (style.overflowX === 'auto' && parent.scrollWidth > parent.clientWidth)
          ? Math.max(0, parent.offsetHeight - parent.clientHeight - borderTop - borderBottom)
          : 0;
      const verticalScrollbar =
        style.overflowY === 'scroll' ||
        (style.overflowY === 'auto' && parent.scrollHeight > parent.clientHeight)
          ? Math.max(0, parent.offsetWidth - parent.clientWidth - borderLeft - borderRight)
          : 0;
      const clientBounds = {
        left: box.left + borderLeft,
        top: box.top + borderTop,
        right: box.right - borderRight - verticalScrollbar,
        bottom: box.bottom - borderBottom - horizontalScrollbar,
      };
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        scrollAncestors.push({
          classes: parent.className,
          rect: box.toJSON(),
          clientHeight: parent.clientHeight,
          clientBounds,
          borders: { top: borderTop, right: borderRight, bottom: borderBottom, left: borderLeft },
          scrollbars: { horizontal: horizontalScrollbar, vertical: verticalScrollbar },
          legacyIntegerClientBottom: box.top + parent.clientTop + parent.clientHeight,
          scrollHeight: parent.scrollHeight,
          scrollTop: parent.scrollTop,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          scrollPaddingTop: style.scrollPaddingTop,
          scrollPaddingBottom: style.scrollPaddingBottom,
          scrollBehavior: style.scrollBehavior,
        });
        clip.top = Math.max(clip.top, clientBounds.top);
        clip.bottom = Math.min(clip.bottom, clientBounds.bottom);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, clientBounds.left);
        clip.right = Math.min(clip.right, clientBounds.right);
      }
    }
    const style = getComputedStyle(element),
      outset = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const outlineBounds = {
      left: r.left - outset,
      top: r.top - outset,
      right: r.right + outset,
      bottom: r.bottom + outset,
    };
    const componentFullyVisible =
      r.left >= clip.left - 0.5 &&
      r.top >= clip.top - 0.5 &&
      r.right <= clip.right + 0.5 &&
      r.bottom <= clip.bottom + 0.5;
    const outlineFullyVisible =
      outlineBounds.left >= clip.left - 0.5 &&
      outlineBounds.top >= clip.top - 0.5 &&
      outlineBounds.right <= clip.right + 0.5 &&
      outlineBounds.bottom <= clip.bottom + 0.5;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const scroll = document.querySelector<HTMLElement>('.review-scroll');
    const scrollStyle = scroll && getComputedStyle(scroll);
    const listHeader = document.querySelector<HTMLElement>('.material-list > header');
    const listHeaderStyle = listHeader && getComputedStyle(listHeader);
    return {
      id: element.id,
      testId: element.dataset.testid,
      text: element.innerText,
      rect: r.toJSON(),
      clip,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scrollAncestors,
      listHeader: listHeader
        ? {
            rect: listHeader.getBoundingClientRect().toJSON(),
            paddingTop: listHeaderStyle!.paddingTop,
            paddingBottom: listHeaderStyle!.paddingBottom,
            boxSizing: listHeaderStyle!.boxSizing,
          }
        : null,
      focusVisible: element.matches(':focus-visible'),
      outline: style.outline,
      outlineOffset: style.outlineOffset,
      outlineBounds,
      componentFullyVisible,
      outlineFullyVisible,
      outset,
      centerClear: !!hit && (element === hit || element.contains(hit)),
      hit: hit?.className,
      fullVisible: componentFullyVisible && outlineFullyVisible,
      scroll: scroll
        ? {
            rect: scroll.getBoundingClientRect().toJSON(),
            tag: scroll.tagName,
            classes: scroll.className,
            clientHeight: scroll.clientHeight,
            scrollHeight: scroll.scrollHeight,
            scrollTop: scroll.scrollTop,
            paddingTop: scrollStyle!.paddingTop,
            paddingBottom: scrollStyle!.paddingBottom,
            minHeight: scrollStyle!.minHeight,
            flex: scrollStyle!.flex,
          }
        : null,
      header:
        document.querySelector('.review-pane > header')?.getBoundingClientRect().toJSON() ?? null,
      footer: document.querySelector('.review-actions')?.getBoundingClientRect().toJSON() ?? null,
      review: document.querySelector('.review-pane')?.getBoundingClientRect().toJSON() ?? null,
    };
  });
}
async function recordFocus(native: NativeHarness, name: string) {
  await native.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const geometry = await focusGeometry(native);
  mkdirSync(focusEvidence, { recursive: true });
  writeFileSync(join(focusEvidence, name + '.json'), JSON.stringify(geometry, null, 2));
  if (!geometry.fullVisible || !geometry.centerClear) {
    await delay(250);
    writeFileSync(
      join(focusEvidence, name + '.settled.json'),
      JSON.stringify(await focusGeometry(native), null, 2),
    );
  }
  const capture = await native.application.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!,
      image = await w.capturePage();
    return {
      png: image.toPNG().toString('base64'),
      bounds: w.getBounds(),
      content: w.getContentBounds(),
      zoom: w.webContents.getZoomFactor(),
    };
  });
  writeFileSync(join(focusEvidence, name + '.png'), Buffer.from(capture.png, 'base64'));
  writeFileSync(
    join(focusEvidence, name + '.window.json'),
    JSON.stringify(
      { bounds: capture.bounds, content: capture.content, zoom: capture.zoom },
      null,
      2,
    ),
  );
  return geometry;
}
function requireFocus(geometry: Awaited<ReturnType<typeof focusGeometry>>, label: string) {
  assert.ok(geometry.focusVisible, `${label}: real keyboard focus must show its outline`);
  assert.ok(
    geometry.fullVisible && geometry.centerClear,
    `${label}: complete focus/outline must be visible and center must hit the control: ${JSON.stringify(geometry)}`,
  );
}
async function tabTo(native: NativeHarness, testId: string, reverse = false) {
  for (let step = 0; step < 70; step++) {
    await native.page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    if (
      await native.page.evaluate(
        (id) =>
          document.activeElement?.id === id ||
          document.activeElement?.getAttribute('data-testid') === id ||
          document.activeElement?.textContent?.trim() === id,
        testId,
      )
    )
      return;
  }
  assert.fail(`Real keyboard traversal did not reach ${testId}`);
}

test(
  '7B real Tab preserves complete list outlines and original-source focus across locales and viewports',
  { skip: process.platform !== 'darwin', timeout: 180_000 },
  async () => {
    const fixture = bulkFixture(),
      { agent } = fixture;
    const focusTarget = requireSuccess(
      fixture.human.createObject({
        operationKey: 'outline:target',
        id: randomUUID(),
        kind: 'document',
        content: {
          title: 'Focus knowledge',
          body: 'K1 original focus target.',
          properties: {},
          relations: [],
        },
      }),
    ).object;
    const reason =
      'Long original reason: preserve the cited measurements while inspecting a processed result. '.repeat(
        35,
      );
    const wrappedSource = requireSuccess(
      fixture.human.createObject({
        operationKey: 'focus:wrapped-source',
        id: randomUUID(),
        kind: 'document',
        content: {
          title:
            'Original pinned evidence with a deliberately long wrapped source label: measurements, continuation notes, and verification details · 中文来源资料 · 日本語の参照資料 · 한국어 원본 기록 · café — retained independently of the current head.',
          body: 'K1 wrapped source must remain exact.',
          properties: {},
          relations: [],
        },
      }),
    ).object;
    const applied = requireSuccess(
      agent.propose({
        operationKey: 'focus:applied',
        action: 'update',
        targetId: focusTarget.id,
        baseRevision: 1,
        patch: { body: 'Accepted A2, distinct from current edits.' },
        purpose: 'Inspect original evidence after reopening',
        reason,
        sources: [sourcePin(fixture.ids.measurements), sourcePin(wrappedSource.id)],
      }),
    );
    requireSuccess(
      fixture.human.reviewProposal({
        operationKey: 'focus:apply',
        proposalId: applied.id,
        expectedPayloadHash: applied.payloadHash,
        expectedProposalVersion: applied.statusVersion,
        decision: 'accept',
        expectedTarget: { state: 'revision', revision: 1 },
      }),
    );
    const originalSource = requireSuccess(
      fixture.human.readObject({ objectId: fixture.ids.measurements }),
    ).object;
    requireSuccess(
      fixture.human.saveObject({
        operationKey: 'focus:sourceK2',
        targetId: originalSource.id,
        expectedRevision: 1,
        content: { ...originalSource.content, body: 'Current K2 must not replace cited K1.' },
      }),
    );
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'F01 keyboard'),
    });
    const results = [];
    try {
      await open(native, fixture);
      await installFault(native);
      const combinations: (readonly [Locale, 1 | 2, 980 | 1380])[] = [
        ['en', 1, 1380],
        ['en', 2, 1380],
        ...supportedLocales.flatMap((locale) =>
          [1, 2].map((scale) => [locale, scale, 980] as readonly [Locale, 1 | 2, 980 | 1380]),
        ),
      ];
      for (const [locale, scale, width] of combinations) {
        await native.setWindowBounds({ width, height: 841 });
        await native.page.getByTestId('settings-button').click();
        await native.page.getByTestId('locale-select').selectOption(locale);
        await native.page.getByTestId('text-scale-select').selectOption(String(scale));
        await native.page.waitForFunction(
          ({ locale, scale }) =>
            document.documentElement.lang === locale &&
            document.querySelector('[data-testid="desktop-app"]')?.getAttribute('data-scale') ===
              String(scale),
          { locale, scale },
        );
        await native.page.keyboard.press('Escape');
        const readySequence = requireSuccess(fixture.human.status()).authoritySequence;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            (await native.application.evaluate(
              () => (globalThis as FaultMain).__discoveryFault.statusSequence,
            )) >= readySequence
          )
            break;
          await delay(20);
        }
        assert.ok(
          (await native.application.evaluate(
            () => (globalThis as FaultMain).__discoveryFault.statusSequence,
          )) >= readySequence,
          'The real UI authority poll must observe the previous decision before this independent keyboard flow.',
        );
        await native.page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await selectProcessed(native);
        await native.page.waitForFunction(
          () =>
            document.querySelectorAll('[data-testid="proposal-group-applied"] .material-row')
              .length === 50,
        );
        const prefix = `${locale}-${width}-${scale}x`;
        // Only establish the reported starting point; targets are reached by actual Tab.
        await native.page.getByTestId('review-processed').focus();
        await native.page.keyboard.press('Tab');
        assert.equal(
          await native.page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
          'review-refresh',
        );
        requireFocus(await recordFocus(native, `${prefix}-refresh-tab`), `${prefix} refresh`);
        await native.page.keyboard.press('Shift+Tab');
        requireFocus(
          await recordFocus(native, `${prefix}-processed-tab`),
          `${prefix} processed collection`,
        );
        await native.page.keyboard.press('Shift+Tab');
        requireFocus(await focusGeometry(native), `${prefix} pending collection`);
        await native.page.keyboard.press('Tab');
        await native.page.keyboard.press('Tab');
        await native.page.keyboard.press('Tab');
        const firstRowId = await native.page.evaluate(() =>
          document.activeElement?.getAttribute('data-testid'),
        );
        assert.ok(firstRowId?.startsWith('proposal-row-'));
        requireFocus(
          await recordFocus(native, `${prefix}-ordinary-row-tab`),
          `${prefix} ordinary row`,
        );
        await native.page.keyboard.press('Enter');
        await native.page.getByTestId('proposal-review').waitFor();
        await native.page.getByTestId('nav-review').click();
        await native.page.getByTestId('review-processed').focus();
        await native.page.keyboard.press('Tab');
        await native.page.keyboard.press('Tab');
        assert.equal(
          await native.page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
          firstRowId,
        );
        assert.ok(
          (await native.page.getByTestId(firstRowId!).getAttribute('class'))?.includes('selected'),
        );
        requireFocus(
          await recordFocus(native, `${prefix}-selected-row-tab`),
          `${prefix} selected row`,
        );
        await arm(native, 'listProposals', 'fail', 'applied', true);
        await tabTo(native, 'proposal-more-applied');
        requireFocus(await recordFocus(native, `${prefix}-more-tab`), `${prefix} more`);
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('proposal-group-applied')
          .getByRole('button', { name: t(locale, 'common.retry'), exact: true })
          .waitFor();
        // Loading may disable the More trigger; start this independent retry path at the same collection anchor.
        await native.page.getByTestId('review-processed').focus();
        await tabTo(native, t(locale, 'common.retry'));
        requireFocus(await recordFocus(native, `${prefix}-retry-tab`), `${prefix} retry`);
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction(
          () =>
            document.querySelectorAll('[data-testid="proposal-group-applied"] .material-row')
              .length > 50,
        );
        await native.page.getByTestId(`proposal-row-${applied.id}`).click();
        const review = native.page.getByTestId('proposal-review');
        await review.getByText(reason, { exact: true }).waitFor();
        // Set only the specified starting point; no locator scrolling or pointer rescue after Tab.
        await review.getByTestId('open-proposal-result').focus();
        await native.page.keyboard.press('Tab');
        const sourceId = `proposal-source-${applied.id}-0`;
        assert.equal(await native.page.evaluate(() => document.activeElement?.id), sourceId);
        const geometry = await recordFocus(
          native,
          `${locale}-${width}-${scale}x-applied-source-first-tab`,
        );
        requireFocus(geometry, `${locale}/${scale} applied source`);
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('source-reader')
          .getByText('Transient failures recovered after one retry. Persistent failures did not.', {
            exact: false,
          })
          .waitFor();
        await tabTo(native, 'source-back', true);
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction((id) => document.activeElement?.id === id, sourceId);
        const returned = await focusGeometry(native);
        requireFocus(returned, `${locale}/${scale} returned source`);
        assert.ok(
          geometry.scroll && returned.scroll && geometry.scroll.scrollTop > 100,
          'The tested checkpoint must have actually scrolled through the long reason.',
        );
        assert.ok(
          Math.abs(returned.scroll.scrollTop - geometry.scroll.scrollTop) <= 1,
          'Reader return restores the actual review scrollport.',
        );
        assert.ok(
          Math.abs(returned.rect.top - geometry.rect.top) <= 1,
          'Source returns to its previous visual position.',
        );
        await native.page.keyboard.press('Tab');
        const wrappedId = `proposal-source-${applied.id}-1`;
        assert.equal(await native.page.evaluate(() => document.activeElement?.id), wrappedId);
        requireFocus(
          await recordFocus(native, `${locale}-${width}-${scale}x-wrapped-source-tab`),
          `${locale}/${scale} wrapped source`,
        );
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('source-reader')
          .getByText('K1 wrapped source must remain exact.', { exact: true })
          .waitFor();
        await tabTo(native, 'source-back', true);
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction((id) => document.activeElement?.id === id, wrappedId);
        requireFocus(await focusGeometry(native), `${locale}/${scale} returned wrapped source`);
        await native.page.keyboard.press('Shift+Tab');
        assert.equal(await native.page.evaluate(() => document.activeElement?.id), sourceId);
        await native.page.keyboard.press('Shift+Tab');
        assert.equal(
          await native.page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
          'open-proposal-result',
        );
        requireFocus(await focusGeometry(native), `${locale}/${scale} header current`);
        await native.page.keyboard.press('Shift+Tab');
        assert.equal(
          await native.page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
          'open-proposal-saved-version',
        );
        requireFocus(await focusGeometry(native), `${locale}/${scale} fixed result`);
        await native.page.keyboard.press('Enter');
        await native.page
          .getByTestId('source-reader')
          .getByText('Accepted A2, distinct from current edits.', { exact: true })
          .waitFor();
        await tabTo(native, 'source-back', true);
        await native.page.keyboard.press('Enter');
        await native.page.waitForFunction(
          (id) => document.activeElement?.id === id,
          `proposal-result-${applied.id}`,
        );
        requireFocus(await focusGeometry(native), `${locale}/${scale} returned fixed result`);
        await tabTo(native, t(locale, 'proposal.copyProposed'));
        requireFocus(
          await recordFocus(native, `${locale}-${width}-${scale}x-processed-footer-tab`),
          `${locale}/${scale} processed footer`,
        );
        const target = requireSuccess(
          fixture.human.readObject({ objectId: focusTarget.id }),
        ).object;
        const pending = requireSuccess(
          agent.propose({
            operationKey: `focus:pending:${locale}:${width}:${scale}`,
            action: 'update',
            targetId: target.id,
            baseRevision: target.revision,
            patch: { body: `Keyboard decision ${locale}/${scale}.` },
            purpose: 'Review the same fixed evidence',
            reason,
            sources: [sourcePin(originalSource.id), sourcePin(wrappedSource.id)],
          }),
        );
        await native.page.getByTestId('nav-review').click();
        await native.page.getByTestId('review-unresolved').click();
        await native.page.getByTestId(`proposal-row-${pending.id}`).click();
        await review.getByText(reason, { exact: true }).waitFor();
        await review.locator('#proposal-heading').focus();
        await native.page.keyboard.press('Tab');
        assert.equal(
          await native.page.evaluate(() => document.activeElement?.id),
          `proposal-source-${pending.id}-0`,
        );
        requireFocus(
          await recordFocus(native, `${locale}-${width}-${scale}x-pending-source-tab`),
          `${locale}/${scale} pending source`,
        );
        await tabTo(native, 'reject-proposal');
        requireFocus(await focusGeometry(native), `${locale}/${scale} reject`);
        await tabTo(native, 'accept-proposal');
        requireFocus(
          await recordFocus(native, `${locale}-${width}-${scale}x-accept-tab`),
          `${locale}/${scale} accept`,
        );
        const decision = scale === 1 ? 'accept' : 'reject';
        if (decision === 'reject') {
          await tabTo(native, 'reject-proposal', true);
          requireFocus(await focusGeometry(native), `${locale}/${scale} reject return`);
        }
        await native.page.keyboard.press('Enter');
        await eventually(
          () =>
            requireSuccess(fixture.human.getProposal({ proposalId: pending.id })).proposal
              .status === (decision === 'accept' ? 'applied' : 'rejected'),
          'Keyboard decision must persist.',
        );
        results.push({
          locale,
          scale,
          width,
          source: geometry,
          returnedSource: returned,
          decision,
        });
      }
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: originalSource.id, revision: 1 }))
          .object.content.body,
        originalSource.content.body,
      );
      assert.deepEqual(native.pageErrors, []);
      writeFileSync(
        join(focusEvidence, 'keyboard-matrix.json'),
        JSON.stringify({ fixture: 'synthetic', results }, null, 2),
      );
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);
