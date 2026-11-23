import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { AgentLaunchConfiguration } from '../../src/contracts/app.js';
import type { ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { supportedLocales, t, type Locale } from '../../src/renderer/i18n/index.js';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function eventually(check: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(50);
  }
  assert.fail(description);
}

test(
  'native writing, real agent setup, source return, acceptance and stale rejection are understandable',
  {
    skip: process.platform !== 'darwin',
    timeout: 90_000,
  },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Workbench profile'),
    });
    let client: Client | null = null;
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId('workbench').waitFor();
      const language = await native.page.locator('html').getAttribute('lang');
      assert.ok(supportedLocales.includes(language as Locale));
      const locale = language as Locale;
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const humanBody =
        '# Retry policy\n\nA human clarification before asking an agent.\n\n中文記録 · 日本語 · 한국어 · café.';
      await input.fill(humanBody);
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
            .content.body === humanBody,
        'The actual editor save must persist the visible human text.',
      );
      const humanVersion = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;

      await native.page.getByTestId('settings-button').click();
      const settings = native.page.getByTestId('settings-dialog');
      await settings.waitFor();
      await settings.getByTestId('grant-label').fill('Workbench acceptance agent');
      await settings.getByRole('radio', { name: t(locale, 'access.space'), exact: true }).check();
      await settings.getByTestId('grant-creation').check();
      await settings.getByTestId('create-grant').click();
      await settings.getByTestId('issued-configuration').waitFor();
      await settings
        .getByRole('button', { name: t(locale, 'access.copyJson'), exact: true })
        .click();
      await settings
        .getByTestId('issued-configuration')
        .getByText(t(locale, 'common.copied'), { exact: true })
        .waitFor();
      // Read only the synthetic configuration just written by this controlled click.
      const copied = await native.application.evaluate(({ clipboard }) => clipboard.readText());
      const launch = JSON.parse(copied) as Pick<
        AgentLaunchConfiguration,
        'command' | 'args' | 'env'
      >;
      assert.ok(launch.command && launch.args.includes('--agent-server'));
      await settings.getByRole('button', { name: t(locale, 'common.close'), exact: true }).click();

      client = new Client(
        { name: 'Workbench acceptance', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      await client.connect(
        new StdioClientTransport({
          command: launch.command,
          args: launch.args,
          env: {
            ...getDefaultEnvironment(),
            ...launch.env,
            AGENTSPACE_USER_DATA: join(fixture.root, 'Workbench agent profile'),
          },
          stderr: 'pipe',
        }),
      );
      const discovered = await client.callTool({ name: 'space_discover', arguments: {} });
      assert.equal(discovered.isError, false);
      const read = await client.callTool({
        name: 'object_read',
        arguments: {
          ref: { mode: 'pinned', objectId: humanVersion.id, revision: humanVersion.revision },
          section: 'body',
          maxBytes: 8_192,
        },
      });
      assert.equal(read.isError, false);
      const purpose = 'Clarify the retry decision';
      const reason = 'The cited measurements distinguish transient and persistent failures.';
      const agentBody =
        '# Retry policy\n\nRetry transient failures once. Investigate persistent failures instead of repeating the request.\n';
      const response = await client.callTool({
        name: 'proposal_create',
        arguments: {
          action: 'update',
          operationKey: 'workbench:proposal',
          targetId: humanVersion.id,
          baseRevision: humanVersion.revision,
          patch: { body: agentBody },
          purpose,
          reason,
          sources: [{ mode: 'pinned', objectId: fixture.ids.measurements, revision: 1 }],
        },
      });
      const proposal = requireSuccess(response.structuredContent as Result<ProposalReceipt>);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: humanVersion.id })).object.content.body,
        humanBody,
      );
      await native.focus();
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${proposal.id}`).click();
      const review = native.page.getByTestId('proposal-review');
      await review.getByText(reason, { exact: true }).waitFor();
      assert.equal(
        await review.getByTestId('proposal-agent-label').textContent(),
        'Workbench acceptance agent',
      );
      assert.ok((await review.innerText()).includes(purpose));
      assert.ok((await review.innerText()).includes('Retry transient failures once.'));
      const sourceId = `proposal-source-${proposal.id}-0`;
      await native.page.locator(`[id="${sourceId}"]`).click();
      const source = native.page.getByTestId('source-reader');
      await source
        .locator('header')
        .getByRole('heading', { name: 'Measurements', exact: true })
        .waitFor();
      await source
        .getByText(t(locale, 'source.version', { version: 1 }), { exact: true })
        .waitFor();
      await source.getByTestId('source-back').click();
      await native.page.waitForFunction((id) => document.activeElement?.id === id, sourceId);
      const screenshots = join(root, '.coordination/screenshots');
      mkdirSync(screenshots, { recursive: true });
      await native.page.screenshot({ path: join(screenshots, 'phase3-review.png') });
      await review.getByTestId('accept-proposal').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.getProposal({ proposalId: proposal.id })).proposal.status ===
          'applied',
        'A real review click must apply the candidate.',
      );
      assert.equal(
        await review.getByTestId('proposal-agent-label').textContent(),
        'Workbench acceptance agent',
      );
      await native.page.getByTestId('open-proposal-result').click();
      await input.waitFor();
      const accepted = requireSuccess(
        fixture.human.readObject({ objectId: humanVersion.id }),
      ).object;
      assert.equal(accepted.content.body, agentBody);
      const laterBody = '# Retry policy\n\nA later human correction must remain intact.\n';
      await input.fill(laterBody);
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: humanVersion.id })).object.content
            .body === laterBody,
        'The later human edit must persist.',
      );
      const later = requireSuccess(fixture.human.readObject({ objectId: humanVersion.id })).object;
      await native.page.locator('#history-button').click();
      await native.page.getByTestId(`preview-undo-r${accepted.revision}`).click();
      const undo = native.page.getByTestId('undo-preview');
      await undo.getByText(t(locale, 'history.laterChanges'), { exact: true }).waitFor();
      assert.equal(await undo.getByTestId('confirm-undo').isDisabled(), true);
      await undo
        .locator('header')
        .getByRole('button', { name: t(locale, 'common.close'), exact: true })
        .click();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: humanVersion.id })).object.revision,
        later.revision,
      );

      const staleResponse = await client.callTool({
        name: 'proposal_create',
        arguments: {
          action: 'update',
          operationKey: 'workbench:stale',
          targetId: humanVersion.id,
          baseRevision: accepted.revision,
          patch: { body: 'Old agent output must not replace the later human correction.' },
          purpose: 'An intentionally stale candidate',
          reason: 'Engineering validation of later-edit protection.',
          sources: [],
        },
      });
      const stale = requireSuccess(staleResponse.structuredContent as Result<ProposalReceipt>);
      assert.equal(stale.status, 'conflicted');
      const grant = requireSuccess(fixture.human.listGrants()).find(
        (item) => item.label === 'Workbench acceptance agent',
      )!;
      requireSuccess(
        fixture.human.updateGrant({
          operationKey: 'workbench:revoke',
          grantId: grant.id,
          expectedGeneration: grant.generation,
          spec: {
            label: grant.label,
            scope: grant.scope,
            capabilities: grant.capabilities,
            creation: grant.creation,
          },
          revoked: true,
        }),
      );
      await native.page.getByTestId('nav-review').click();
      await native.page.getByTestId(`proposal-row-${stale.id}`).click();
      await review
        .getByText(t(locale, 'proposal.originalChanged'), { exact: true })
        .first()
        .waitFor();
      assert.equal(await review.getByTestId('accept-proposal').isDisabled(), true);
      await review.getByTestId('reject-proposal').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.getProposal({ proposalId: stale.id })).proposal.status ===
          'rejected',
        'The person can reject after the originating grant is revoked.',
      );
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: humanVersion.id })).object.content.body,
        laterBody,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await client?.close().catch(() => undefined);
      await native.close();
      fixture.dispose();
    }
  },
);
