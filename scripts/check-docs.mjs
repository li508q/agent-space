import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const languages = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const failures = [];
const files = [
  'README.md',
  'README.zh-CN.md',
  'README.ja.md',
  'README.ko.md',
  'README.es.md',
  'CONTRIBUTING.md',
];
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.md')) files.push(path);
  }
}
collect('docs');
for (const locale of languages) {
  if (!existsSync(resolve(root, 'docs/guides/' + locale + '.md')))
    failures.push('Missing usage guide: ' + locale);
}
for (const file of [...new Set(files)]) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) {
    failures.push('Missing document: ' + file);
    continue;
  }
  const content = readFileSync(absolute, 'utf8');
  if (/<!--\s*Publication draft/i.test(content)) failures.push(file + ': unpublished draft marker');
  if (/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/.test(content))
    failures.push(file + ': personal machine path');
  // Fence contents may contain example syntax rather than actual local links.
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  const targets = [
    ...[...prose.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)].map((m) => m[1]),
    ...[...prose.matchAll(/<(?:img|a)\b[^>]*(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  for (let target of targets) {
    target = target.trim().replace(/^<([^>]+)>$/, '$1');
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      failures.push(file + ': invalid link ' + target);
      continue;
    }
    const destination = resolve(dirname(absolute), decoded);
    const local = relative(root, destination);
    if (local.startsWith('..') || decoded.startsWith('/') || !existsSync(destination)) {
      failures.push(file + ': missing or nonportable link ' + target);
      continue;
    }
    if (extname(destination) === '.png' && statSync(destination).isFile()) {
      const bytes = readFileSync(destination);
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        failures.push(file + ': invalid PNG ' + target);
    }
  }
}
if (failures.length) {
  for (const failure of failures) process.stderr.write(failure + '\n');
  process.exitCode = 1;
} else
  process.stdout.write(
    'Five-language documents, local links, images and publication boundaries verified.\n',
  );
