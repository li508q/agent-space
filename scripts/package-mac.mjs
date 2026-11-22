import { packager } from '@electron/packager';
import { listPackage, extractFile, statFile } from '@electron/asar';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  copyFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateProduction,
  regularFile,
  stagedPath,
  thirdPartyNotices,
  hash,
} from './package-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2),
  allowed = ['--skip-build', '--check', '--help'];
if (args.some((arg) => !allowed.includes(arg)) || new Set(args).size !== args.length)
  throw new Error('Use package-mac with --skip-build, --check or --help.');
if (args.includes('--help')) {
  process.stdout.write(
    'package:mac builds and packages macOS arm64 under release/. --skip-build requires an unchanged production manifest. --check validates existing production inputs without building or packaging.\n',
  );
  process.exit(0);
}
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This package target is validated only on an Apple Silicon macOS host.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (
  pkg.name !== 'agent-space' ||
  pkg.productName !== 'AgentSpace' ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version) ||
  !/^\d+\.\d+\.\d+$/.test(pkg.devDependencies.electron)
)
  throw new Error('Invalid fixed application identity/version.');
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0)
    throw new Error(result.stderr || `${command} failed (${result.status}).`);
  return result;
}
function script(name, ...argv) {
  run(process.execPath, [join(root, 'scripts', name), ...argv], { stdio: 'inherit' });
}
if (!args.includes('--check') && !args.includes('--skip-build'))
  script('build.mjs', '--production');
const manifest = validateProduction(
  root,
  JSON.parse(readFileSync(join(root, 'dist/package/build.json'), 'utf8')),
  pkg,
);
regularFile(root, 'LICENSE');
regularFile(root, 'assets/packaging/AppIcon.icns');
regularFile(root, 'assets/packaging/entitlements.plist');
const notices = thirdPartyNotices(root, manifest);
if (args.includes('--check')) {
  process.stdout.write(
    `Production inputs verified: ${manifest.outputs.length} allowlisted files; bundled dependency notices resolved. No package created.\n`,
  );
  process.exit(0);
}
const release = join(root, 'release'),
  name = `AgentSpace-${pkg.version}-macOS-arm64`,
  destination = join(release, name),
  zip = join(release, name + '.zip');
mkdirSync(release, { recursive: true });
if (lstatSync(release).isSymbolicLink()) throw new Error('release cannot be a symlink.');
for (const path of [destination, zip])
  if (existsSync(path))
    throw new Error(
      'Release output already exists; preserve or move the previous artifact before rebuilding this version.',
    );
const work = mkdtempSync(join(release, '.package-'));
try {
  const stage = join(work, 'source');
  mkdirSync(stage);
  const metadata = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    type: 'module',
    main: 'dist/desktop/main.cjs',
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
  };
  writeFileSync(join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices);
  const expected = new Map([
    ['package.json', hash(readFileSync(join(stage, 'package.json')))],
    ['LICENSE', hash(readFileSync(join(stage, 'LICENSE')))],
    ['THIRD_PARTY_NOTICES.txt', hash(notices)],
  ]);
  for (const entry of manifest.outputs) {
    const relative = stagedPath(entry.path),
      target = join(stage, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(regularFile(root, entry.path), target);
    if (hash(readFileSync(target)) !== entry.sha256) throw new Error('Staging checksum mismatch.');
    expected.set(relative, entry.sha256);
  }
  const outputs = await packager({
    dir: stage,
    name: 'AgentSpace',
    executableName: 'AgentSpace',
    appBundleId: 'io.github.li508q.agentspace',
    appCategoryType: 'public.app-category.productivity',
    appCopyright: 'Copyright © 2026 AgentSpace contributors',
    appVersion: pkg.version,
    buildVersion: pkg.version,
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: pkg.devDependencies.electron,
    icon: join(root, 'assets/packaging/AppIcon.icns'),
    out: join(work, 'output'),
    tmpdir: join(work, 'packager'),
    overwrite: false,
    asar: true,
    asarIntegrityDigest: true,
    prune: false,
    derefSymlinks: false,
    download: { cacheRoot: join(release, '.electron-cache') },
    osxSign: {
      identity: '-',
      identityValidation: false,
      type: 'development',
      continueOnError: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile: () => ({
        entitlements: join(root, 'assets/packaging/entitlements.plist'),
        hardenedRuntime: false,
        timestamp: 'none',
      }),
    },
  });
  if (outputs.length !== 1) throw new Error('Expected one macOS arm64 application.');
  const output = outputs[0],
    app = join(output, 'AgentSpace.app'),
    archive = join(app, 'Contents/Resources/app.asar');
  const packedFiles = listPackage(archive, { isPack: false }).filter(
    (path) => !('files' in statFile(archive, path.replace(/^\//, ''), false)),
  );
  if (packedFiles.length !== expected.size)
    throw new Error('Unexpected application archive file count.');
  for (const absolute of packedFiles) {
    const path = absolute.replace(/^\//, '');
    const info = statFile(archive, path, false);
    if (
      'link' in info ||
      info.unpacked ||
      !expected.has(path) ||
      hash(extractFile(archive, path)) !== expected.get(path)
    )
      throw new Error('Application archive allowlist/hash check failed.');
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', app]);
  if (!/Signature=adhoc/.test(signature.stderr))
    throw new Error('Expected explicit ad-hoc signature.');
  const plist = join(app, 'Contents/Info.plist');
  const bundleId = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    plist,
  ]).stdout.trim();
  if (bundleId !== 'io.github.li508q.agentspace') throw new Error('Unexpected app bundle ID.');
  const info = {
    format: 'agentspace-macos-package/v1',
    version: pkg.version,
    electronVersion: pkg.devDependencies.electron,
    platform: 'darwin',
    arch: 'arm64',
    bundleId,
    signature: 'ad-hoc',
    developerId: false,
    notarized: false,
    hardenedRuntime: false,
    appAsarSha256: hash(readFileSync(archive)),
    applicationFiles: expected.size,
    runtimeDependencies: 'bundled',
    acceptance: 'separate; see verification evidence for this artifact',
  };
  writeFileSync(join(output, 'BUILDINFO.json'), JSON.stringify(info, null, 2) + '\n');
  copyFileSync(join(root, 'assets/packaging/START.md'), join(output, 'START.md'));
  const archiveRoot = join(work, name);
  renameSync(output, archiveRoot);
  const pendingZip = join(work, name + '.zip');
  // ditto preserves framework symlinks, permissions and macOS resource metadata.
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', archiveRoot, pendingZip]);
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(pendingZip)) checksum.update(chunk);
  const sum = checksum.digest('hex');
  renameSync(archiveRoot, destination);
  renameSync(pendingZip, zip);
  writeFileSync(join(release, name + '.sha256'), sum + '  ' + name + '.zip\n');
  writeFileSync(join(release, 'SHA256SUMS'), sum + '  ' + name + '.zip\n');
  process.stdout.write(
    `Created release/${name}/AgentSpace.app and ${name}.zip\nAd-hoc signed; no Developer ID or notarization. Relocated runtime/native acceptance is still required.\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
