import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  scanImport,
  compileImport,
  captureImportItem,
  importManifestDigest,
  readPreview,
} from '../../src/core/local/import-scan.js';
import type { Result } from '../../src/contracts/errors.js';
import type { HumanServices } from '../../src/contracts/core.js';
import type {
  ImportItemResult,
  ImportManifest,
  PreparedImport,
} from '../../src/contracts/local.js';
import { digest } from '../../src/core/support.js';
import { createBackup } from '../../src/core/local/artifacts.js';
import { content, error, fixture, id, ok } from './helpers.js';

function approve(plan: PreparedImport, h: HumanServices, key: string) {
  const manifest = compileImport(
    plan,
    {
      operationKey: key,
      planId: plan.id,
      expectedPlanDigest: plan.digest,
      groups: plan.groups.map((g) => ({ groupId: g.id, title: g.title })),
      choices: plan.sources
        .filter((s) => ['text', 'repository', 'file-reference'].includes(s.entry.kind))
        .map((s) => ({
          itemId: s.entry.id,
          action: s.entry.suggestedAction,
          project: s.entry.groupId ? { mode: 'group', groupId: s.entry.groupId } : { mode: 'none' },
          useAssetIds: [],
        })),
    },
    ok(h.status()),
  );
  const hash = importManifestDigest(manifest);
  ok(h.startImport({ operationKey: key, manifest, expectedManifestDigest: hash }));
  return { manifest, hash };
}
function step(h: HumanServices, m: ImportManifest, position: number) {
  const approved = m.items[position]!;
  const page = ok(h.getImport({ runId: m.id, limit: 50, maxBytes: 65536 }));
  const body = captureImportItem(approved);
  return h.commitImportItem({
    operationKey: page.items.find((i) => i.id === approved.id)!.operationKey,
    runId: m.id,
    expectedManifestDigest: digest(m),
    itemId: approved.id,
    ...(body !== undefined ? { body } : {}),
    capturedDigest: body === undefined ? null : approved.rawDigest,
  });
}

test('import preview distinguishes identical names with recorded source locations within its byte budget', async (t) => {
  const f = fixture(t);
  const paths = ['First area', 'Second area'].map((area) => {
    const directory = join(f.root, area, '项目 café');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'notes.md');
    writeFileSync(path, `# ${area}\nIndependent source`);
    return path;
  });
  const plan = ok(
    await scanImport({
      selections: paths.map((path) => ({ path })),
      profileId: 'plain-files/v1',
    }),
  );
  const before = structuredClone(plan);
  const locations: Array<string | null> = [];
  let offset = 0;
  do {
    const page = readPreview(plan, offset, 2048);
    assert.equal(page.planDigest, plan.digest);
    assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify({ ok: true, value: page })));
    assert.ok(page.returnedBytes <= 2048);
    for (const entry of page.entries) {
      assert.equal(entry.relativePath, 'notes.md');
      assert.equal(entry.sourceLocation, plan.sources.find((s) => s.entry.id === entry.id)!.path);
      locations.push(entry.sourceLocation);
    }
    offset = page.nextCursor ? Number(page.nextCursor) : -1;
  } while (offset >= 0);
  assert.deepEqual(locations, paths);
  assert.deepEqual(plan, before);
  assert.deepEqual(
    paths.map((path) => readFileSync(path, 'utf8')),
    ['# First area\nIndependent source', '# Second area\nIndependent source'],
  );
});

