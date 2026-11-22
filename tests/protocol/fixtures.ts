import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Space } from '../../src/core/index.js';
import type { GrantSpec } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';

export const entry = fileURLToPath(new URL('../../dist/agent/adapters/entry.js', import.meta.url));
export const toolNames = [
  'space_discover',
  'objects_query',
  'object_read',
  'proposal_create',
  'changes_list',
  'operation_status',
].sort();

export function must<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(`Unexpected core failure: ${result.error.code}`);
  return result.value;
}

export function protocolFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agentspace-protocol fixture-'));
  const directory = join(root, 'space 合成');
  const space = must(Space.create(directory, { title: 'Synthetic protocol space', example: true }));
  const human = space.human('protocol-tests:person');
  const visible = must(
    human.createObject({
      operationKey: 'seed:visible',
      kind: 'document',
      id: randomUUID(),
      content: {
        title: '项目連携 지식 Café',
        body: '项目連携 지식 café 🙂 e\u0301\n'.repeat(180),
        properties: {},
        relations: [],
      },
    }),
  ).object;
  const hidden = must(
    human.createObject({
      operationKey: 'seed:hidden',
      kind: 'document',
      content: {
        title: 'SYNTHETIC_OUTSIDE_SCOPE_TITLE',
        body: 'SYNTHETIC_OUTSIDE_SCOPE_BODY',
        properties: {},
        relations: [],
      },
    }),
  ).object;
  const fullSpec: GrantSpec = {
    label: 'Protocol full client',
    scope: { mode: 'space' },
    capabilities: { read: true, propose: true },
    creation: { enabled: true, kinds: ['document', 'record'] },
  };
  const scopedSpec: GrantSpec = {
    label: 'Protocol scoped client',
    scope: { mode: 'objects', objectIds: [visible.id] },
    capabilities: { read: true, propose: true },
  };
  const full = must(human.createGrant({ operationKey: 'grant:full', spec: fullSpec }));
  const scoped = must(human.createGrant({ operationKey: 'grant:scoped', spec: scopedSpec }));
  assert.ok(full.token);
  assert.ok(scoped.token);
  return {
    root,
    directory,
    space,
    human,
    visible,
    hidden,
    full,
    scoped,
    fullSpec,
    scopedSpec,
    status: must(human.status()),
    close() {
      space.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
export type Fixture = ReturnType<typeof protocolFixture>;

export function launchArguments(fixture: Fixture, scoped = false): string[] {
  return [
    '--space',
    fixture.directory,
    '--instance',
    fixture.status.instanceId,
    '--grant',
    (scoped ? fixture.scoped : fixture.full).grant.id,
  ];
}

export function launchEnvironment(fixture: Fixture, scoped = false): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    AGENTSPACE_TOKEN: (scoped ? fixture.scoped : fixture.full).token!,
  };
}

export async function connect(fixture: Fixture, era: 'legacy' | 'modern', scoped = false) {
  const client = new Client(
    { name: 'AgentSpace protocol test', version: '1.0.0' },
    { versionNegotiation: { mode: era === 'modern' ? { pin: '2026-07-28' } : 'legacy' } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, '--agent-server', ...launchArguments(fixture, scoped)],
    env: launchEnvironment(fixture, scoped),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const errors: Error[] = [];
  client.onerror = (error) => errors.push(error);
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  return {
    client,
    transport,
    errors,
    stderr: () => stderr,
    async close() {
      await client.close();
      assert.equal(errors.length, 0, 'No malformed stdout or protocol errors');
      assert.ok(!stderr.includes(fixture.full.token!));
      assert.ok(!stderr.includes(fixture.scoped.token!));
      assert.ok(!stderr.includes(fixture.visible.content.body));
      assert.ok(!stderr.includes(fixture.hidden.content.body));
    },
  };
}
export type Connection = Awaited<ReturnType<typeof connect>>;

export async function call<T>(
  connection: Connection,
  name: string,
  args: Record<string, unknown>,
): Promise<Result<T>> {
  const response = await connection.client.callTool({ name, arguments: args });
  const text = response.content.find((item) => item.type === 'text');
  assert.ok(text && text.type === 'text');
  const result = JSON.parse(text.text) as Result<T>;
  assert.equal(typeof result.ok, 'boolean');
  assert.deepEqual(response.structuredContent, result);
  assert.equal(response.isError, !result.ok);
  return result;
}
