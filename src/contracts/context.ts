import { z } from 'zod';
import {
  DigestSchema,
  IdSchema,
  KindSchema,
  PinnedRefSchema,
  PredicateSchema,
  QuerySchema,
  RelationSchema,
  RevisionSchema,
  SequenceSchema,
} from './schema.js';
import type { Result } from './errors.js';

export const ContextBudgetSchema = z.number().int().min(1_024).max(65_536);
export const ContextCursorStringSchema = z.string().min(1).max(2_048);
export const ScopeSummarySchema = z.strictObject({
  mode: z.enum(['space', 'objects']),
  digest: DigestSchema,
  objectCount: SequenceSchema.nullable(),
});
export const ObjectSummarySchema = z.strictObject({
  ref: PinnedRefSchema,
  title: z.string().max(240),
  kind: KindSchema,
  lifecycle: z.enum(['active', 'archived']),
  digest: DigestSchema,
  updatedAt: z.iso.datetime(),
});
export const ContextMetaShape = {
  spaceId: IdSchema,
  instanceId: IdSchema,
  scope: ScopeSummarySchema,
  authoritySequence: SequenceSchema,
  returnedBytes: SequenceSchema,
};

export const SchemaDescribeSchema = z.strictObject({
  kind: KindSchema.optional(),
  maxBytes: ContextBudgetSchema,
});
export const SchemaDescriptionSchema = z.strictObject({
  ...ContextMetaShape,
  definitionsVersion: z.literal(1),
  describedKind: KindSchema.nullable(),
  kinds: z.array(KindSchema).max(4),
  contentFields: z
    .array(
      z.strictObject({
        name: z.enum(['title', 'body', 'properties', 'relations']),
        valueShape: z.enum(['text', 'typed-map', 'relation-list']),
        agentUpdate: z.enum(['allowed-by-policy', 'values-only']),
      }),
    )
    .length(4),
  propertyModel: z.literal('per-object'),
  propertyTypes: z.array(z.enum(['text', 'number', 'boolean', 'date', 'select'])).length(5),
  relationDefinitions: z
    .array(
      z.strictObject({
        predicate: PredicateSchema,
        targetKind: KindSchema.nullable(),
        referenceMode: z.enum(['current', 'pinned', 'either']),
        meaning: z.enum(['membership', 'association', 'evidence', 'asset-use', 'continuation']),
      }),
    )
    .length(5),
  filterKeys: z.array(z.enum(['kind', 'projectId', 'text', 'property.equals'])).length(4),
  humanOwned: z.array(z.enum(['origin', 'protection', 'grants', 'knowledge-review'])).length(4),
  semantics: z.strictObject({
    nulls: z.literal('null-empty-zero-and-missing-are-distinct'),
    fieldDefinitions: z.literal('agent-update-values-only'),
    dates: z.literal('authored-date-not-save-time'),
    history: z.literal('accepted-revisions-not-temporal-facts'),
    locators: z.literal('advisory-within-pinned-revision'),
  }),
  limits: z.strictObject({
    objectBytes: SequenceSchema,
    fieldBytes: SequenceSchema,
    properties: SequenceSchema,
    relations: SequenceSchema,
    readBytes: SequenceSchema,
  }),
});

export const TextSearchSchema = QuerySchema.extend({
  filter: QuerySchema.shape.filter.extend({
    text: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value.trim().length > 0),
  }),
});
export const TextSearchPageSchema = z.strictObject({
  items: z.array(ObjectSummarySchema).max(50),
  executed: TextSearchSchema.shape.filter,
  scope: ScopeSummarySchema,
  authoritySequence: SequenceSchema,
  nextCursor: ContextCursorStringSchema.nullable(),
  truncated: z.boolean(),
  returnedBytes: SequenceSchema,
  searchMode: z.enum(['literal', 'trigram-literal']),
});

export const RelationsExpandInitialSchema = z.strictObject({
  seedId: IdSchema,
  direction: z.enum(['outgoing', 'incoming']),
  predicates: z
    .array(PredicateSchema)
    .min(1)
    .max(5)
    .refine((values) => new Set(values).size === values.length),
  maxDepth: z.union([z.literal(1), z.literal(2)]),
  maxNodes: z.number().int().min(2).max(50),
  maxEdges: z.number().int().min(1).max(50),
  maxBytes: ContextBudgetSchema,
});
export const RelationsExpandSchema = z.union([
  RelationsExpandInitialSchema,
  z.strictObject({ cursor: ContextCursorStringSchema, maxBytes: ContextBudgetSchema }),
]);
export const ExpandedEdgeSchema = z.strictObject({
  owner: PinnedRefSchema,
  relation: RelationSchema,
  resolvedTarget: PinnedRefSchema,
  depth: z.union([z.literal(1), z.literal(2)]),
});
export const RelationsExpandPageSchema = z.strictObject({
  ...ContextMetaShape,
  seed: ObjectSummarySchema,
  direction: z.enum(['outgoing', 'incoming']),
  matching: z.literal('object-identity'),
  pinnedTargets: z.literal('terminal'),
  nodes: z.array(ObjectSummarySchema).max(50),
  edges: z.array(ExpandedEdgeSchema).max(50),
  unavailableReferences: z.boolean(),
  traversalCompleteWithinScope: z.boolean(),
  stopReasons: z.array(z.enum(['max-nodes', 'max-edges', 'work-budget'])).max(3),
  truncated: z.boolean(),
  nextCursor: ContextCursorStringSchema.nullable(),
});