test('legacy folder preview is bounded, source read only; confirmed import resumes and deduplicates without overwriting later edits', async (t) => {
  const f = fixture(t);
  const source = join(f.root, 'incoming');
  for (const dir of [
    'knowledge',
    'projects/Orchid',
    'repos/work/.git',
    'repos/work/src',
    'node_modules/ignored',
    'build',
  ])
    mkdirSync(join(source, dir), { recursive: true });
  const body = '\uFEFF# 中文 / 日本語 / 한국어\r\n\nÉvidence🙂';
  writeFileSync(join(source, 'knowledge/facts.md'), body);
  writeFileSync(join(source, 'projects/Orchid/HANDOFF.md'), '# Handoff\nHuman remains the owner');
  writeFileSync(join(source, 'repos/work/src/code.ts'), 'const ignored = true;');
  writeFileSync(join(source, 'node_modules/ignored/no.md'), 'Must not traverse');
  writeFileSync(join(source, 'build/no.md'), 'Must not traverse');
  writeFileSync(join(source, 'reference.pdf'), '%PDF synthetic reference');
  symlinkSync(join(source, 'knowledge'), join(source, 'linked'));
  const sourceBefore = readFileSync(join(source, 'knowledge/facts.md'));
  const plan = ok(
    await scanImport({ selections: [{ path: source }], profileId: 'knowledge-project-repos/v1' }),
  );
  assert.equal(plan.sources.filter((s) => s.entry.kind === 'text').length, 2);
  assert.equal(plan.sources.filter((s) => s.entry.kind === 'repository').length, 1);
  assert.equal(plan.groups.length, 1);
  assert.equal(
    ok(
      await scanImport({
        selections: [{ path: join(source, 'projects') }],
        profileId: plan.profileId,
      }),
    ).groups.length,
    1,
  );
  assert.equal(
    ok(
      await scanImport({
        selections: [{ path: join(source, 'projects/Orchid') }],
        profileId: plan.profileId,
      }),
    ).groups.length,
    1,
  );
  assert.ok(plan.sources.some((s) => s.entry.issue === 'symlink'));
  assert.ok(
    !plan.sources.some((s) => s.entry.relativePath.includes('code.ts') || s.entry.title === 'no'),
  );
  let offset = 0,
    rows = 0;
  do {
    const page = readPreview(plan, offset, 2048);
    assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify({ ok: true, value: page })));
    assert.ok(page.returnedBytes <= 2048);
    assert.ok(page.groups.every((g) => page.entries.some((e) => e.groupId === g.id)));
    rows += page.entries.length;
    offset = page.nextCursor ? Number(page.nextCursor) : -1;
  } while (offset >= 0);
  assert.equal(rows, plan.sources.length);
  const { manifest, hash } = approve(plan, f.human, 'import:first');
  assert.equal(ok(f.human.status()).authoritySequence, 0);
  ok(step(f.human, manifest, 0));
  ok(
    f.human.pauseImport({
      operationKey: 'pause',
      runId: manifest.id,
      expectedManifestDigest: hash,
    }),
  );
  f.space.close();
  const h = f.open().human('desktop-installation');
  const paused = ok(h.getImport({ runId: manifest.id, limit: 50, maxBytes: 65536 }));
  assert.equal(paused.run.state, 'paused');
  assert.equal(paused.items[0]!.state, 'committed');
  const resume = { operationKey: 'resume', runId: manifest.id, expectedManifestDigest: hash };
  ok(h.resumeImport(resume));
  for (let i = 1; i < manifest.items.length; i++)
    assert.equal(ok(step(h, manifest, i)).state, 'committed');
  assert.equal(
    ok(h.getImport({ runId: manifest.id, limit: 50, maxBytes: 65536 })).run.state,
    'finished',
  );
  assert.deepEqual(readFileSync(join(source, 'knowledge/facts.md')), sourceBefore);
  const fact = manifest.items.find((i) => i.sourcePath?.endsWith('facts.md'))!;
  const imported = ok(h.readObject({ objectId: fact.targetId })).object;
  assert.equal(imported.content.body, body);
  assert.equal(imported.knowledgeReview, null);
  ok(
    h.saveObject({
      operationKey: 'human-edit',
      targetId: imported.id,
      expectedRevision: 1,
      content: content('Human correction', imported.content.title),
    }),
  );
  const again = approve(
    ok(await scanImport({ selections: [{ path: source }], profileId: plan.profileId })),
    h,
    'import:again',
  );
  for (let i = 0; i < again.manifest.items.length; i++)
    assert.equal(ok(step(h, again.manifest, i)).state, 'reused');
  assert.equal(
    ok(h.readObject({ objectId: fact.targetId })).object.content.body,
    'Human correction',
  );
  assert.equal(
    ok(h.query({ filter: {}, limit: 50, maxBytes: 65536 })).items.length,
    manifest.items.length,
  );
  // A newly observed source version creates a separate copy; it does not overwrite the correction.
  writeFileSync(join(source, 'knowledge/facts.md'), 'Changed by the original knowledge tool');
  const changed = approve(
    ok(await scanImport({ selections: [{ path: source }], profileId: plan.profileId })),
    h,
    'import:changed',
  );
  for (let i = 0; i < changed.manifest.items.length; i++) ok(step(h, changed.manifest, i));
  const handoff = manifest.items.find((i) => i.sourcePath?.endsWith('HANDOFF.md'))!;
  const group = manifest.items.find((i) => i.action === 'project-group')!;
  assert.equal(
    ok(h.readObject({ objectId: handoff.targetId })).relationTargets[0]?.resolved?.objectId,
    group.targetId,
  );
  assert.equal(
    ok(h.readObject({ objectId: fact.targetId })).object.content.body,
    'Human correction',
  );
  assert.equal(
    ok(h.query({ filter: {}, limit: 50, maxBytes: 65536 })).items.length,
    manifest.items.length + 1,
  );
  // The verified full backup includes committed/reused journals and their exact original receipts.
  ok(
    await createBackup(f.directory, {
      operationId: id(999),
      destination: join(f.root, 'imported-backup'),
    }),
  );
});

