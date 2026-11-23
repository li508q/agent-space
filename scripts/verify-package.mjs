import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { hash, outputAllowed, relativeFile } from './package-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length > 2)
  throw new Error(
    'package:verify accepts no arguments; it verifies the current version under release/.',
  );
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Packaged runtime verification supports Apple Silicon macOS only.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `AgentSpace-${pkg.version}-macOS-arm64`,
  zip = join(root, 'release', name + '.zip');
const safePath = '/usr/bin:/bin:/usr/sbin:/sbin';
const tokens = [];
function noSecrets(text) {
  for (const token of tokens)
    assert.ok(!text.includes(token), 'Synthetic token must never enter diagnostics or output.');
}
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4_194_304,
    ...options,
  });
  noSecrets((result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0)
    throw new Error(
      `Packaged verification command failed (${result.status ?? result.error?.code ?? 'signal'}): ${executable.split('/').at(-1)}`,
    );
  return result;
}
const digest = createHash('sha256');
for await (const chunk of createReadStream(zip)) digest.update(chunk);
const zipSha256 = digest.digest('hex');
const checksum = readFileSync(join(root, 'release', name + '.sha256'), 'utf8')
  .trim()
  .split(/\s+/);
assert.equal(checksum[0], zipSha256);
assert.equal(checksum[1], name + '.zip');
const entries = command('/usr/bin/zipinfo', ['-1', zip]).stdout.trim().split('\n');
for (const entry of entries) {
  relativeFile(entry.replace(/\/$/, ''));
  assert.ok(
    entry.startsWith(name + '/') ||
      entry === name ||
      entry === '__MACOSX/' ||
      entry.startsWith('__MACOSX/' + name + '/'),
    'Unexpected ZIP root.',
  );
}
const parent = join(root, '.coordination', 'relocated application');
mkdirSync(parent, { recursive: true, mode: 0o700 });
const work = mkdtempSync(join(parent, 'AgentSpace-'));
const extracted = join(work, 'extracted'),
  moved = join(work, 'Moved Application With Spaces');
