import type { SpaceSession } from '../../contracts/app.js';
import type { Kind, ObjectSnapshot, ObjectSummary, ObjectView } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef, PinnedRef } from '../../contracts/schema.js';

export const contextLimits = Object.freeze({ task: 1_000, references: 20, pageBytes: 32_768 });

/** Display data is deliberately smaller than a current-head ObjectSummary. */
export type ContextReference = {
  ref: PinnedRef;
  title: string;
  kind: Kind;
  digest: string | null;
  lifecycle?: ObjectSnapshot['lifecycle'];
};
export type ContextCandidate = {
  key: string;
  declared: ObjectRef;
  reference: ContextReference | null;
};
export type AccessObject = Pick<ContextReference, 'title' | 'kind'> & { id: string };
export type AccessDraft = { id: string; objects: AccessObject[] };

export function codepoints(text: string, maximum: number): string {
  return Array.from(text).slice(0, maximum).join('');
}
export const referenceKey = (ref: PinnedRef) => `${ref.objectId}:${ref.revision}`;
export const preparationKey = (session: SpaceSession, seed: ObjectSnapshot) =>
  JSON.stringify([
    session.bindingId,
    session.status.spaceId,
    session.status.instanceId,
    seed.id,
    seed.revision,
    seed.digest,
  ]);

export function contextReference(object: ObjectSnapshot): ContextReference {
  return {
    ref: { mode: 'pinned', objectId: object.id, revision: object.revision },
    title: object.content.title,
    kind: object.kind,
    digest: object.digest,
    lifecycle: object.lifecycle,
  };
}
export function summaryReference(object: ObjectSummary): ContextReference {
  return {
    ref: object.ref,
    title: object.title,
    kind: object.kind,
    digest: object.digest,
    lifecycle: object.lifecycle,
  };
}
export function directCandidates(view: ObjectView): ContextCandidate[] {
  return view.relationTargets.map((target) => ({
    key: target.relationId,
    declared: target.declared,
    reference:
      target.status === 'available' && target.resolved && target.kind !== undefined
        ? { ref: target.resolved, title: target.title ?? '', kind: target.kind, digest: null }
        : null,
  }));
}

/** Local direct-link pagination has the same item/UTF-8 limits as member queries. */
export function candidatePage(candidates: ContextCandidate[], start: number) {
  const items: ContextCandidate[] = [];
  let next = start;
  while (next < candidates.length && items.length < contextLimits.references) {
    const item = candidates[next]!;
    if (
      new TextEncoder().encode(JSON.stringify({ items: [...items, item] })).byteLength >
      contextLimits.pageBytes
    )
      break;
    items.push(item);
    next++;
  }
  return { items, next: next < candidates.length ? next : null };
}

export function selectedReferences(
  selected: ContextReference[],
  reference: ContextReference,
  checked: boolean,
): ContextReference[] | null {
  const key = referenceKey(reference.ref);
  const retained = selected.filter((item) => referenceKey(item.ref) !== key);
  if (!checked) return retained;
  if (retained.length >= contextLimits.references) return null;
  return [...retained, reference];
}

export function checkedReference(
  session: SpaceSession,
  expected: ContextReference,
  view: ObjectView,
): { reference: ContextReference; error: null } | { reference: null; error: ErrorCode } {
  const object = view.object;
  if (object.spaceId !== session.status.spaceId || object.instanceId !== session.status.instanceId)
    return { reference: null, error: 'SPACE_MISMATCH' };
  if (
    object.id !== expected.ref.objectId ||
    object.revision !== expected.ref.revision ||
    (expected.digest !== null && object.digest !== expected.digest)
  )
    return { reference: null, error: 'INTEGRITY_FAILURE' };
  return { reference: contextReference(object), error: null };
}

/** This clipboard format is independent of the one-object saved-context format. */
export function contextBrief(
  session: SpaceSession,
  task: string,
  references: ContextReference[],
  seed: ObjectSnapshot,
  candidates: { direct: ContextCandidate[]; members: ContextReference[] } = {
    direct: [],
    members: [],
  },
): string {
  if (
    Array.from(task).length > contextLimits.task ||
    references.length === 0 ||
    references.length > contextLimits.references ||
    new Set(references.map((item) => referenceKey(item.ref))).size !== references.length ||
    references.some((item) => item.digest === null)
  )
    throw new Error('Invalid brief selection');
  if (seed.spaceId !== session.status.spaceId || seed.instanceId !== session.status.instanceId)
    throw new Error('Brief binding mismatch');
  const selectedSeed = references.some(
    (item) => referenceKey(item.ref) === referenceKey(contextReference(seed).ref),
  );
  const seedKey = referenceKey(contextReference(seed).ref),
    directKeys = new Set(
      candidates.direct.flatMap((item) =>
        item.reference ? [referenceKey(item.reference.ref)] : [],
      ),
    ),
    memberKeys = new Set(candidates.members.map((item) => referenceKey(item.ref)));
  const groups = {
    startingSavedVersion: references.filter((item) => referenceKey(item.ref) === seedKey),
    directLinksInStartingVersion: references.filter((item) =>
      directKeys.has(referenceKey(item.ref)),
    ),
    currentActiveProjectMaterialAsQueried: references.filter((item) =>
      memberKeys.has(referenceKey(item.ref)),
    ),
    earlierSelectedResults: references.filter((item) => {
      const key = referenceKey(item.ref);
      return key !== seedKey && !directKeys.has(key) && !memberKeys.has(key);
    }),
  };
  return JSON.stringify(
    {
      format: 'agentspace-brief/v1',
      scope: {
        kind: 'selected-saved-versions',
        completeProjectSnapshot: false,
        relationTraversal: 'none',
      },
      space: {
        id: session.status.spaceId,
        instanceId: session.status.instanceId,
        title: session.status.title,
      },
      task,
      references: references.map(({ ref, title, kind, digest }) => ({ ref, title, kind, digest })),
      referenceGroups: Object.fromEntries(
        Object.entries(groups).map(([name, entries]) => [name, entries.map((item) => item.ref)]),
      ),
      ...(selectedSeed && seed.kind === 'project' && seed.content.body
        ? {
            projectGoalExcerpt: {
              ref: contextReference(seed).ref,
              text: codepoints(seed.content.body, 280),
              unit: 'unicode-code-points',
              truncated: Array.from(seed.content.body).length > 280,
            },
          }
        : {}),
      usage: { read: 'exact-pins', changes: 'proposals', delivery: 'clipboard-only' },
    },
    null,
    2,
  );
}

export function accessObjects(references: ContextReference[]): AccessObject[] {
  return references
    .filter(
      (item, index) =>
        references.findIndex((other) => other.ref.objectId === item.ref.objectId) === index,
    )
    .map((item) => ({ id: item.ref.objectId, title: item.title, kind: item.kind }));
}
