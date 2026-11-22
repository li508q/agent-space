import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Preferences } from '../../src/desktop/preferences.js';
import { Workspace } from '../../src/desktop/workspace.js';
import { CloseHandshake } from '../../src/desktop/close.js';
import { RendererAssets, safeExternalUrl, isAppDocument } from '../../src/desktop/security.js';
import { nativeDictionaries } from '../../src/desktop/native-copy.js';
import { launchConfiguration } from '../../src/desktop/agent-configuration.js';
import { input } from '../../src/desktop/validation.js';
import type { Result } from '../../src/contracts/errors.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(JSON.stringify(result));
  return result.value;
}
function temporary(t: { after(fn: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), 'agentspace-desktop-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('private preferences recover malformed presentation settings without touching spaces or rotating identity', (t) => {
  const root = temporary(t);
  const prefs = new Preferences(join(root, 'app-data'));
  const identity = prefs.installationNamespace;
  value(prefs.update({ locale: 'ja', textScale: 1.5, lastSpace: join(root, 'user-space') }));
  const reopened = new Preferences(prefs.directory);
  assert.deepEqual(reopened.public, { locale: 'ja', textScale: 1.5 });
  assert.equal(reopened.installationNamespace, identity);
  mkdirSync(join(root, 'user-space'));
  writeFileSync(join(root, 'user-space', 'preserved.md'), 'Original bytes');
  writeFileSync(prefs.filename, '{invalid preferences');
  const repaired = new Preferences(prefs.directory);
  assert.equal(repaired.startupError?.code, 'INTEGRITY_FAILURE');
  assert.equal(repaired.installationNamespace, identity);
  assert.equal(readFileSync(join(root, 'user-space', 'preserved.md'), 'utf8'), 'Original bytes');
  assert.equal(statSync(prefs.filename).mode & 0o777, 0o600);
});

test('A to B to A gets fresh bindings and rejects old requests while preserving canceled state', (t) => {
  const root = temporary(t);
  const prefs = new Preferences(join(root, 'app-data'));
  const spaces = new Workspace(prefs);
  t.after(() => spaces.close());
  const a = value(spaces.create(join(root, 'a'), 'A'));
  const oldRequest = {
    bindingId: a.bindingId,
    spaceId: a.status.spaceId,
    instanceId: a.status.instanceId,
    input: null,
  };
  assert.equal(spaces.validate(oldRequest).ok, true);
  value(spaces.create(join(root, 'b'), 'B'));
  const again = value(spaces.open(join(root, 'a')));
  assert.equal(again.status.spaceId, a.status.spaceId);
  assert.notEqual(again.bindingId, a.bindingId);
  const stale = spaces.validate(oldRequest);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'SPACE_MISMATCH');
  const before = spaces.session;
  const failed = spaces.open(join(root, 'missing'));
  assert.equal(failed.ok, false);
  assert.deepEqual(spaces.session, before);
});

test('renderer asset manifest rejects other origins, traversal, sources, preload and non-read methods', async (t) => {
  const root = temporary(t);
  const renderer = join(root, 'renderer');
  mkdirSync(renderer);
  writeFileSync(join(renderer, 'index.html'), '<html>Real test asset</html>');
  writeFileSync(join(renderer, 'main.js'), 'export {};');
  writeFileSync(join(root, 'preload.cjs'), 'not a renderer asset');
  const assets = new RendererAssets(renderer);
  const valid = await assets.respond({ url: 'agentspace://app/index.html', method: 'GET' });
  assert.equal(valid.status, 200);
  assert.ok(valid.headers.get('Content-Security-Policy')?.includes("script-src 'self'"));
  for (const url of [
    'agentspace://other/index.html',
    'agentspace://app/../preload.cjs',
    'agentspace://app/%252e%252e/preload.cjs',
    'agentspace://app/..%5cpreload.cjs',
    'agentspace://app/main.ts',
    'file:///index.html',
  ])
    assert.notEqual((await assets.respond({ url, method: 'GET' })).status, 200);
  assert.equal(
    (await assets.respond({ url: 'agentspace://app/index.html', method: 'POST' })).status,
    403,
  );
  assert.equal(isAppDocument('agentspace://app/index.html'), true);
  assert.equal(isAppDocument('agentspace://other/index.html'), false);
});

test('close nonces never authorize a stale binding or a guessed request', () => {
  const close = new CloseHandshake();
  const first = close.begin('a');
  assert.equal(close.valid(first.requestId, 'a'), true);
  assert.equal(close.valid(first.requestId, 'b'), false);
  assert.equal(close.valid('guessed', 'a'), false);
  assert.deepEqual(close.cancel(), first);
  assert.equal(close.cancel(), null, 'A canceled nonce has one terminal event identity');
  assert.equal(close.valid(first.requestId, 'a'), false);
  assert.notEqual(close.begin('a').requestId, first.requestId);
});

test('platform input bounds non-JSON graphs and all native-only copy covers five locales', () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const invalid of [cycle, 1n, undefined]) assert.equal(input(z.unknown(), invalid).ok, false);
  assert.equal(input(z.strictObject({ a: z.number() }), { a: 1, extra: true }).ok, false);
  const keys = Object.keys(nativeDictionaries.en).sort();
  for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'es'] as const) {
    assert.deepEqual(Object.keys(nativeDictionaries[locale]).sort(), keys);
    assert.ok(Object.values(nativeDictionaries[locale]).every((v) => v.length > 0));
  }
  for (const url of [
    'file:///tmp/input',
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:password@example.test/',
  ])
    assert.equal(safeExternalUrl(url), null);
  assert.equal(safeExternalUrl('https://example.test/page'), 'https://example.test/page');
});

test('generated launch parameters use executable/bundled mode and keep token out of argv', () => {
  const config = launchConfiguration({
    executable: '/Applications/AgentSpace.app/Contents/MacOS/AgentSpace',
    mainEntry: '/dev/main.cjs',
    packaged: true,
    space: '/local/space with quotes "',
    instanceId: 'instance',
    grantId: 'grant',
    token: 'one-time-secret',
    tokenEnv: 'AGENTSPACE_TOKEN',
  });
  assert.equal(config.args[0], '--agent-server');
  assert.equal(config.args.includes('one-time-secret'), false);
  assert.equal(config.env.AGENTSPACE_TOKEN, 'one-time-secret');
  assert.deepEqual(JSON.parse(config.stdioJson), {
    command: config.command,
    args: config.args,
    env: config.env,
  });
  assert.ok(config.codexToml.includes('[mcp_servers.agent_space.env]'));
});
