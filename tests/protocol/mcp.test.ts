import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type {
  DiscoverResult,
  OperationStatus,
  ProposalReceipt,
  QueryPage,
  SequencePage,
  ChangeSummary,
} from '../../src/contracts/core.js';
import type { ProposalInput, ReadPage } from '../../src/contracts/schema.js';
import type { Result } from '../../src/contracts/errors.js';
import { Space } from '../../src/core/index.js';
import {
  call,
  connect,
  entry,
  launchArguments,
  launchEnvironment,
  must,
  protocolFixture,
  toolNames,
} from './fixtures.js';

for (const era of ['legacy', 'modern'] as const) {
  test(
    `${era}: compiled MCP registry, pinned Unicode pages, human acceptance and restart replay`,
    { timeout: 30_000 },
    async () => {
      const fixture = protocolFixture();
      let connection = await connect(fixture, era);
      const secondSpace = must(Space.open(fixture.directory));
      const human = secondSpace.human('protocol-tests:person');
      try {
        // Binding/SDK initialization/tools-list do not manufacture tool activity.
        assert.equal(must(human.status()).activitySequence, fixture.status.activitySequence);
        assert.equal(connection.client.getProtocolEra(), era);
        assert.equal(
          connection.client.getServerVersion()?.version,
          (
            JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
              version: string;
            }
          ).version,
          'The negotiated server version identifies this application build.',
        );
        if (era === 'modern') {
          assert.equal(connection.client.getNegotiatedProtocolVersion(), '2026-07-28');
          assert.ok(connection.client.getDiscoverResult());
        }
        const listed = await connection.client.listTools();
        assert.deepEqual(listed.tools.map((item) => item.name).sort(), toolNames);
        assert.ok(listed.tools.every((item) => item.inputSchema.type === 'object'));
        assert.ok(!JSON.stringify(listed.tools).includes('spacePath'));
        const discovery = must(await call<DiscoverResult>(connection, 'space_discover', {}));
        assert.equal(discovery.status.spaceId, fixture.status.spaceId);
        assert.equal(discovery.status.instanceId, fixture.status.instanceId);
        assert.equal(discovery.status.example, true);

        const query = must(
          await call<QueryPage>(connection, 'objects_query', {
            filter: { text: '项目' },
            limit: 20,
            maxBytes: 8_192,
          }),
        );
        assert.deepEqual(
          query.items.map((item) => item.ref.objectId),
          [fixture.visible.id],
        );
        const firstResult = await call<ReadPage>(connection, 'object_read', {
          ref: { mode: 'current', objectId: fixture.visible.id },
          section: 'body',
          maxBytes: 1_024,
        });
        const first = must(firstResult);
        assert.equal(first.section, 'body');
        assert.ok(first.section === 'body');
        assert.equal(first.returnedBytes, Buffer.byteLength(JSON.stringify(firstResult)));
        assert.ok(first.returnedBytes <= 1_024 && first.nextCursor);
        const changed = must(
          human.saveObject({
            operationKey: 'human:during-paging',
            targetId: fixture.visible.id,
            expectedRevision: fixture.visible.revision,
            content: { ...fixture.visible.content, body: 'Human current text after first page.' },
            generation: 2,
          }),
        );
        let reconstructed = first.text;
        let cursor: string | null = first.nextCursor;
        while (cursor) {
          const result: Result<ReadPage> = await call<ReadPage>(connection, 'object_read', {
            cursor,
            maxBytes: 1_024,
          });
          const page: ReadPage = must(result);
          assert.ok(page.section === 'body');
          assert.deepEqual(page.ref, first.ref);
          assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
          assert.ok(page.returnedBytes <= 1_024);
          reconstructed += page.text;
          cursor = page.nextCursor;
        }
        assert.equal(reconstructed, fixture.visible.content.body);

        const update: ProposalInput = {
          operationKey: 'agent:proposal-update',
          action: 'update',
          targetId: fixture.visible.id,
          baseRevision: changed.object.revision,
          patch: { body: 'Agent proposed text.' },
          purpose: 'Propose an explicit text correction',
          reason: 'Synthetic protocol fixture',
          sources: [],
        };
        const candidate = must(await call<ProposalReceipt>(connection, 'proposal_create', update));
        assert.equal(candidate.status, 'pending');
        assert.ok(!('payload' in candidate));
        assert.equal(
          must(human.readObject({ objectId: fixture.visible.id })).object.revision,
          changed.object.revision,
        );
        assert.equal(
          must(human.getProposal({ proposalId: candidate.id })).proposedContent.body,
          'Agent proposed text.',
        );
        const accepted = must(
          human.reviewProposal({
            operationKey: 'human:apply-update',
            decision: 'accept',
            proposalId: candidate.id,
            expectedProposalVersion: candidate.statusVersion,
            expectedPayloadHash: candidate.payloadHash,
            expectedTarget: { state: 'revision', revision: changed.object.revision },
          }),
        );
        assert.equal(accepted.outcome, 'applied');

        const newId = randomUUID();
        const creation: ProposalInput = {
          operationKey: 'agent:proposal-new',
          action: 'create',
          purpose: 'Suggest an independent note',
          reason: 'Synthetic protocol fixture',
          sources: [],
          newObject: {
            id: newId,
            kind: 'document',
            content: {
              title: 'Proposed note · 提案',
              body: 'Pending until the person accepts.',
              properties: {},
              relations: [],
            },
          },
        };
        const newCandidate = must(
          await call<ProposalReceipt>(connection, 'proposal_create', creation),
        );
        assert.equal(newCandidate.baseRevision, null);
        assert.equal(human.readObject({ objectId: newId }).ok, false);
        assert.ok(
          !must(human.query({ filter: {}, limit: 50, maxBytes: 65_536 })).items.some(
            (item) => item.ref.objectId === newId,
          ),
        );
        const created = must(
          human.reviewProposal({
            operationKey: 'human:apply-new',
            decision: 'accept',
            proposalId: newCandidate.id,
            expectedProposalVersion: newCandidate.statusVersion,
            expectedPayloadHash: newCandidate.payloadHash,
            expectedTarget: { state: 'absent' },
          }),
        );
        assert.equal(created.outcome, 'applied');
        assert.equal(created.object?.revision, 1);
        const changes = must(
          await call<SequencePage<ChangeSummary>>(connection, 'changes_list', {
            after: 0,
            limit: 50,
          }),
        );
        assert.ok(changes.items.some((item) => item.proposalId === newCandidate.id));
        const receipt = must(
          await call<OperationStatus>(connection, 'operation_status', {
            operationKey: creation.operationKey,
          }),
        );
        assert.ok(receipt.state === 'recorded');
        assert.equal(receipt.receipt.business?.kind, 'proposal');
        assert.equal(receipt.currentProposal?.status, 'applied');

        const countBefore = must(human.listProposals({ limit: 50 })).items.length;
        await connection.close();
        connection = await connect(fixture, era);
        const replay = must(await call<ProposalReceipt>(connection, 'proposal_create', creation));
        assert.deepEqual(
          replay,
          newCandidate,
          'Same grant/key recovers the original candidate after restart',
        );
        assert.equal(must(human.listProposals({ limit: 50 })).items.length, countBefore);
        const reused = await call(connection, 'proposal_create', {
          ...creation,
          reason: 'Different request',
        });
        assert.ok(!reused.ok);
        assert.equal(reused.error.code, 'IDEMPOTENCY_KEY_REUSED');
        const activities = must(human.activity({ after: 0, limit: 50 })).items;
        const preparedRead = activities.find(
          (item) => item.tool === 'object_read' && item.stage === 'prepared',
        );
        assert.ok(preparedRead);
        assert.equal(preparedRead.delivered[0]?.ref.revision, fixture.visible.revision);
        assert.ok(!JSON.stringify(activities).includes(fixture.full.token!));
      } finally {
        await connection.close();
        secondSpace.close();
        fixture.close();
      }
    },
  );
}

