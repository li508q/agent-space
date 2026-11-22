import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

export const packageFormat = 'agentspace-production-build/v1';
export const hash = (data) => createHash('sha256').update(data).digest('hex');
export function relativeFile(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path === '..' ||
    path.startsWith('../')
  )
    throw new Error('Invalid package-relative path.');
  return path;
}
export function regularFile(root, path) {
  relativeFile(path);
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Package inputs cannot contain symlinks.');
  }
  if (!lstatSync(current).isFile()) throw new Error('Package input must be a regular file.');
  return current;
}
export function filesUnder(root, directory) {
  const found = [];
  function visit(path) {
    const file = join(root, path),
      stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Package inputs cannot contain symlinks.');
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(path + '/' + name);
    else if (stat.isFile()) found.push(path);
    else throw new Error('Unexpected package input type.');
  }
  visit(relativeFile(directory));
  return found;
}
export function sourceAllowed(path) {
  relativeFile(path);
  return (
    path === 'package.json' ||
    path === 'package-lock.json' ||
    path === 'scripts/build.mjs' ||
    path === 'scripts/package-inputs.mjs' ||
    path.startsWith('src/') ||
    path.startsWith('node_modules/')
  );
}
export function outputAllowed(path) {
  relativeFile(path);
  return (
    ['dist/desktop/main.cjs', 'dist/desktop/preload.cjs', 'dist/package/agent-index.js'].includes(
      path,
    ) ||
    /^dist\/renderer\/(?:[a-zA-Z0-9_@./-]+)\.(?:js|css|html|svg|png|jpg|jpeg|webp|woff2?|ttf)$/.test(
      path,
    )
  );
}
export function inspectBundle(kind, metafile) {
  if (!['main', 'preload', 'renderer', 'agent'].includes(kind))
    throw new Error('Unknown build target.');
  const inputs = Object.keys(metafile.inputs);
  for (const path of inputs)
    if (!sourceAllowed(path)) throw new Error('Unapproved source in application bundle: ' + path);
  for (const output of Object.values(metafile.outputs))
    for (const imported of output.imports ?? []) {
      if (
        imported.external &&
        !isBuiltin(imported.path) &&
        !(kind !== 'agent' && kind !== 'renderer' && imported.path === 'electron')
      )
        throw new Error('Unbundled runtime dependency: ' + imported.path);
    }
  return inputs;
}
export function productionManifest(root, { version, electronVersion, metafiles }) {
  const sources = new Set([
    'package.json',
    'package-lock.json',
    'scripts/build.mjs',
    'scripts/package-inputs.mjs',
    'src/renderer/index.html',
  ]);
  for (const [kind, meta] of Object.entries(metafiles))
    for (const path of inspectBundle(kind, meta)) sources.add(path);
  if (existsSync(join(root, 'src/renderer/assets')))
    for (const path of filesUnder(root, 'src/renderer/assets')) sources.add(path);
  const outputs = [
    'dist/desktop/main.cjs',
    'dist/desktop/preload.cjs',
    'dist/package/agent-index.js',
    ...filesUnder(root, 'dist/renderer'),
  ].sort();
  for (const path of outputs)
    if (!outputAllowed(path)) throw new Error('Unapproved production output: ' + path);
  const entry = (path) => ({ path, sha256: hash(readFileSync(regularFile(root, path))) });
  return {
    format: packageFormat,
    version,
    electronVersion,
    sources: [...sources].sort().map(entry),
    outputs: outputs.map(entry),
  };
}
export function validateProduction(root, manifest, pkg) {
  if (
    manifest?.format !== packageFormat ||
    manifest.version !== pkg.version ||
    manifest.electronVersion !== pkg.devDependencies.electron
  )
    throw new Error(
      'Production build does not match the pinned application. Run the production build.',
    );
  if (
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.outputs) ||
    manifest.sources.length > 10000 ||
    manifest.outputs.length > 1000
  )
    throw new Error('Invalid production manifest.');
  for (const [group, allowed] of [
    [manifest.sources, sourceAllowed],
    [manifest.outputs, outputAllowed],
  ]) {
    const unique = new Set();
    for (const entry of group) {
      if (
        !entry ||
        !allowed(entry.path) ||
        unique.has(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw new Error('Unapproved or duplicate package input.');
      unique.add(entry.path);
      if (hash(readFileSync(regularFile(root, entry.path))) !== entry.sha256)
        throw new Error('Production input changed; rebuild before packaging: ' + entry.path);
    }
  }
  for (const path of [
    'dist/desktop/main.cjs',
    'dist/desktop/preload.cjs',
    'dist/package/agent-index.js',
    'dist/renderer/main.js',
    'dist/renderer/index.html',
  ])
    if (!manifest.outputs.some((entry) => entry.path === path))
      throw new Error('Missing package entry: ' + path);
  if (!manifest.sources.some((e) => e.path === 'package.json'))
    throw new Error('Missing source identity.');
  return manifest;
}
export function stagedPath(path) {
  if (!outputAllowed(path)) throw new Error('Unapproved production output.');
  return path === 'dist/package/agent-index.js' ? 'dist/agent/adapters/index.js' : path;
}
export function thirdPartyNotices(root, manifest) {
  const packages = new Map();
  for (const { path } of manifest.sources.filter((e) => e.path.startsWith('node_modules/'))) {
    let folder = dirname(regularFile(root, path));
    const modules = resolve(root, 'node_modules');
    while (folder.startsWith(modules + sep)) {
      const metadata = join(folder, 'package.json');
      if (existsSync(metadata)) {
        const pkg = JSON.parse(readFileSync(metadata, 'utf8'));
        if (pkg.name && pkg.version) {
          const key = pkg.name + '@' + pkg.version;
          if (!packages.has(key)) {
            const licenses = readdirSync(folder)
              .filter(
                (name) =>
                  /^(licen[sc]e|notice|copying)(?:[.-]|$)/i.test(name) &&
                  lstatSync(join(folder, name)).isFile(),
              )
              .sort();
            if (!licenses.length) throw new Error('Missing bundled dependency license: ' + key);
            packages.set(
              key,
              [
                key,
                `License: ${typeof pkg.license === 'string' ? pkg.license : 'see text'}`,
                ...licenses.map((name) =>
                  readFileSync(
                    regularFile(root, relative(root, join(folder, name)).split(sep).join('/')),
                    'utf8',
                  ),
                ),
              ].join('\n\n'),
            );
          }
          break;
        }
      }
      folder = dirname(folder);
    }
  }
  return (
    'AgentSpace bundled JavaScript dependency notices\n\n' +
    [...packages.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, text]) => text)
      .join('\n\n' + '='.repeat(72) + '\n\n') +
    '\n'
  );
}
