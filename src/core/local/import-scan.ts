import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { opendir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ContentSchema } from '../../contracts/schema.js';
import {
  ConfirmImportSchema,
  ImportManifestSchema,
  PrepareImportSchema,
  PreparedImportSchema,
  localLimits,
} from '../../contracts/local.js';
import type {
  ImportManifest,
  ImportManifestItem,
  ImportPreviewPage,
  PreparedImport,
  PreparedSource,
  ScanSummary,
} from '../../contracts/local.js';
import { bytes, digest, fail, measured, parse } from '../support.js';
import { fingerprint, jsonBytes, readSource, resultOf } from './files.js';

const excluded = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.next',
  'dist',
  'build',
  'target',
  'coverage',
  '.agentspace',
]);
const textExtensions = new Set(['.md', '.markdown', '.txt']);
function short(text: string, maximum = 240): string {
  let result = '';
  for (const point of text) {
    if (result.length + point.length > maximum) break;
    result += point;
  }
  return result;
}
function planDigest(plan: PreparedImport): string {
  return digest({ ...plan, digest: undefined });
}
function fixedId(value: unknown): string {
  const b = Buffer.from(digest(value).slice(0, 32), 'hex');
  b[6] = (b[6]! & 15) | 128;
  b[8] = (b[8]! & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function scanImport(input: unknown) {
  return resultOf(async (): Promise<PreparedImport> => {
    const options = parse(PrepareImportSchema, input);
    let selectedBytes = 0;
    const sources: PreparedSource[] = [],
      groups: PreparedImport['groups'] = [],
      seen = new Set<string>();
    const summary: ScanSummary = {
      visited: 0,
      managedBytes: 0,
      candidates: 0,
      skipped: 0,
      truncated: false,
      limitReasons: [],
    };
    const issue = (reason: ScanSummary['limitReasons'][number]) => {
      if (!summary.limitReasons.includes(reason)) summary.limitReasons.push(reason);
      summary.truncated = true;
    };
    async function visit(
      path: string,
      parts: string[],
      depth: number,
      parentGroup: string | null,
      profilePrefix: string[] = [],
    ) {
      if (summary.visited >= localLimits.visited) {
        issue('visited');
        return;
      }
      if (seen.has(path)) return;
      seen.add(path);
      summary.visited++;
      const profileParts = [...profilePrefix, ...parts];
      const relativePath = short(parts.join('/') || basename(path), 2_048);
      const entry: PreparedSource['entry'] = {
        id: randomUUID(),
        relativePath,
        title: short(basename(path, extname(path))),
        kind: 'skipped',
        suggestedAction: 'skip',
        bytes: 0,
        groupId: parentGroup,
        issue: null,
      };
      let source: PreparedSource = {
        entry,
        path: path.length <= 2_048 ? path : null,
        fingerprint: null,
        rawDigest: null,
        observedAt: new Date().toISOString(),
      };
      const skip = (reason: PreparedSource['entry']['issue']) => {
        entry.issue = reason;
        summary.skipped++;
        sources.push(source);
      };
      if (!source.path) {
        skip('path-length');
        return;
      }
      let info;
      try {
        info = lstatSync(path);
      } catch {
        skip('unreadable');
        return;
      }
      if (info.isSymbolicLink()) {
        skip('symlink');
        return;
      }
      if (excluded.has(basename(path).toLowerCase())) {
        skip('excluded');
        return;
      }
      if (depth > localLimits.depth) {
        issue('depth');
        skip('depth');
        return;
      }
      if (info.isDirectory()) {
        let repo =
          options.profileId === 'knowledge-project-repos/v1' &&
          profileParts.at(-2)?.toLowerCase() === 'repos';
        try {
          const marker = lstatSync(join(path, '.git'));
          repo ||= !marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile());
        } catch {
          /* Marker absent. */
        }
        if (repo) {
          entry.title = short(basename(path));
          entry.kind = 'repository';
          entry.suggestedAction = 'external-reference';
          source.fingerprint = fingerprint(path);
          summary.candidates++;
          sources.push(source);
          return;
        }
        let group = parentGroup;
        if (
          options.profileId === 'knowledge-project-repos/v1' &&
          profileParts.length === 2 &&
          profileParts[0]?.toLowerCase() === 'projects'
        ) {
          group = entry.id;
          entry.groupId = group;
          entry.title = short(basename(path));
          entry.kind = 'group';
          entry.suggestedAction = 'project-group';
          source.fingerprint = fingerprint(path);
          groups.push({ id: group, title: entry.title, relativePath });
          sources.push(source);
          summary.candidates++;
        }
        try {
          const directory = await opendir(path);
          for await (const child of directory) {
            if (summary.visited >= localLimits.visited) {
              issue('visited');
              break;
            }
            await visit(
              join(path, child.name),
              [...parts, child.name],
              depth + 1,
              group,
              profilePrefix,
            );
          }
        } catch {
          if (entry.kind !== 'group') skip('unreadable');
        }
        return;
      }
      if (!info.isFile()) {
        skip('not-regular');
        return;
      }
      entry.bytes = info.size;
      entry.kind = 'file-reference';
      source.fingerprint = fingerprint(path);
      if (!textExtensions.has(extname(path).toLowerCase())) {
        entry.issue = 'unsupported';
        sources.push(source);
        summary.candidates++;
        return;
      }
      if (info.size > localLimits.objectBytes) {
        entry.issue = 'object-bytes';
        sources.push(source);
        summary.candidates++;
        return;
      }
      if (selectedBytes + info.size > localLimits.selectedBytes) {
        issue('selected-bytes');
        entry.issue = 'selected-bytes';
        sources.push(source);
        summary.candidates++;
        return;
      }
      selectedBytes += info.size;
      try {
        const captured = readSource(path);
        ContentSchema.parse({
          title: entry.title,
          body: captured.text,
          properties: {},
          relations: [],
        });
        if (
          bytes({
            kind: 'document',
            content: { title: entry.title, body: captured.text, properties: {}, relations: [] },
            policy: { protectedFields: [] },
            origin: {
              mode: 'imported-copy',
              label: entry.title,
              locator: path,
              sourceDigest: captured.rawDigest,
              observedAt: source.observedAt,
            },
            lifecycle: 'active',
          }) > localLimits.objectBytes
        ) {
          entry.issue = 'object-bytes';
        } else {
          entry.kind = 'text';
          entry.suggestedAction = 'managed-copy';
          source = { ...source, fingerprint: captured.fingerprint, rawDigest: captured.rawDigest };
          summary.managedBytes += captured.bytes.byteLength;
        }
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'failure' in error
            ? (error.failure as { error: { code?: string; field?: string } }).error
            : null;
        entry.issue =
          code?.field === 'text'
            ? 'not-text'
            : code?.field === 'encoding'
              ? 'not-utf8'
              : code?.code === 'LIMIT_EXCEEDED'
                ? 'object-bytes'
                : 'unreadable';
      }
      sources.push(source);
      summary.candidates++;
    }
    for (const selection of options.selections) {
      if (summary.visited >= localLimits.visited) {
        issue('visited');
        break;
      }
      const path = resolve(selection.path),
        label = basename(path).toLowerCase(),
        parent = basename(dirname(path)).toLowerCase();
      const prefix = ['projects', 'repos'].includes(label)
        ? [label]
        : ['projects', 'repos'].includes(parent)
          ? [parent, basename(path)]
          : [];
      await visit(path, [], 0, null, prefix);
    }
    const plan: PreparedImport = {
      id: randomUUID(),
      profileId: options.profileId,
      digest: '0'.repeat(64),
      roots: options.selections.map((r) => resolve(r.path)),
      groups,
      sources,
      summary,
    };
    plan.digest = planDigest(plan);
    if (jsonBytes(plan) > localLimits.planBytes)
      fail('LIMIT_EXCEEDED', { maxBytes: localLimits.planBytes });
    return PreparedImportSchema.parse(plan);
  });
}

export function readPreview(
  plan: PreparedImport,
  offset = 0,
  maxBytes: number = localLimits.pageBytes,
): ImportPreviewPage {
  if (
    planDigest(plan) !== plan.digest ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > plan.sources.length ||
    maxBytes < 1_024 ||
    maxBytes > localLimits.pageBytes
  )
    fail('INVALID_INPUT');
  const page: ImportPreviewPage = {
    planId: plan.id,
    planDigest: plan.digest,
    profileId: plan.profileId,
    rootLabels: plan.roots.slice(0, 3).map((r) => short(basename(r))),
    rootCount: plan.roots.length,
    groups: [],
    entries: [],
    summary: plan.summary,
    nextCursor: null,
    returnedBytes: 0,
  };
  for (let i = offset; i < plan.sources.length; i++) {
    const source = plan.sources[i]!;
    const entry = { ...source.entry, sourceLocation: source.path };
    const previousGroups = page.groups;
    page.entries.push(entry);
    const needed = new Set(page.entries.flatMap((e) => (e.groupId ? [e.groupId] : [])));
    page.groups = plan.groups.filter((g) => needed.has(g.id));
    page.nextCursor = i + 1 < plan.sources.length ? String(i + 1) : null;
    measured(page);
    if (page.returnedBytes > maxBytes) {
      page.entries.pop();
      page.groups = previousGroups;
      page.nextCursor = String(i);
      measured(page);
      if (!page.entries.length)
        fail('LIMIT_EXCEEDED', { minBytes: page.returnedBytes + bytes(entry) });
      break;
    }
  }
  if (measured(page).returnedBytes > maxBytes)
    fail('LIMIT_EXCEEDED', { minBytes: page.returnedBytes });
  return page;
}

export function compileImport(
  plan: PreparedImport,
  input: unknown,
  identity: { spaceId: string; instanceId: string },
): ImportManifest {
  identity = { spaceId: identity.spaceId, instanceId: identity.instanceId };
  const parsedChoices = parse(ConfirmImportSchema, input);
  const choices = {
    ...parsedChoices,
    choices: [...parsedChoices.choices].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    groups: [...parsedChoices.groups].sort((a, b) => a.groupId.localeCompare(b.groupId)),
  };
  if (
    planDigest(plan) !== plan.digest ||
    plan.id !== choices.planId ||
    plan.digest !== choices.expectedPlanDigest
  )
    fail('IMPORT_PLAN_CHANGED');
  const items: ImportManifestItem[] = [],
    targets = new Map<string, string>();
  const groupChoices = new Map(choices.groups.map((g) => [g.groupId, g]));
  for (const group of choices.groups) {
    const source = plan.sources.find(
      (s) => s.entry.id === group.groupId && s.entry.kind === 'group',
    );
    if (!source?.path || !source.fingerprint) fail('INVALID_INPUT');
    targets.set(group.groupId, group.existingProjectId ?? group.groupId);
    if (!group.existingProjectId)
      items.push({
        id: group.groupId,
        targetId: group.groupId,
        relativePath: source.entry.relativePath,
        action: 'project-group',
        kind: 'project',
        sourcePath: source.path,
        fingerprint: source.fingerprint,
        rawDigest: null,
        sourceKey: digest({ kind: 'project', path: source.path }),
        sourceVersion: source.fingerprint.identity,
        content: { title: group.title, body: '', properties: {}, relations: [] },
        origin: {
          mode: 'managed',
          label: group.title,
          locator: source.path,
          observedAt: source.observedAt,
        },
        dependsOn: [],
        expectedRevision: null,
      });
  }
  const selected = choices.choices.map((choice) => {
    const source = plan.sources.find((s) => s.entry.id === choice.itemId);
    if (!source) fail('INVALID_INPUT');
    return { choice, source };
  });
  // Assets precede copies so an explicitly selected use link can resolve immediately.
  selected.sort(
    (a, b) =>
      Number(b.choice.action === 'external-reference') -
      Number(a.choice.action === 'external-reference'),
  );
  for (const { choice, source } of selected) {
    if (choice.action === 'skip') continue;
    if (
      !source.path ||
      !source.fingerprint ||
      source.entry.kind === 'skipped' ||
      source.entry.kind === 'group'
    )
      fail('INVALID_INPUT');
    if (choice.action === 'managed-copy' && (source.entry.kind !== 'text' || !source.rawDigest))
      fail('UNSUPPORTED_IMPORT');
    const relations: ImportManifestItem['content']['relations'] = [],
      dependsOn: string[] = [];
    const project =
      choice.project.mode === 'existing'
        ? choice.project.objectId
        : choice.project.mode === 'group'
          ? targets.get(choice.project.groupId)
          : null;
    if (choice.project.mode === 'group' && !project) fail('INVALID_INPUT');
    if (project) {
      relations.push({
        id: fixedId({ plan: plan.id, item: source.entry.id, predicate: 'belongs_to', project }),
        predicate: 'belongs_to',
        target: { mode: 'current', objectId: project },
      });
      const selectedGroup =
        choice.project.mode === 'group' ? groupChoices.get(choice.project.groupId) : undefined;
      if (selectedGroup && !selectedGroup.existingProjectId) dependsOn.push(selectedGroup.groupId);
    }
    for (const objectId of [...new Set(choice.useAssetIds)].sort()) {
      relations.push({
        id: fixedId({ plan: plan.id, item: source.entry.id, predicate: 'uses', objectId }),
        predicate: 'uses',
        target: { mode: 'current', objectId },
      });
      if (
        selected.some(
          (s) => s.choice.itemId === objectId && s.choice.action === 'external-reference',
        )
      )
        dependsOn.push(objectId);
    }
    const copy = choice.action === 'managed-copy';
    const title = choice.title ?? source.entry.title;
    items.push({
      id: source.entry.id,
      targetId: source.entry.id,
      relativePath: source.entry.relativePath,
      action: choice.action,
      kind: copy ? 'document' : 'asset',
      sourcePath: source.path,
      fingerprint: source.fingerprint,
      rawDigest: copy ? source.rawDigest : null,
      sourceKey: digest({ path: source.path, mode: choice.action }),
      sourceVersion: copy ? source.rawDigest! : source.fingerprint.identity,
      content: { title, body: '', properties: {}, relations },
      origin: {
        mode: copy ? 'imported-copy' : 'external-reference',
        label: title,
        locator: source.path,
        ...(copy ? { sourceDigest: source.rawDigest! } : {}),
        observedAt: source.observedAt,
      },
      dependsOn,
      expectedRevision: null,
    });
  }
  const manifest = ImportManifestSchema.parse({
    id: fixedId({ identity, choices }),
    ...identity,
    profileId: plan.profileId,
    planDigest: plan.digest,
    createdAt: plan.sources[0]?.observedAt ?? new Date().toISOString(),
    items,
  });
  if (bytes(manifest) > localLimits.planBytes)
    fail('LIMIT_EXCEEDED', { maxBytes: localLimits.planBytes });
  return manifest;
}

export function captureImportItem(item: ImportManifestItem): string | undefined {
  if (item.action === 'skip' || item.action === 'link-relations') return;
  if (!item.sourcePath || !item.fingerprint) fail('INVALID_INPUT');
  let now: ReturnType<typeof fingerprint>;
  try {
    now = fingerprint(item.sourcePath);
  } catch {
    return fail('SOURCE_UNAVAILABLE');
  }
  if (
    now.identity !== item.fingerprint.identity ||
    now.kind !== item.fingerprint.kind ||
    (now.kind === 'file' &&
      (now.bytes !== item.fingerprint.bytes || now.modifiedNs !== item.fingerprint.modifiedNs))
  )
    fail('IMPORT_SOURCE_CHANGED');
  if (item.action !== 'managed-copy') return;
  const captured = readSource(item.sourcePath);
  if (captured.rawDigest !== item.rawDigest) fail('IMPORT_SOURCE_CHANGED');
  const content = { ...item.content, body: captured.text };
  ContentSchema.parse(content);
  if (
    bytes({
      kind: item.kind,
      content,
      policy: { protectedFields: [] },
      origin: item.origin,
      lifecycle: 'active',
    }) > localLimits.objectBytes
  )
    fail('LIMIT_EXCEEDED');
  return captured.text;
}

export const importManifestDigest = (manifest: ImportManifest): string => digest(manifest);