test(
  'MCP unknown fields/tools and outside scope fail; a live grant revocation denies all ten calls',
  { timeout: 20_000 },
  async () => {
    const fixture = protocolFixture();
    const connection = await connect(fixture, 'modern', true);
    try {
      const query = must(
        await call<QueryPage>(connection, 'objects_query', {
          filter: {},
          limit: 50,
          maxBytes: 65_536,
        }),
      );
      assert.deepEqual(
        query.items.map((item) => item.ref.objectId),
        [fixture.visible.id],
      );
      assert.ok(!JSON.stringify(query).includes(fixture.hidden.content.title));
      for (const [tool, args] of [
        [
          'object_read',
          {
            ref: { mode: 'pinned', objectId: fixture.hidden.id, revision: 1 },
            section: 'body',
            maxBytes: 1_024,
          },
        ],
        [
          'proposal_create',
          {
            operationKey: 'deny:target',
            action: 'update',
            targetId: fixture.hidden.id,
            baseRevision: 1,
            patch: { body: 'Unauthorized' },
            purpose: 'Fixture',
            reason: 'Fixture',
            sources: [],
          },
        ],
        [
          'proposal_create',
          {
            operationKey: 'deny:source',
            action: 'update',
            targetId: fixture.visible.id,
            baseRevision: 1,
            patch: { body: 'Unauthorized source' },
            purpose: 'Fixture',
            reason: 'Fixture',
            sources: [{ mode: 'pinned', objectId: fixture.hidden.id, revision: 1 }],
          },
        ],
        [
          'proposal_create',
          {
            operationKey: 'deny:create',
            action: 'create',
            purpose: 'Fixture',
            reason: 'Fixture',
            sources: [],
            newObject: {
              id: randomUUID(),
              kind: 'document',
              content: { title: '', body: 'Candidate', properties: {}, relations: [] },
            },
          },
        ],
      ] as const) {
        const result = await call(connection, tool, args);
        assert.ok(!result.ok);
        assert.equal(result.error.code, 'FORBIDDEN');
        assert.ok(!JSON.stringify(result).includes(fixture.hidden.content.title));
        assert.ok(!JSON.stringify(result).includes(fixture.hidden.content.body));
      }
      for (const [tool, args] of [
        ['space_discover', { actor: 'human' }],
        ['objects_query', { filter: {}, limit: 10, maxBytes: 1_024, path: '/synthetic/forbidden' }],
        [
          'object_read',
          {
            ref: { mode: 'current', objectId: fixture.visible.id },
            section: 'body',
            maxBytes: 1_024,
            sql: 'SELECT 1',
          },
        ],
        ['human_save', {}],
        ['reviewProposal', {}],
        ['schema_describe', {}],
        ['text_search', {}],
        ['relations_expand', {}],
        ['accepted_change_read', {}],
      ] as const) {
        const result = await call(connection, tool, args);
        assert.ok(!result.ok);
        assert.equal(result.error.code, 'INVALID_INPUT');
        assert.equal(result.error.retryable, false);
      }
      must(
        fixture.human.updateGrant({
          operationKey: 'human:revoke',
          grantId: fixture.scoped.grant.id,
          expectedGeneration: fixture.scoped.grant.generation,
          spec: fixture.scopedSpec,
          revoked: true,
        }),
      );
      for (const [tool, args] of [
        ['space_discover', {}],
        ['objects_query', { filter: {}, limit: 10, maxBytes: 1_024 }],
        [
          'object_read',
          {
            ref: { mode: 'current', objectId: fixture.visible.id },
            section: 'body',
            maxBytes: 1_024,
          },
        ],
        [
          'proposal_create',
          {
            operationKey: 'deny:revoked',
            action: 'update',
            targetId: fixture.visible.id,
            baseRevision: 1,
            patch: { body: 'Revoked' },
            purpose: 'Fixture',
            reason: 'Fixture',
            sources: [],
          },
        ],
        ['changes_list', { limit: 10 }],
        ['operation_status', { operationKey: 'deny:target' }],
        ['schema_describe', { maxBytes: 16_384 }],
        ['text_search', { filter: { text: '项目' }, limit: 10, maxBytes: 4_096 }],
        [
          'relations_expand',
          {
            seedId: fixture.visible.id,
            direction: 'outgoing',
            predicates: ['related'],
            maxDepth: 1,
            maxNodes: 10,
            maxEdges: 10,
            maxBytes: 4_096,
          },
        ],
        ['accepted_change_read', { changeId: randomUUID(), section: 'summary', maxBytes: 4_096 }],
      ] as const) {
        const result = await call(connection, tool, args);
        assert.ok(!result.ok);
        assert.equal(result.error.code, 'FORBIDDEN');
        assert.equal(result.error.retryable, false);
      }
    } finally {
      await connection.close();
      fixture.close();
    }
  },
);

