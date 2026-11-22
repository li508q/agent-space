import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { SpaceSession } from '../../src/contracts/app.js';
import type { BoundRequest } from '../../src/contracts/desktop.js';
import type { ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative, type NativeHarness } from './native-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
function request<T>(space: SpaceSession, input: T): BoundRequest<T> {
  return {
    bindingId: space.bindingId,
    spaceId: space.status.spaceId,
    instanceId: space.status.instanceId,
    input,
  };
}

// This exercises the actual native preload/main/core and generated agent launch.
// It deliberately does not claim that API calls prove editor or review-button UX.
test(
  'native bridge, built-in MCP runtime, fresh bindings and reopen share one real space',
  {
    skip: process.platform !== 'darwin',
    timeout: 90_000,
  },
  async () => {
    assert.ok(
      existsSync(join(root, 'dist/desktop/main.cjs')),
      'Build the desktop before native acceptance.',
    );
    assert.ok(
      existsSync(join(root, 'dist/renderer/index.html')),
      'Build the actual renderer before native acceptance.',
    );
    const fixture = createAcceptanceFixture();
    const userData = join(fixture.root, 'Native application profile');
    let native: NativeHarness | null = null;
    let client: Client | null = null;
    try {
      native = await launchNative({ entry: root, userData });
      const first = requireSuccess(await native.bootstrap());
      assert.equal(first.activeSpace, null);
      assert.equal(first.startupError, null);
      const boundary = await native.page.evaluate(() => ({
        node: typeof process,
        require: typeof require,
        buffer: typeof Buffer,
        methods: Object.keys(window.agentSpace),
        url: location.href,
      }));
      assert.equal(boundary.node, 'undefined');
      assert.equal(boundary.require, 'undefined');
      assert.equal(boundary.buffer, 'undefined');
      assert.equal(new URL(boundary.url).protocol, 'agentspace:');
      assert.equal(new URL(boundary.url).hostname, 'app');
      for (const forbidden of [
        'invoke',
        'send',
        'fs',
        'db',
        'readFile',
        'process',
        'ipcRenderer',
      ]) {
        assert.ok(!boundary.methods.includes(forbidden));
      }
      const sandboxed = await native.application.evaluate(({ app, BrowserWindow }) => {
        const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
        return app.getAppMetrics().find((entry) => entry.pid === pid)?.sandboxed;
      });
      assert.equal(sandboxed, true);

      await native.chooseNextFolder(fixture.directory);
      const selected = requireSuccess(
        await native.page.evaluate(() => window.agentSpace.openSpace()),
      );
      assert.ok(selected);
      assert.equal(selected.status.spaceId, requireSuccess(fixture.human.status()).spaceId);
      const targetId = randomUUID();
      const create = request(selected, {
        operationKey: 'native:create',
        id: targetId,
        kind: 'document' as const,
        content: {
          title: 'Native shared note',
          body: 'Human text · 中文 · 日本語 · 한국어 · café.',
          properties: {},
          relations: [],
        },
        generation: 17,
      });
      const created = requireSuccess(
        await native.page.evaluate((input) => window.agentSpace.createObject(input), create),
      );
      assert.equal(created.generation, 17);
      assert.equal(created.object.revision, 1);
      const model = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.describe(input),
          request(selected, { maxBytes: 16384 }),
        ),
      );
      assert.equal(model.propertyModel, 'per-object');
      const found = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.search(input),
          request(selected, { filter: { text: 'Native shared' }, limit: 10, maxBytes: 8192 }),
        ),
      );
      assert.ok(found.items.some((item) => item.ref.objectId === targetId));
      const links = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.expandRelations(input),
          request(selected, {
            seedId: fixture.ids.compass,
            direction: 'outgoing' as const,
            predicates: ['uses' as const, 'continues_from' as const],
            maxDepth: 1 as const,
            maxNodes: 10,
            maxEdges: 10,
            maxBytes: 16384,
          }),
        ),
      );
      assert.ok(
        links.edges.some((edge) => edge.resolvedTarget.objectId === fixture.ids.repository),
      );
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: targetId })).object.content.body,
        create.input.content.body,
      );
      const invalidBinding = await native.page.evaluate(
        (input) => window.agentSpace.status(input),
        { ...request(selected, null), bindingId: randomUUID() },
      );
      assert.ok(!invalidBinding.ok);
      assert.equal(invalidBinding.error.code, 'SPACE_MISMATCH');

      const grant = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.createGrant(input),
          request(selected, {
            operationKey: 'native:grant',
            spec: {
              label: 'Native acceptance agent',
              scope: { mode: 'space' as const },
              capabilities: { read: true, propose: true },
              creation: { enabled: true, kinds: ['document' as const] },
            },
          }),
        ),
      );
      assert.ok(grant.token);
      const launch = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.agentConfiguration(input),
          request(selected, { grantId: grant.grant.id, token: grant.token }),
        ),
      );
      assert.ok(launch.command.length > 0 && launch.args.includes('--agent-server'));
      assert.ok(launch.codexToml.includes('[mcp_servers.agent_space]'));
      assert.deepEqual(JSON.parse(launch.stdioJson), {
        command: launch.command,
        args: launch.args,
        env: launch.env,
      });
      const beforeConnect = requireSuccess(fixture.human.status());
      client = new Client(
        { name: 'Native acceptance client', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: {
          ...getDefaultEnvironment(),
          ...launch.env,
          AGENTSPACE_USER_DATA: join(fixture.root, 'Agent application profile'),
        },
        stderr: 'pipe',
      });
      await client.connect(transport);
      assert.equal(
        requireSuccess(fixture.human.status()).activitySequence,
        beforeConnect.activitySequence,
      );
      const discovered = await client.callTool({ name: 'space_discover', arguments: {} });
      assert.equal(discovered.isError, false);
      const list = await client.listTools();
      assert.ok(list.tools.some((item) => item.name === 'proposal_create'));
      assert.equal(list.tools.length, 10);
      assert.ok(!list.tools.some((item) => item.name === 'reviewProposal'));
      const proposedId = randomUUID();
      const response = await client.callTool({
        name: 'proposal_create',
        arguments: {
          action: 'create',
          operationKey: 'native:agent-note',
          purpose: 'Keep shared project knowledge',
          reason: 'Synthetic measurements support a separate note.',
          sources: [{ mode: 'pinned', objectId: fixture.ids.measurements, revision: 1 }],
          newObject: {
            id: proposedId,
            kind: 'document',
            content: {
              title: 'An agent suggestion',
              body: 'A candidate until the person decides.',
              properties: {},
              relations: [],
            },
          },
        },
      });
      assert.equal(response.isError, false);
      const candidate = requireSuccess(response.structuredContent as Result<ProposalReceipt>);
      const pending = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.listProposals(input),
          request(selected, { limit: 50 }),
        ),
      );
      assert.ok(pending.items.some((item) => item.id === candidate.id));
      assert.equal(fixture.human.readObject({ objectId: proposedId }).ok, false);
      const applied = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.reviewProposal(input),
          request(selected, {
            operationKey: 'native:accept',
            decision: 'accept' as const,
            proposalId: candidate.id,
            expectedPayloadHash: candidate.payloadHash,
            expectedProposalVersion: candidate.statusVersion,
            expectedTarget: { state: 'absent' as const },
          }),
        ),
      );
      assert.equal(applied.outcome, 'applied');
      assert.equal(applied.object?.revision, 1);
      const explanation = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.readAcceptedChange(input),
          request(selected, {
            changeId: applied.changeId,
            section: 'summary' as const,
            maxBytes: 32768,
          }),
        ),
      );
      assert.equal(explanation.section, 'summary');
      if (explanation.section !== 'summary') assert.fail('Expected accepted explanation');
      assert.equal(explanation.declared.reason, 'Synthetic measurements support a separate note.');
      const evidence = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.readAcceptedChange(input),
          request(selected, {
            changeId: applied.changeId,
            section: 'evidence' as const,
            maxBytes: 16384,
          }),
        ),
      );
      assert.equal(evidence.section, 'evidence');
      if (evidence.section !== 'evidence') assert.fail('Expected evidence pins');
      assert.deepEqual(evidence.items[0]?.ref, {
        mode: 'pinned',
        objectId: fixture.ids.measurements,
        revision: 1,
      });
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: proposedId })).object.content.body,
        'A candidate until the person decides.',
      );

      // Opening B then the original A must not make A's old binding valid again.
      const example = requireSuccess(
        await native.page.evaluate(() => window.agentSpace.openExample()),
      );
      assert.notEqual(example.status.spaceId, selected.status.spaceId);
      await native.chooseNextFolder(fixture.directory);
      const reopened = requireSuccess(
        await native.page.evaluate(() => window.agentSpace.openSpace()),
      );
      assert.ok(reopened);
      assert.notEqual(reopened.bindingId, selected.bindingId);
      assert.equal(reopened.status.spaceId, selected.status.spaceId);
      const old = await native.page.evaluate(
        (input) => window.agentSpace.status(input),
        request(selected, null),
      );
      assert.ok(!old.ok);
      assert.equal(old.error.code, 'SPACE_MISMATCH');
      const current = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.readObject(input),
          request(reopened, { objectId: targetId }),
        ),
      );
      assert.equal(current.object.content.body, create.input.content.body);
      await client.close();
      client = null;
      await native.page.reload();
      await native.page.waitForFunction(() => typeof window.agentSpace?.bootstrap === 'function');
      assert.equal(
        requireSuccess(await native.bootstrap()).activeSpace?.status.spaceId,
        selected.status.spaceId,
      );
      assert.deepEqual(native.pageErrors, []);

      // Actual app quit, rather than forced harness cleanup, proves this clean close.
      const child = native.application.process();
      const exited = once(child, 'exit');
      await native.application.evaluate(({ app }) => app.quit());
      await Promise.race([
        exited,
        delay(8_000).then(() => {
          throw new Error('Clean native quit did not complete.');
        }),
      ]);
      assert.equal(child.signalCode, null);
      assert.equal(child.exitCode, 0);
      await native.close();
      native = await launchNative({ entry: root, userData });
      const afterRestart = requireSuccess(await native.bootstrap());
      assert.equal(afterRestart.activeSpace?.status.spaceId, selected.status.spaceId);
      const retained = requireSuccess(
        await native.page.evaluate(
          (input) => window.agentSpace.readObject(input),
          request(afterRestart.activeSpace!, { objectId: proposedId }),
        ),
      );
      assert.equal(retained.object.content.body, 'A candidate until the person decides.');
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await client?.close().catch(() => undefined);
      await native?.close();
      fixture.dispose();
    }
  },
);