export const AcceptedChangeReadSchema = z.union([
  z.strictObject({
    changeId: IdSchema,
    section: z.enum(['summary', 'evidence']),
    maxBytes: ContextBudgetSchema,
  }),
  z.strictObject({ cursor: ContextCursorStringSchema, maxBytes: ContextBudgetSchema }),
]);
const AcceptedChangeBaseShape = {
  ...ContextMetaShape,
  changeId: IdSchema,
  proposalId: IdSchema,
  target: PinnedRefSchema,
};
export const AcceptedChangeSummarySchema = z.strictObject({
  ...AcceptedChangeBaseShape,
  section: z.literal('summary'),
  acceptedSequence: SequenceSchema,
  acceptedAt: z.iso.datetime(),
  base: PinnedRefSchema.nullable(),
  targetDigest: DigestSchema,
  currentTargetRevision: RevisionSchema,
  declared: z.strictObject({
    purpose: z.string().min(1).max(1_000),
    reason: z.string().min(1).max(4_000),
  }),
  evidenceStatus: z.enum(['none-declared', 'available', 'partly-unavailable', 'unavailable']),
});
export const AcceptedEvidenceItemSchema = z.strictObject({
  ref: PinnedRefSchema,
  digest: DigestSchema,
  title: z.string().max(240),
  kind: KindSchema,
  currentRevision: RevisionSchema,
  availability: z.literal('available'),
});
export const AcceptedChangeEvidencePageSchema = z.strictObject({
  ...AcceptedChangeBaseShape,
  section: z.literal('evidence'),
  items: z.array(AcceptedEvidenceItemSchema).max(50),
  unavailableReferences: z.boolean(),
  range: z.strictObject({
    unit: z.literal('entries'),
    start: SequenceSchema,
    endExclusive: SequenceSchema,
  }),
  truncated: z.boolean(),
  nextCursor: ContextCursorStringSchema.nullable(),
});
export const AcceptedChangePageSchema = z.discriminatedUnion('section', [
  AcceptedChangeSummarySchema,
  AcceptedChangeEvidencePageSchema,
]);

export const contextUsageHints = [
  'describe-model',
  'query-exact-filters',
  'search-literal',
  'expand-typed-links',
  'read-pinned-source',
  'read-accepted-evidence',
  'proposal-not-accepted',
  'report-truncation',
] as const;
export type ContextUsageHint = (typeof contextUsageHints)[number];
export type SchemaDescribeInput = z.infer<typeof SchemaDescribeSchema>;
export type SchemaDescription = z.infer<typeof SchemaDescriptionSchema>;
export type TextSearchInput = z.infer<typeof TextSearchSchema>;
export type TextSearchPage = z.infer<typeof TextSearchPageSchema>;
export type RelationsExpandInitial = z.infer<typeof RelationsExpandInitialSchema>;
export type RelationsExpandInput = z.infer<typeof RelationsExpandSchema>;
export type ExpandedEdge = z.infer<typeof ExpandedEdgeSchema>;
export type RelationsExpandPage = z.infer<typeof RelationsExpandPageSchema>;
export type AcceptedChangeReadInput = z.infer<typeof AcceptedChangeReadSchema>;
export type AcceptedChangeSummary = z.infer<typeof AcceptedChangeSummarySchema>;
export type AcceptedEvidenceItem = z.infer<typeof AcceptedEvidenceItemSchema>;
export type AcceptedChangeEvidencePage = z.infer<typeof AcceptedChangeEvidencePageSchema>;
export type AcceptedChangePage = z.infer<typeof AcceptedChangePageSchema>;
export interface ContextServices {
  describe(input: SchemaDescribeInput): Result<SchemaDescription>;
  search(input: TextSearchInput): Result<TextSearchPage>;
  expandRelations(input: RelationsExpandInput): Result<RelationsExpandPage>;
  readAcceptedChange(input: AcceptedChangeReadInput): Result<AcceptedChangePage>;
}
