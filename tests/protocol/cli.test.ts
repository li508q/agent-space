import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { OperationStatus, ProposalReceipt } from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import { MAX_AGENT_INPUT_BYTES } from '../../src/adapters/tools.js';
import {
  entry,
  launchArguments,
  launchEnvironment,
  must,
  protocolFixture,
  toolNames,
  type Fixture,
} from './fixtures.js';

function run(
  fixture: Fixture,
  args: string[],
  input: string | Buffer = '{}',
  environment = launchEnvironment(fixture),
) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: environment,
    input,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(!result.stderr.includes(fixture.full.token!));
  assert.ok(!result.stderr.includes(fixture.hidden.content.body));
  return result;
}

function cli(fixture: Fixture, tool: string, input: unknown) {
  return run(
    fixture,
    ['--agent-cli', ...launchArguments(fixture), '--tool', tool],
    JSON.stringify(input),
  );
}

function result<T>(stdout: string): Result<T> {
  assert.equal(stdout.trim().split('\n').length, 1, 'Exactly one machine-readable result');
  const value = JSON.parse(stdout) as Result<T>;
  assert.equal(typeof value.ok, 'boolean');
  return value;
}

test('compiled CLI invokes all ten restricted tools with one JSON Result and stable receipts', () => {
  const fixture = protocolFixture();
  try {
    const inputs: Record<string, unknown> = {
      space_discover: {},
      objects_query: { filter: { text: 'CAFÉ' }, limit: 10, maxBytes: 4_096 },
      object_read: {
        ref: { mode: 'current', objectId: fixture.visible.id },
        section: 'body',
        maxBytes: 1_024,
      },
      changes_list: { after: 0, limit: 10 },
      operation_status: { operationKey: 'not:yet:recorded' },
      schema_describe: { maxBytes: 16_384 },
      text_search: { filter: { text: 'CAFÉ' }, limit: 10, maxBytes: 4_096 },
      relations_expand: {
        seedId: fixture.visible.id,
        direction: 'outgoing',
        predicates: ['related'],
        maxDepth: 1,
        maxNodes: 10,
        maxEdges: 10,
        maxBytes: 4_096,
      },
    };
    for (const [tool, input] of Object.entries(inputs)) {
      const response = cli(fixture, tool, input);
      assert.equal(response.status, 0);
      const decoded = result(response.stdout);
      assert.equal(decoded.ok, true);
      if (tool === 'object_read') {
        assert.equal(Buffer.byteLength(JSON.stringify(decoded)) <= 1_024, true);
      }
    }
    const input = {
      operationKey: 'cli:create-note',
      action: 'create',
      purpose: 'Suggest a note',
      reason: 'Synthetic CLI fixture',
      sources: [],
      newObject: {
        id: randomUUID(),
        kind: 'document',
        content: {
          title: 'CLI 提案',
          body: 'A real pending candidate.',
          properties: {},
          relations: [],
        },
      },
    };
    const first = cli(fixture, 'proposal_create', input);
    assert.equal(first.status, 0);
    const candidate = must(result<ProposalReceipt>(first.stdout));
    assert.equal(
      must(fixture.human.getProposal({ proposalId: candidate.id })).proposal.status,
      'pending',
    );
    assert.equal(fixture.human.readObject({ objectId: input.newObject.id }).ok, false);
    // Every CLI call is a new real process. The grant namespace survives it.
    const again = cli(fixture, 'proposal_create', input);
    assert.equal(again.status, 0);
    assert.deepEqual(must(result<ProposalReceipt>(again.stdout)), candidate);
    assert.equal(must(fixture.human.listProposals({ limit: 50 })).items.length, 1);
    const status = cli(fixture, 'operation_status', { operationKey: input.operationKey });
    const recovered = must(result<OperationStatus>(status.stdout));
    assert.ok(recovered.state === 'recorded');
    assert.equal(recovered.receipt.business?.kind, 'proposal');
    const accepted = must(
      fixture.human.reviewProposal({
        operationKey: 'cli:human:accept',
        proposalId: candidate.id,
        expectedPayloadHash: candidate.payloadHash,
        expectedProposalVersion: candidate.statusVersion,
        decision: 'accept',
        expectedTarget: { state: 'absent' },
      }),
    );
    for (const section of ['summary', 'evidence']) {
      const response = cli(fixture, 'accepted_change_read', {
        changeId: accepted.changeId,
        section,
        maxBytes: 8_192,
      });
      assert.equal(response.status, 0);
      const decoded = result<{ returnedBytes: number }>(response.stdout);
      assert.equal(must(decoded).returnedBytes, Buffer.byteLength(JSON.stringify(decoded)));
    }
  } finally {
    fixture.close();
  }
});