test('two competing confirmed runs claim one source version through the same transaction guard', async (t) => {
  const f = fixture(t),
    source = join(f.root, 'source.md');
  writeFileSync(source, 'Same source bytes');
  const make = async (key: string) =>
    approve(
      ok(await scanImport({ selections: [{ path: source }], profileId: 'plain-files/v1' })),
      f.human,
      key,
    );
  const first = await make('first'),
    second = await make('second');
  const worker = (m: ImportManifest, name: string) =>
    new Promise<string>((resolve, reject) => {
      const item = m.items[0]!,
        file = join(f.root, name + '.json');
      writeFileSync(
        file,
        JSON.stringify({
          operationKey: `imp:${m.id}:${item.id}:0`,
          runId: m.id,
          expectedManifestDigest: digest(m),
          itemId: item.id,
          body: captureImportItem(item),
          capturedDigest: item.rawDigest,
        }),
      );
      const p = spawn(
        process.execPath,
        ['tests/core/local-worker.mjs', f.directory, file, 'reply'],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '',
        err = '';
      p.stdout.on('data', (b) => (out += String(b)));
      p.stderr.on('data', (b) => (err += String(b)));
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
    });
  const results = (
    await Promise.all([worker(first.manifest, 'one'), worker(second.manifest, 'two')])
  ).map((s) => ok(JSON.parse(s) as Result<ImportItemResult>));
  assert.deepEqual(results.map((r) => r.state).sort(), ['committed', 'reused']);
  assert.deepEqual(results[0]!.originalRef, results[1]!.originalRef);
  assert.equal(ok(f.human.status()).authoritySequence, 1);
});

test('source change requires new approval; failure/retry results and fresh-install authorization are durable', async (t) => {
  const f = fixture(t),
    source = join(f.root, 'note.md');
  writeFileSync(source, 'Before');
  const plan = ok(
    await scanImport({ selections: [{ path: source }], profileId: 'plain-files/v1' }),
  );
  const { manifest, hash } = approve(plan, f.human, 'approve');
  writeFileSync(source, 'After');
  assert.throws(() => captureImportItem(manifest.items[0]!), /IMPORT_SOURCE_CHANGED/);
  const p = {
    operationKey: `imp:${manifest.id}:${manifest.items[0]!.id}:0`,
    runId: manifest.id,
    expectedManifestDigest: hash,
    itemId: manifest.items[0]!.id,
    capturedDigest: null,
    captureError: 'IMPORT_SOURCE_CHANGED' as const,
  };
  const failed = ok(f.human.commitImportItem(p));
  assert.equal(failed.state, 'failed');
  assert.equal(ok(f.human.status()).authoritySequence, 0);
  assert.equal(
    ok(f.human.getImport({ runId: manifest.id, limit: 10, maxBytes: 65536 })).run.state,
    'needs-repreview',
  );
  assert.deepEqual(ok(f.human.commitImportItem(p)), failed);
  error(
    f.human.retryImport({
      operationKey: 'retry',
      runId: manifest.id,
      expectedManifestDigest: hash,
      itemIds: [p.itemId],
    }),
    'IMPORT_SOURCE_CHANGED',
  );
  const other = f.space.human('new-installation');
  assert.equal(
    ok(other.getImport({ runId: manifest.id, limit: 10, maxBytes: 65536 })).run
      .needsSourceConfirmation,
    true,
  );
  error(
    other.resumeImport({
      operationKey: 'resume',
      runId: manifest.id,
      expectedManifestDigest: hash,
    }),
    'IMPORT_SOURCE_CHANGED',
  );
  // Read-only list/status are not content authority changes.
  assert.equal(ok(f.human.status()).authoritySequence, 0);
});

test('two real processes recover the same import receipt exactly once after caller exit', async (t) => {
  const f = fixture(t),
    source = join(f.root, 'source.md');
  writeFileSync(source, 'A shared source');
  const { manifest, hash } = approve(
    ok(await scanImport({ selections: [{ path: source }], profileId: 'plain-files/v1' })),
    f.human,
    'approve',
  );
  const item = manifest.items[0]!;
  const request = {
    operationKey: `imp:${manifest.id}:${item.id}:0`,
    runId: manifest.id,
    expectedManifestDigest: hash,
    itemId: item.id,
    body: captureImportItem(item),
    capturedDigest: item.rawDigest,
  };
  const requestFile = join(f.root, 'request.json');
  writeFileSync(requestFile, JSON.stringify(request));
  const worker = (silent = false) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['tests/core/local-worker.mjs', f.directory, requestFile, silent ? 'silent' : 'reply'],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '',
        err = '';
      child.stdout.on('data', (b) => (out += String(b)));
      child.stderr.on('data', (b) => (err += String(b)));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
    });
  await worker(true); // Commit survived; response deliberately not delivered.
  const [a, b] = await Promise.all([worker(), worker()]);
  assert.deepEqual(JSON.parse(a), JSON.parse(b));
  assert.equal(ok(f.human.status()).authoritySequence, 1);
  assert.equal(ok(f.human.history({ objectId: item.targetId, limit: 10 })).items.length, 1);
  error(f.human.commitImportItem({ ...request, body: 'Different' }), 'IDEMPOTENCY_KEY_REUSED');
});

