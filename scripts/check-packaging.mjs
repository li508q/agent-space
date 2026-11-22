import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import {
  hash,
  packageFormat,
  relativeFile,
  outputAllowed,
  regularFile,
  inspectBundle,
  validateProduction,
  stagedPath,
} from './package-inputs.mjs';

// Package input-boundary checks only. No build, Electron app packaging or launch.
const repo = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
assert.equal(pkg.devDependencies['@electron/packager'], '20.3.0');
assert.equal(pkg.devDependencies['@electron/asar'], '4.3.2');
assert.equal(typeof packager, 'function');
assert.equal(
  JSON.parse(readFileSync(join(repo, 'node_modules/@electron/packager/package.json'), 'utf8'))
    .version,
  '20.3.0',
);
assert.equal(
  JSON.parse(readFileSync(join(repo, 'node_modules/@electron/asar/package.json'), 'utf8')).version,
  '4.3.2',
);
assert.equal(
  readFileSync(join(repo, 'assets/packaging/AppIcon.icns')).subarray(0, 4).toString(),
  'icns',
);
const root = mkdtempSync(join(tmpdir(), 'agentspace-package-inputs-'));
try {
  const files = [
    'package.json',
    'dist/desktop/main.cjs',
    'dist/desktop/preload.cjs',
    'dist/package/agent-index.js',
    'dist/renderer/index.html',
    'dist/renderer/main.js',
    'dist/renderer/main.css',
  ];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), file);
  }
  const entry = (path) => ({ path, sha256: hash(readFileSync(join(root, path))) });
  const manifest = {
    format: packageFormat,
    version: pkg.version,
    electronVersion: pkg.devDependencies.electron,
    sources: [entry('package.json')],
    outputs: files.filter((f) => f !== 'package.json').map(entry),
  };
  validateProduction(root, manifest, pkg);
  assert.equal(stagedPath('dist/package/agent-index.js'), 'dist/agent/adapters/index.js');
  assert.equal(stagedPath('dist/desktop/main.cjs'), 'dist/desktop/main.cjs');
  for (const unsafe of [
    '../private.txt',
    '/absolute.txt',
    'dist/renderer/../private.js',
    'dist\\renderer\\main.js',
    'dist/renderer/x\0.js',
  ])
    assert.throws(() => relativeFile(unsafe));
  for (const unsafe of [
    '.coordination/secret.txt',
    'tests/private.js',
    'node_modules/package/index.js',
    'dist/core/index.js',
    'dist/renderer/data.sqlite',
    'dist/renderer/main.js.map',
  ])
    assert.equal(outputAllowed(unsafe), false);
  assert.throws(() => validateProduction(root, { ...manifest, version: '9.9.9' }, pkg));
  assert.throws(() =>
    validateProduction(
      root,
      { ...manifest, outputs: [...manifest.outputs, manifest.outputs[0]] },
      pkg,
    ),
  );
  assert.throws(() =>
    validateProduction(
      root,
      {
        ...manifest,
        outputs: manifest.outputs.filter((e) => e.path !== 'dist/package/agent-index.js'),
      },
      pkg,
    ),
  );
  assert.throws(() =>
    validateProduction(
      root,
      {
        ...manifest,
        outputs: [
          ...manifest.outputs,
          { path: '.coordination/private.txt', sha256: '0'.repeat(64) },
        ],
      },
      pkg,
    ),
  );
  writeFileSync(join(root, 'dist/renderer/main.js'), 'changed after build');
  assert.throws(() => validateProduction(root, manifest, pkg));
  symlinkSync(join(root, 'package.json'), join(root, 'link.json'));
  assert.throws(() => regularFile(root, 'link.json'));
  const meta = (imports) => ({
    inputs: { 'src/adapters/index.ts': {} },
    outputs: { 'dist/package/agent-index.js': { imports } },
  });
  inspectBundle('agent', meta([{ path: 'node:sqlite', external: true }]));
  assert.throws(() => inspectBundle('agent', meta([{ path: 'zod', external: true }])));
  assert.throws(() => inspectBundle('agent', meta([{ path: 'electron', external: true }])));
  assert.throws(() => inspectBundle('agent', { inputs: { 'tests/private.ts': {} }, outputs: {} }));
  inspectBundle(
    'main',
    meta([
      { path: 'electron', external: true },
      { path: 'node:fs', external: true },
    ]),
  );
  assert.throws(() => inspectBundle('renderer', meta([{ path: 'electron', external: true }])));
  process.stdout.write(
    'Packaging input checks passed: pinned tools, native icon, strict allowlist, hashes/freshness, symlink/traversal rejection and bundled dependency boundary. No build/package/GUI performed.\n',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