test('CLI rejects unknown/human tools, incomplete requests, unknown fields and malformed or oversized stdin', () => {
  const fixture = protocolFixture();
  try {
    for (const tool of [
      'saveObject',
      'reviewProposal',
      'undoChange',
      'createGrant',
      'schema_describe',
      'text_search',
      'relations_expand',
      'accepted_change_read',
    ]) {
      const response = cli(fixture, tool, {});
      assert.equal(response.status, 64);
      const decoded = result(response.stdout);
      assert.ok(!decoded.ok);
      assert.equal(decoded.error.code, 'INVALID_INPUT');
    }
    const fields = cli(fixture, 'space_discover', { actor: 'human', path: '/synthetic/no-access' });
    assert.equal(fields.status, 64);
    assert.equal(result(fields.stdout).ok, false);
    for (const input of ['{invalid', '{}\n{}', Buffer.from([0xff])]) {
      const response = run(
        fixture,
        ['--agent-cli', ...launchArguments(fixture), '--tool', 'space_discover'],
        input,
      );
      assert.equal(response.status, 65);
      const decoded = result(response.stdout);
      assert.ok(!decoded.ok);
      assert.equal(decoded.error.code, 'INVALID_INPUT');
    }
    const large = run(
      fixture,
      ['--agent-cli', ...launchArguments(fixture), '--tool', 'space_discover'],
      ' '.repeat(MAX_AGENT_INPUT_BYTES + 1),
    );
    assert.equal(large.status, 65);
    const decoded = result(large.stdout);
    assert.ok(!decoded.ok);
    assert.equal(decoded.error.code, 'LIMIT_EXCEEDED');
    assert.equal(must(fixture.human.status()).authoritySequence, fixture.status.authoritySequence);
    assert.equal(must(fixture.human.status()).activitySequence, fixture.status.activitySequence);
  } finally {
    fixture.close();
  }
});