test('archive/restore query is human-only, relink preserves identity and requires explicit reversal', (t) => {
  const f = fixture(t);
  const made = ok(
    f.human.createObject({
      operationKey: 'asset',
      id: id(7),
      kind: 'asset',
      content: content('', 'Repository'),
      origin: { mode: 'external-reference', label: 'Repository', locator: '/synthetic/old' },
    }),
  );
  const relinked = ok(
    f.human.relinkExternalAsset({
      operationKey: 'relink',
      objectId: made.object.id,
      expectedRevision: 1,
      locator: '/synthetic/new',
      observedAt: new Date().toISOString(),
    }),
  );
  assert.equal(relinked.object.id, made.object.id);
  assert.equal(
    ok(f.human.readObject({ objectId: made.object.id, revision: 1 })).object.origin.locator,
    '/synthetic/old',
  );
  error(
    f.human.undoChange({
      operationKey: 'undo-relink',
      changeId: relinked.changeId!,
      expectedRevision: 2,
    }),
    'UNDO_NOT_SUPPORTED',
  );
  const archived = ok(
    f.human.setLifecycle({
      operationKey: 'archive',
      objectId: made.object.id,
      expectedRevision: 2,
      lifecycle: 'archived',
    }),
  );
  assert.equal(ok(f.human.query({ filter: {}, limit: 10, maxBytes: 65536 })).items.length, 0);
  assert.equal(
    ok(
      f.human.query({
        filter: { lifecycle: 'archived', text: 'repository' },
        limit: 10,
        maxBytes: 65536,
      }),
    ).items.length,
    1,
  );
  assert.equal(
    ok(f.human.query({ filter: { lifecycle: 'all' }, limit: 10, maxBytes: 65536 })).items.length,
    1,
  );
  const restored = ok(
    f.human.setLifecycle({
      operationKey: 'restore',
      objectId: made.object.id,
      expectedRevision: archived.object.revision,
      lifecycle: 'active',
    }),
  );
  assert.equal(restored.object.revision, 4);
  error(
    f.human.setLifecycle({
      operationKey: 'stale',
      objectId: made.object.id,
      expectedRevision: 2,
      lifecycle: 'archived',
    }),
    'STALE_REVISION',
  );
});

test('scanner enforces depth/visit/object/text limits and exposes unsupported bytes as explicit references', async (t) => {
  const f = fixture(t),
    root = join(f.root, 'sources');
  mkdirSync(root);
  writeFileSync(join(root, 'broken.md'), Buffer.from([0xff, 0xfe]));
  writeFileSync(join(root, 'binary.txt'), 'a\0b');
  writeFileSync(join(root, 'large.md'), 'a'.repeat(1_048_577));
  writeFileSync(join(root, 'reference.pdf'), 'A non-text format');
  const deep = join(root, ...Array.from({ length: 14 }, (_, n) => 'level' + n));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'deep.md'), 'Too deep');
  for (let n = 0; n < 1050; n++) writeFileSync(join(root, 'file' + n + '.md'), 'Small');
  // Select bounded text failures independently so enumeration order cannot hide them.
  const errors = ok(
    await scanImport({
      selections: ['broken.md', 'binary.txt', 'large.md', 'reference.pdf'].map((name) => ({
        path: join(root, name),
      })),
      profileId: 'plain-files/v1',
    }),
  );
  assert.deepEqual(
    errors.sources.map((s) => s.entry.issue),
    ['not-utf8', 'not-text', 'object-bytes', 'unsupported'],
  );
  assert.ok(
    errors.sources.every(
      (s) => s.entry.suggestedAction === 'skip' && s.entry.kind === 'file-reference',
    ),
  );
  const plan = ok(await scanImport({ selections: [{ path: root }], profileId: 'plain-files/v1' }));
  assert.ok(plan.summary.visited <= 1000);
  assert.ok(plan.summary.truncated);
  assert.ok(plan.summary.limitReasons.includes('visited'));
  const depthPlan = ok(
    await scanImport({ selections: [{ path: join(root, 'level0') }], profileId: 'plain-files/v1' }),
  );
  assert.ok(depthPlan.summary.limitReasons.includes('depth'));
  assert.ok(!depthPlan.sources.some((s) => s.entry.kind === 'text'));
});