mkdirSync(moved, { mode: 0o700 });
command('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
const info = JSON.parse(readFileSync(join(extracted, name, 'BUILDINFO.json'), 'utf8'));
assert.equal(info.format, 'agentspace-macos-package/v1');
assert.equal(info.version, pkg.version);
assert.equal(info.electronVersion, pkg.devDependencies.electron);
assert.equal(info.signature, 'ad-hoc');
const app = join(moved, 'AgentSpace.app');
renameSync(join(extracted, name, 'AgentSpace.app'), app);
const executable = join(app, 'Contents/MacOS/AgentSpace'),
  archive = join(app, 'Contents/Resources/app.asar');
assert.equal(
  hash(readFileSync(archive)),
  info.appAsarSha256,
  'The moved application must be exactly the ZIP application.',
);
const originalArchive = join(root, 'release', name, 'AgentSpace.app/Contents/Resources/app.asar');
if (existsSync(originalArchive))
  assert.equal(hash(readFileSync(originalArchive)), info.appAsarSha256);
const packed = listPackage(archive, { isPack: false }).filter(
  (path) => !('files' in statFile(archive, path.replace(/^\//, ''), false)),
);
assert.equal(packed.length, info.applicationFiles);
for (const file of packed) {
  const path = file.replace(/^\//, ''),
    entry = statFile(archive, path, false);
  assert.ok(!('link' in entry) && !entry.unpacked);
  assert.ok(
    ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'dist/agent/adapters/index.js'].includes(
      path,
    ) ||
      path === 'dist/desktop/main.cjs' ||
      path === 'dist/desktop/preload.cjs' ||
      (path.startsWith('dist/renderer/') && outputAllowed(path)),
    'Unexpected application archive entry.',
  );
}
const appMetadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
assert.equal(appMetadata.name, 'agent-space');
assert.equal(appMetadata.version, pkg.version);
assert.equal(appMetadata.dependencies, undefined);
assert.equal(appMetadata.devDependencies, undefined);
function containedLinks(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    assert.ok(
      realpathSync(path).startsWith(realpathSync(app) + sep),
      'App symlink escaped its bundle.',
    );
    return;
  }
  if (stat.isDirectory()) for (const child of readdirSync(path)) containedLinks(join(path, child));
}
containedLinks(app);
command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
assert.match(
  command('/usr/bin/codesign', ['--display', '--verbose=4', app]).stderr,
  /Signature=adhoc/,
);
const profile = join(work, 'agent-only-profile');
const baseEnv = { ...getDefaultEnvironment(), PATH: safePath, AGENTSPACE_USER_DATA: profile };
delete baseEnv.ELECTRON_RUN_AS_NODE;
delete baseEnv.NODE_PATH;
delete baseEnv.NODE_OPTIONS;
// Introspection supplements actual app-entry tests below; it does not substitute
// for --agent-cli/--agent-server. All three execute this same moved binary.
const versionExpression = `(()=>{const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');const sqlite=db.prepare('select sqlite_version() as v').get().v;db.close();return JSON.stringify({electron:process.versions.electron,node:process.versions.node,sqlite})})()`;
const runtime = JSON.parse(
  command(executable, ['-p', versionExpression], {
    env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' },
  }).stdout.trim(),
);
assert.equal(runtime.electron, pkg.devDependencies.electron);
assert.equal(runtime.node, '24.22.3');
const nodeLookup = spawnSync('/usr/bin/which', ['node'], {
  env: { PATH: safePath },
  encoding: 'utf8',
});
assert.notEqual(nodeLookup.status, 0, 'The restricted child PATH must not resolve system Node.');
const { Space } = await import('../dist/core/index.js');
const value = (result) => {
  if (!result.ok) throw new Error('Unexpected verification result: ' + result.error.code);
  return result.value;
};
const spaceDirectory = join(work, 'Synthetic space 合成');
const space = value(
  Space.create(spaceDirectory, {
    title: 'Synthetic relocated-package verification',
    example: true,
  }),
);
const human = space.human('package-verification');
const body = '项目 / 日本語 / 한국어 / Español / e\u0301 / 🙂\r\n'.repeat(90);
const content = (body = '', title = '') => ({ body, title, properties: {}, relations: [] });
const source = value(
  human.createObject({
    operationKey: 'seed-source',
    kind: 'document',
    content: content(body, '知识 source'),
  }),
).object;
const project = value(
  human.createObject({
    operationKey: 'seed-project',
    kind: 'project',
    content: content('Human-owned goal', 'Project'),
  }),
).object;
const note = value(
  human.createObject({
    operationKey: 'seed-note',
    kind: 'document',
    content: {
      ...content('Human saved text', 'Connected note'),
      relations: [
        {
          id: randomUUID(),
          predicate: 'source',
          target: { mode: 'pinned', objectId: source.id, revision: 1 },
        },
        {
          id: randomUUID(),
          predicate: 'belongs_to',
          target: { mode: 'current', objectId: project.id },
        },
      ],
    },
  }),
).object;
const hidden = value(
  human.createObject({
    operationKey: 'seed-hidden',
    kind: 'document',
    content: content('SYNTHETIC_OUTSIDE_SCOPE_BODY', 'SYNTHETIC_OUTSIDE_SCOPE_TITLE'),
  }),
).object;
const grant = value(
  human.createGrant({
    operationKey: 'scoped-grant',
    spec: {
      label: 'Relocated runtime test',
      scope: { mode: 'objects', objectIds: [source.id, project.id, note.id] },
      capabilities: { read: true, propose: true },
    },
  }),
);
assert.ok(grant.token);
tokens.push(grant.token);
const launch = [
  '--space',
  spaceDirectory,
  '--instance',
  value(human.status()).instanceId,
  '--grant',
  grant.grant.id,
];
const env = { ...baseEnv, AGENTSPACE_TOKEN: grant.token };
const cli = command(executable, ['--agent-cli', ...launch, '--tool', 'object_read'], {
  env,
  input: JSON.stringify({
    ref: { mode: 'pinned', objectId: source.id, revision: 1 },
    section: 'body',
    maxBytes: 65536,
  }),
});
assert.equal(value(JSON.parse(cli.stdout)).text, body);
const initial = value(human.status()),
  connections = [],
  eras = [];
const toolNames = [
  'space_discover',
  'objects_query',
  'object_read',
  'proposal_create',
  'changes_list',
  'operation_status',
  'schema_describe',
  'text_search',
  'relations_expand',
  'accepted_change_read',
].sort();
let current = note;
try {
  // Both live transports share one profile/path: ordinary GUI single-instance
  // locking must not claim or terminate either agent mode.
  for (const era of ['legacy', 'modern']) {
    const client = new Client(
      { name: 'Relocated package verification', version: '1.0.0' },
      { versionNegotiation: { mode: era === 'modern' ? { pin: '2026-07-28' } : 'legacy' } },
    );
    const transport = new StdioClientTransport({
      command: executable,
      args: ['--agent-server', ...launch],
      env,
      stderr: 'pipe',
    });
    let stderr = '';
    const errors = [];
    transport.stderr?.on('data', (part) => {
      stderr += part.toString();
      if (stderr.length > 65536) transport.close();
    });
    client.onerror = (error) => errors.push(error);
    connections.push({ client, transport, errors, stderr: () => stderr });
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), era);
    assert.equal(client.getServerVersion()?.version, pkg.version);
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), toolNames);
    eras.push(era);
  }
  assert.equal(
    value(human.status()).activitySequence,
    initial.activitySequence,
    'A connection/list operation is not fabricated tool activity.',
  );
  for (const connection of connections) {
    const call = async (name, args) => {
      const response = await connection.client.callTool({ name, arguments: args });
      const text = response.content.find((item) => item.type === 'text');
      assert.ok(text);
      const result = JSON.parse(text.text);
      assert.equal(typeof result.ok, 'boolean');
      assert.deepEqual(response.structuredContent, result);
      assert.equal(response.isError, !result.ok);
      const encoded = JSON.stringify(response);
      noSecrets(encoded);
      assert.ok(
        !encoded.includes(hidden.id) &&
          !encoded.includes(hidden.content.title) &&
          !encoded.includes(hidden.content.body),
        'Scope must not disclose hidden data.',
      );
      return result;
    };
    const era = connection.client.getProtocolEra();
    value(await call('space_discover', {}));
    assert.equal(
      value(await call('objects_query', { filter: {}, limit: 20, maxBytes: 8192 })).items.length,
      3,
    );
    value(await call('schema_describe', { kind: 'document', maxBytes: 8192 }));
    value(await call('text_search', { filter: { text: '知识' }, limit: 20, maxBytes: 8192 }));
    value(
      await call('relations_expand', {
        seedId: note.id,
        direction: 'outgoing',
        predicates: ['source', 'belongs_to'],
        maxDepth: 1,
        maxNodes: 10,
        maxEdges: 10,
        maxBytes: 8192,
      }),
    );
    let read = await call('object_read', {
      ref: { mode: 'current', objectId: source.id },
      section: 'body',
      maxBytes: 2048,
    });
    let text = '';
    while (true) {
      const page = value(read);
      assert.equal(page.ref.revision, 1);
      assert.ok(page.returnedBytes <= 2048);
      assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify(read)));
      text += page.text;
      if (!page.nextCursor) break;
      read = await call('object_read', { cursor: page.nextCursor, maxBytes: 2048 });
    }
    assert.equal(text, body);
    const forbidden = await call('object_read', {
      ref: { mode: 'current', objectId: hidden.id },
      section: 'body',
      maxBytes: 2048,
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.error.code, 'FORBIDDEN');
    const operationKey = 'proposal-' + era,
      proposedBody = 'Reviewable candidate from relocated ' + era;
    const candidate = value(
      await call('proposal_create', {
        operationKey,
        action: 'update',
        targetId: note.id,
        baseRevision: current.revision,
        patch: { body: proposedBody },
        purpose: 'Verify packaged ' + era,
        reason: 'Use the exact retained source',
        sources: [{ mode: 'pinned', objectId: source.id, revision: 1 }],
      }),
    );
    assert.equal(
      value(human.readObject({ objectId: note.id })).object.content.body,
      current.content.body,
      'A candidate must remain reviewable before human acceptance.',
    );
    const review = value(human.getProposal({ proposalId: candidate.id }));
    assert.equal(review.proposedContent.body, proposedBody);
    value(await call('operation_status', { operationKey }));
    const applied = value(
      human.reviewProposal({
        operationKey: 'accept-' + era,
        proposalId: candidate.id,
        expectedPayloadHash: candidate.payloadHash,
        expectedProposalVersion: candidate.statusVersion,
        decision: 'accept',
        expectedTarget: { state: 'revision', revision: current.revision },
      }),
    );
    assert.equal(applied.outcome, 'applied');
    current = applied.object;
    const accepted = value(
      await call('accepted_change_read', {
        changeId: applied.changeId,
        section: 'summary',
        maxBytes: 8192,
      }),
    );
    assert.equal(accepted.declared.reason, 'Use the exact retained source');
    value(
      await call('accepted_change_read', {
        changeId: applied.changeId,
        section: 'evidence',
        maxBytes: 8192,
      }),
    );
    value(await call('changes_list', { after: 0, limit: 50 }));
  }
} finally {
  for (const connection of connections) {
    await connection.client.close();
    noSecrets(connection.stderr());
    assert.equal(connection.errors.length, 0, 'No malformed protocol output.');
  }
  space.close();
}
const profileEntries = existsSync(profile) ? readdirSync(profile) : [];
assert.ok(
  !profileEntries.some((name) => /preferences|installation|singleton/i.test(name)),
  'Agent modes cannot create desktop preferences/identity/lock.',
);
const report = {
  format: 'agentspace-package-verification/v1',
  version: pkg.version,
  zipSha256,
  appAsarSha256: info.appAsarSha256,
  runtime,
  platform: 'darwin',
  arch: 'arm64',
  signature: 'ad-hoc',
  notarized: false,
  relocatedPathContainsSpaces: true,
  childPath: safePath,
  systemNodeResolvable: false,
  actualCli: true,
  protocolEras: eras,
  tools: toolNames,
  unicodePinnedPages: true,
  scopeDenial: true,
  reviewableProposals: true,
  noDesktopProfileOrLock: true,
  nativeUi: 'separate verification',
};
writeFileSync(
  join(root, 'release', name + '.verification.json'),
  JSON.stringify(report, null, 2) + '\n',
);
const privateReport = { ...report, app, executable, syntheticSpace: spaceDirectory, profile, work };
writeFileSync(join(parent, 'latest.json'), JSON.stringify(privateReport, null, 2) + '\n');
process.stdout.write(
  `Package verification passed: CLI; legacy/modern MCP; ten tools; exact Unicode; scope denial; reviewable proposals; ad-hoc signature and ASAR/ZIP hashes.\nMoved application: ${relative(root, app)}\nRuntime: Electron ${runtime.electron}, Node ${runtime.node}, SQLite ${runtime.sqlite}\nGUI acceptance remains separate.\n`,
);
