import { mkdtempSync, readFileSync, copyFileSync, rmSync, mkdirSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'assets/packaging');
const args = process.argv.slice(2);
if (args.length) throw new Error('make-icon accepts no arguments.');
if (process.platform !== 'darwin') throw new Error('The native icon converter requires macOS.');
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed.`);
}
const work = mkdtempSync(join(tmpdir(), 'agentspace-icon-'));
try {
  const png = join(work, 'AppIcon.png');
  run('/usr/bin/xcrun', [
    'swift',
    join(root, 'scripts/render-icon.swift'),
    join(destination, 'AppIcon.svg'),
    png,
  ]);
  const header = readFileSync(png);
  if (header.readUInt32BE(16) !== 1024 || header.readUInt32BE(20) !== 1024)
    throw new Error('Invalid icon size.');
  const set = join(work, 'AppIcon.iconset');
  mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2]) {
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('/usr/bin/sips', [
        '-z',
        String(size * scale),
        String(size * scale),
        png,
        '--out',
        join(set, filename),
      ]);
    }
  const icns = join(work, 'AppIcon.icns');
  run('/usr/bin/iconutil', ['-c', 'icns', set, '-o', icns]);
  if (readFileSync(icns).subarray(0, 4).toString() !== 'icns')
    throw new Error('Invalid ICNS output.');
  for (const [from, name] of [
    [png, 'AppIcon.png'],
    [icns, 'AppIcon.icns'],
  ]) {
    const target = join(destination, name);
    try {
      if (lstatSync(target).isSymbolicLink())
        throw new Error('Icon destination cannot be a symlink.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    copyFileSync(from, target);
  }
  process.stdout.write(
    'Generated AppIcon.png and AppIcon.icns from the original SVG using macOS tools.\n',
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