test('startup refuses missing/empty/wrong-instance/unsupported spaces; server errors never enter stdout', () => {
  const fixture = protocolFixture();
  try {
    const absent = join(fixture.root, 'missing space');
    const empty = join(fixture.root, 'empty');
    mkdirSync(empty);
    for (const directory of [absent, empty]) {
      for (const mode of ['--agent-server', '--agent-cli']) {
        const args = [
          mode,
          '--space',
          directory,
          '--instance',
          fixture.status.instanceId,
          '--grant',
          fixture.full.grant.id,
        ];
        if (mode === '--agent-cli') args.push('--tool', 'space_discover');
        const response = run(fixture, args);
        assert.equal(response.status, 1);
        const decoded = result(
          mode === '--agent-server'
            ? response.stderr.split('\n').find((line) => line.startsWith('{'))!
            : response.stdout,
        );
        assert.ok(!decoded.ok);
        assert.equal(decoded.error.code, 'NOT_FOUND');
        if (mode === '--agent-server') assert.equal(response.stdout, '');
      }
    }
    assert.equal(existsSync(absent), false);
    assert.deepEqual(readdirSync(empty), []);
    const wrong = run(fixture, [
      '--agent-server',
      '--space',
      fixture.directory,
      '--instance',
      randomUUID(),
      '--grant',
      fixture.full.grant.id,
    ]);
    assert.equal(wrong.status, 1);
    assert.equal(wrong.stdout, '');
    assert.match(wrong.stderr, /SPACE_MISMATCH/);
    const secret = 'synthetic-token-that-must-not-be-logged';
    const denied = run(fixture, ['--agent-server', ...launchArguments(fixture)], '{}', {
      ...launchEnvironment(fixture),
      AGENTSPACE_TOKEN: secret,
    });
    assert.equal(denied.status, 1);
    assert.equal(denied.stdout, '');
    assert.match(denied.stderr, /FORBIDDEN/);
    assert.ok(!denied.stderr.includes(secret));
    const metadata = new DatabaseSync(join(fixture.directory, 'space.sqlite'));
    metadata.exec('PRAGMA user_version=999');
    metadata.close();
    for (const mode of ['--agent-server', '--agent-cli']) {
      const args = [mode, ...launchArguments(fixture)];
      if (mode === '--agent-cli') args.push('--tool', 'space_discover');
      const response = run(fixture, args);
      assert.equal(response.status, 1);
      assert.match(
        mode === '--agent-server' ? response.stderr : response.stdout,
        /SCHEMA_UNSUPPORTED/,
      );
      if (mode === '--agent-server') assert.equal(response.stdout, '');
    }
    const verify = new DatabaseSync(join(fixture.directory, 'space.sqlite'), { readOnly: true });
    assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version, 999, 'No migration');
    verify.close();
  } finally {
    fixture.close();
  }
});

test('help needs no credentials; launch flags reject duplicates/relative paths/tokens without opening', () => {
  const fixture = protocolFixture();
  try {
    for (const mode of ['--agent-server', '--agent-cli']) {
      const help = run(fixture, [mode, '--help'], '', {});
      assert.equal(help.status, 0);
      assert.equal(help.stdout, '');
      for (const tool of toolNames) assert.ok(help.stderr.includes(tool));
    }
    for (const args of [
      [
        '--agent-cli',
        ...launchArguments(fixture),
        '--tool',
        'space_discover',
        '--token',
        'SYNTHETIC_SECRET_ARG',
      ],
      [
        '--agent-cli',
        ...launchArguments(fixture),
        '--tool',
        'space_discover',
        '--grant',
        fixture.full.grant.id,
      ],
      [
        '--agent-cli',
        '--space',
        'relative',
        '--instance',
        fixture.status.instanceId,
        '--grant',
        fixture.full.grant.id,
        '--tool',
        'space_discover',
      ],
    ]) {
      const response = run(fixture, args);
      assert.equal(response.status, 64);
      const decoded = result(response.stdout);
      assert.ok(!decoded.ok);
      assert.equal(decoded.error.code, 'INVALID_INPUT');
      assert.ok(!response.stdout.includes('SYNTHETIC_SECRET_ARG'));
      assert.ok(!response.stderr.includes('SYNTHETIC_SECRET_ARG'));
    }
    assert.equal(must(fixture.human.status()).activitySequence, fixture.status.activitySequence);
  } finally {
    fixture.close();
  }
});

test('compiled MCP rejects invalid UTF-8 and oversized protocol buffers without leaking input', () => {
  const fixture = protocolFixture();
  try {
    for (const input of [Buffer.from([0xff]), ' '.repeat(MAX_AGENT_INPUT_BYTES + 1)]) {
      const response = run(fixture, ['--agent-server', ...launchArguments(fixture)], input);
      assert.equal(response.status, 65);
      assert.equal(response.stdout, '');
      assert.match(response.stderr, /AgentSpace: protocol error/);
    }
    assert.equal(must(fixture.human.status()).activitySequence, fixture.status.activitySequence);
  } finally {
    fixture.close();
  }
});
