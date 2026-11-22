import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Result } from '../../src/contracts/errors.js';
import type { ObjectContent } from '../../src/contracts/schema.js';
import { Space } from '../../src/core/index.js';

// Synthetic material represents SC-01/03/04/05/06/07. It is not the user's data,
// an observed monthly routine, or evidence that an external agent connected.
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
export const fixtureIds = Object.freeze({
  compass: uuid(1),
  fieldNotes: uuid(2),
  repository: uuid(3),
  measurements: uuid(4),
  retryPolicy: uuid(5),
  handoff: uuid(6),
  sample: uuid(7),
  independent: uuid(8),
});

export function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Fixture setup failed: ${result.error.code}`);
  return result.value;
}

function content(title: string, body: string): ObjectContent {
  return { title, body, properties: {}, relations: [] };
}

export function createAcceptanceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-space-acceptance-'));
  const directory = join(root, 'Space with spaces');
  const originals = join(root, 'Original working folders');
  const knowledge = join(originals, 'knowledge');
  const projectFolder = join(originals, 'projects', 'Compass');
  const repository = join(originals, 'repos', 'retry-kit');
  for (const path of [knowledge, projectFolder, join(repository, '.git')]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(
    join(knowledge, 'Retry policy.md'),
    '# Retry policy\n\nRetry only transient failures.\n',
  );
  writeFileSync(
    join(projectFolder, 'HANDOFF.md'),
    '# Handoff\n\nNext: compare the measured retry rates.\n',
  );
  writeFileSync(join(repository, 'README.md'), '# Retry kit\n\nSynthetic repository reference.\n');

  const space = requireSuccess(
    Space.create(directory, { title: 'Collaboration check', example: true }),
  );
  const human = space.human('acceptance-installation');
  let closed = false;
  const add = (
    id: string,
    kind: 'document' | 'project' | 'record' | 'asset',
    value: ObjectContent,
  ) =>
    requireSuccess(human.createObject({ operationKey: `fixture:${id}`, id, kind, content: value }));

  add(
    fixtureIds.compass,
    'project',
    content('Compass', 'Make retry behavior understandable and recoverable.'),
  );
  add(
    fixtureIds.fieldNotes,
    'project',
    content('Field notes', 'Collect observations across ongoing work.'),
  );
  requireSuccess(
    human.createObject({
      operationKey: 'fixture:repository',
      id: fixtureIds.repository,
      kind: 'asset',
      content: content('Retry kit', 'A reusable repository referenced by both projects.'),
      origin: { mode: 'external-reference', label: 'Synthetic repository', locator: repository },
    }),
  );
  add(
    fixtureIds.measurements,
    'document',
    content(
      'Measurements',
      '# Measurements\n\nTransient failures recovered after one retry. Persistent failures did not.\n',
    ),
  );

  const policy = content(
    'Retry policy',
    '# Retry policy\n\nRetry transient failures. Investigate persistent failures.\n\n中文记录 · 日本語のメモ · 한국어 메모 · Observación: café.\n',
  );
  policy.relations = [
    {
      id: uuid(101),
      predicate: 'belongs_to',
      target: { mode: 'current', objectId: fixtureIds.compass },
    },
    {
      id: uuid(102),
      predicate: 'belongs_to',
      target: { mode: 'current', objectId: fixtureIds.fieldNotes },
    },
    {
      id: uuid(103),
      predicate: 'source',
      target: { mode: 'pinned', objectId: fixtureIds.measurements, revision: 1 },
    },
    {
      id: uuid(104),
      predicate: 'uses',
      target: { mode: 'current', objectId: fixtureIds.repository },
    },
  ];
  add(fixtureIds.retryPolicy, 'document', policy);

  const handoff = content(
    'Handoff',
    '# Continue here\n\nCompare the measurements before revising the retry policy.\n',
  );
  handoff.relations = [
    {
      id: uuid(105),
      predicate: 'belongs_to',
      target: { mode: 'current', objectId: fixtureIds.compass },
    },
    {
      id: uuid(106),
      predicate: 'related',
      target: { mode: 'current', objectId: fixtureIds.retryPolicy },
    },
  ];
  add(fixtureIds.handoff, 'document', handoff);

  const sample = content(
    'Retry sample',
    'Zero attempts are known; the error rate has not been recorded.',
  );
  sample.properties = {
    attempts: { label: 'Attempts', type: 'number', value: 0 },
    error_rate: { label: 'Error rate', type: 'number', value: null },
    observation: { label: '観察 / 관찰', type: 'text', value: '' },
    checked: { label: 'Checked', type: 'boolean', value: false },
    observed_on: { label: 'Observation date', type: 'date', value: '2026-11-23' },
  };
  sample.relations = [
    {
      id: uuid(107),
      predicate: 'belongs_to',
      target: { mode: 'current', objectId: fixtureIds.compass },
    },
  ];
  add(fixtureIds.sample, 'record', sample);
  add(
    fixtureIds.independent,
    'document',
    content('', 'An independent thought does not require a project.'),
  );

  const project = requireSuccess(human.readObject({ objectId: fixtureIds.compass })).object;
  requireSuccess(
    human.saveObject({
      operationKey: 'fixture:continuation',
      targetId: project.id,
      expectedRevision: project.revision,
      content: {
        ...project.content,
        relations: [
          {
            id: uuid(108),
            predicate: 'continues_from',
            target: { mode: 'current', objectId: fixtureIds.handoff },
          },
          {
            id: uuid(109),
            predicate: 'uses',
            target: { mode: 'current', objectId: fixtureIds.repository },
          },
        ],
      },
    }),
  );
  const secondProject = requireSuccess(
    human.readObject({ objectId: fixtureIds.fieldNotes }),
  ).object;
  requireSuccess(
    human.saveObject({
      operationKey: 'fixture:shared-asset',
      targetId: secondProject.id,
      expectedRevision: secondProject.revision,
      content: {
        ...secondProject.content,
        relations: [
          {
            id: uuid(110),
            predicate: 'uses',
            target: { mode: 'current', objectId: fixtureIds.repository },
          },
        ],
      },
    }),
  );

  return {
    root,
    directory,
    originals,
    repository,
    space,
    human,
    ids: fixtureIds,
    releaseCore() {
      if (!closed) {
        space.close();
        closed = true;
      }
    },
    dispose() {
      if (!closed) {
        space.close();
        closed = true;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
