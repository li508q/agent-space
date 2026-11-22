import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import type { ReadPage } from '../../src/contracts/schema.js';
import { agent, content, fixture, ok } from '../core/helpers.js';

const executable = createRequire(import.meta.url)('electron') as string;
const main = fileURLToPath(new URL('../../dist/desktop/main.cjs', import.meta.url));

function environment(appData: string, token: string): Record<string, string> {
  const env = {
    ...getDefaultEnvironment(),
    AGENTSPACE_USER_DATA: appData,
    AGENTSPACE_TOKEN: token,
  };
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  return env;
}

function argumentsFor(directory: string, instance: string, grant: string): string[] {
  return ['--space', directory, '--instance', instance, '--grant', grant];
}

test(
  'native Electron CLI opens the real space without a window, preference file or system Node',
  { timeout: 20_000 },
  async (t) => {
    const f = fixture(t);
    const note = ok(
      f.human.createObject({
        operationKey: 'native:seed',
        kind: 'document',
        content: content('原生 런타임 café 🙂', 'Native runtime'),
      }),
    ).object;
    const issued = agent(f.space, f.human, 'native:grant');
    const appData = join(f.root, 'isolated-app-data');
    const child = spawn(
      executable,
      [
        main,
        '--agent-cli',
        ...argumentsFor(f.directory, ok(f.human.status()).instanceId, issued.grant.id),
        '--tool',
        'object_read',
      ],
      { env: environment(appData, issued.token), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (part: string) => {
      stdout += part;
    });
    child.stderr.setEncoding('utf8').on('data', (part: string) => {
      stderr += part;
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    child.stdin.end(
      JSON.stringify({
        ref: { mode: 'current', objectId: note.id },
        section: 'body',
        maxBytes: 4_096,
      }),
    );
    assert.equal(await exited, 0, stderr);
    const result = JSON.parse(stdout) as Result<ReadPage>;
    const read = ok(result);
    assert.ok(read.section === 'body');
    assert.equal(read.text, note.content.body);
    assert.equal(read.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
    assert.equal(
      existsSync(join(appData, 'preferences.json')),
      false,
      'Agent mode never enters desktop preferences/session initialization',
    );
    assert.ok(!stdout.includes(issued.token) && !stderr.includes(issued.token));
    const prepared = ok(f.human.activity({ after: 0, limit: 20 })).items.find(
      (item) => item.tool === 'object_read',
    );
    assert.equal(prepared?.stage, 'prepared');
    assert.equal(prepared?.delivered[0]?.ref.objectId, note.id);
  },
);

test(
  'two native Electron MCP modes share a space without the desktop lock and propose through the same core',
  { timeout: 30_000 },
  async (t) => {
    const f = fixture(t);
    const note = ok(
      f.human.createObject({
        operationKey: 'mcp:seed',
        kind: 'document',
        content: content('Human saved text', 'Shared native entry'),
      }),
    ).object;
    const issued = agent(f.space, f.human, 'mcp:grant');
    const initial = ok(f.human.status());
    const appData = join(f.root, 'same-isolated-app-data');
    const connections: { client: Client; transport: StdioClientTransport; stderr: () => string }[] =
      [];
    t.after(async () => {
      for (const connection of connections) await connection.client.close();
    });
    for (const era of ['legacy', 'modern'] as const) {
      const client = new Client(
        { name: 'Native entry boundary test', version: '1.0.0' },
        { versionNegotiation: { mode: era === 'modern' ? { pin: '2026-07-28' } : 'legacy' } },
      );
      const transport = new StdioClientTransport({
        command: executable,
        args: [
          main,
          '--agent-server',
          ...argumentsFor(f.directory, initial.instanceId, issued.grant.id),
        ],
        env: environment(appData, issued.token),
        stderr: 'pipe',
      });
      let stderr = '';
      transport.stderr?.on('data', (part: Buffer) => {
        stderr += part.toString();
      });
      connections.push({ client, transport, stderr: () => stderr });
      await client.connect(transport);
      assert.equal(client.getProtocolEra(), era);
      assert.deepEqual((await client.listTools()).tools.map((item) => item.name).sort(), [
        'changes_list',
        'object_read',
        'objects_query',
        'operation_status',
        'proposal_create',
        'space_discover',
      ]);
    }
    assert.equal(
      ok(f.human.status()).activitySequence,
      initial.activitySequence,
      'Connecting/listing tools never claims a tool call',
    );
    const second = connections[1]!;
    const response = await second.client.callTool({
      name: 'proposal_create',
      arguments: {
        operationKey: 'mcp:native-proposal',
        action: 'update',
        targetId: note.id,
        baseRevision: note.revision,
        patch: { body: 'A real native MCP candidate' },
        purpose: 'Native bridge verification',
        reason: 'Synthetic data only',
        sources: [],
      },
    });
    const text = response.content.find((item) => item.type === 'text');
    assert.ok(text && text.type === 'text');
    const result = JSON.parse(text.text) as Result<ProposalReceipt>;
    const proposal = ok(result);
    assert.equal(proposal.status, 'pending');
    assert.deepEqual(response.structuredContent, result);
    assert.equal(
      ok(f.human.readObject({ objectId: note.id })).object.content.body,
      'Human saved text',
    );
    assert.equal(
      ok(f.human.getProposal({ proposalId: proposal.id })).proposedContent.body,
      'A real native MCP candidate',
    );
    for (const connection of connections) {
      await connection.client.close();
      assert.ok(!connection.stderr().includes(issued.token));
    }
    assert.equal(existsSync(join(appData, 'preferences.json')), false);
  },
);
