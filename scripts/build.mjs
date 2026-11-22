import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function compile(config) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', config],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const desktopOnly = process.argv.includes('--desktop-only');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
compile('tsconfig.core.json');
if (existsSync(join(root, 'tsconfig.adapters.json'))) compile('tsconfig.adapters.json');
// Separate outputs prevent a desktop build from deleting another adapter/core build.
for (const target of ['dist/desktop', ...(desktopOnly ? [] : ['dist/renderer'])]) {
  rmSync(join(root, target), { recursive: true, force: true });
  mkdirSync(join(root, target), { recursive: true });
}
await build({
  absWorkingDir: root,
  entryPoints: ['src/desktop/main.ts'],
  outfile: 'dist/desktop/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  define: { __AGENTSPACE_VERSION__: JSON.stringify(version) },
  sourcemap: false,
  logLevel: 'info',
});
await build({
  absWorkingDir: root,
  entryPoints: ['src/desktop/preload.ts'],
  outfile: 'dist/desktop/preload.cjs',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'chrome156',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
});
if (desktopOnly) process.exit(0);
const htmlSource = join(root, 'src/renderer/index.html');
const reactSource = join(root, 'src/renderer/main.tsx');
if (!existsSync(htmlSource) || !existsSync(reactSource))
  throw new Error(
    'The assigned renderer entry is not available yet; no replacement interface is generated.',
  );
await build({
  absWorkingDir: root,
  entryPoints: ['src/renderer/main.tsx'],
  outdir: 'dist/renderer',
  entryNames: 'main',
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome156',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'file', '.png': 'file', '.woff2': 'file' },
  assetNames: 'assets/[name]-[hash]',
  sourcemap: false,
  logLevel: 'info',
});
let html = readFileSync(htmlSource, 'utf8');
// Security headers are controlled by main. Do not let a duplicate meta policy
// accidentally disable CodeMirror's dynamic styles or relax the script policy.
html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*['"]Content-Security-Policy['"][^>]*>/gi, '');
html = html.replace(/<script\b[^>]*src\s*=\s*(['"])[^'"]*main\.tsx\1[^>]*>\s*<\/script>/gi, '');
if (!/src\s*=\s*['"]\.?\/?main\.js['"]/.test(html))
  html = html.replace('</body>', '<script type="module" src="./main.js"></script>\n</body>');
if (
  existsSync(join(root, 'dist/renderer/main.css')) &&
  !/href\s*=\s*['"]\.?\/?main\.css['"]/.test(html)
)
  html = html.replace('</head>', '<link rel="stylesheet" href="./main.css">\n</head>');
writeFileSync(join(root, 'dist/renderer/index.html'), html);
if (existsSync(join(root, 'src/renderer/assets')))
  cpSync(join(root, 'src/renderer/assets'), join(root, 'dist/renderer/assets'), {
    recursive: true,
  });
