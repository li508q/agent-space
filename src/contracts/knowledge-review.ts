export const knowledgeReviewStates = [
  'never-reviewed',
  'current-reviewed',
  'changed-since-review',
] as const;

export type KnowledgeReviewState = (typeof knowledgeReviewStates)[number];
export type KnowledgeReviewMetadata = {
  currentRevision: number;
  knowledgeReviewedRevision: number | null;
  knowledgeReviewState: KnowledgeReviewState;
};

/** Metadata of this read's current head, even when the represented pin is historical. */
export function deriveKnowledgeReview(
  currentRevision: number,
  knowledgeReviewedRevision: number | null,
): KnowledgeReviewMetadata | null {
  if (
    !Number.isSafeInteger(currentRevision) ||
    currentRevision < 1 ||
    (knowledgeReviewedRevision !== null &&
      (!Number.isSafeInteger(knowledgeReviewedRevision) ||
        knowledgeReviewedRevision < 1 ||
        knowledgeReviewedRevision > currentRevision))
  )
    return null;
  return {
    currentRevision,
    knowledgeReviewedRevision,
    knowledgeReviewState:
      knowledgeReviewedRevision === null
        ? 'never-reviewed'
        : knowledgeReviewedRevision === currentRevision
          ? 'current-reviewed'
          : 'changed-since-review',
  };
}

export function normalizeKnowledgeReviewStates(values: readonly KnowledgeReviewState[]) {
  return knowledgeReviewStates.filter((state) => values.includes(state));
}