test(
  'raw compiled stdio stdout contains only protocol JSON; EOF closes promptly',
  { timeout: 15_000 },
  async () => {
    const fixture = protocolFixture();
    const child = spawn(process.execPath, [entry, '--agent-server', ...launchArguments(fixture)], {
      env: launchEnvironment(fixture),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let pending = '';
    let stderr = '';
    const parseErrors: unknown[] = [];
    const ids: number[] = [];
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      pending += data.toString();
      while (pending.includes('\n')) {
        const boundary = pending.indexOf('\n');
        const line = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        try {
          const message = JSON.parse(line) as { jsonrpc: string; id?: number; result?: unknown };
          assert.equal(message.jsonrpc, '2.0');
          assert.ok(message.result);
          if (message.id !== undefined) ids.push(message.id);
          if (message.id === 1) {
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          } else if (message.id === 2) {
            send({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: { name: 'space_discover', arguments: {} },
            });
          } else if (message.id === 3) child.stdin.end();
        } catch (error) {
          parseErrors.push(error);
          child.kill();
        }
      }
    });
    try {
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'Synthetic raw stdout audit', version: '1' },
        },
      });
      assert.equal(await exited, 0);
      assert.deepEqual(ids, [1, 2, 3]);
      assert.equal(parseErrors.length, 0);
      assert.equal(pending, '');
      assert.ok(!stdout.includes(fixture.full.token!));
      assert.ok(!stderr.includes(fixture.full.token!));
    } finally {
      child.kill();
      fixture.close();
    }
  },
);
