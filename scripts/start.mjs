import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(join(root, 'dist/desktop/main.cjs')))
  throw new Error('Run npm run build before starting the desktop.');
const require = createRequire(import.meta.url);
const executable = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  process.stderr.write(String(error.code ?? 'DESKTOP_START_FAILED') + '\n');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
