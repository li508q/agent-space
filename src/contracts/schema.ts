import { z } from 'zod';

// Boundary shapes only: core authorization, persistence and range assembly are not implemented.
export const LocaleSchema = z.enum(['en', 'zh-CN', 'ja', 'ko', 'es']);
export const IdSchema = z.uuid().toLowerCase();
export const RevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const OperationKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._:-]+$/);
export const FieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const KindSchema = z.enum(['document', 'project', 'record', 'asset']);
export const AgentCreatableKindSchema = z.enum(['document', 'record']);

export const CurrentRefSchema = z.strictObject({ mode: z.literal('current'), objectId: IdSchema });
export const PinnedRefSchema = z.strictObject({
  mode: z.literal('pinned'),
  objectId: IdSchema,
  revision: RevisionSchema,
  locator: z.string().max(256).optional(),
});
export const ObjectRefSchema = z.discriminatedUnion('mode', [CurrentRefSchema, PinnedRefSchema]);
export const RelationSchema = z.discriminatedUnion('predicate', [
  z.strictObject({ id: IdSchema, predicate: z.literal('belongs_to'), target: CurrentRefSchema }),
  z.strictObject({ id: IdSchema, predicate: z.literal('related'), target: CurrentRefSchema }),
  z.strictObject({ id: IdSchema, predicate: z.literal('source'), target: PinnedRefSchema }),
  z.strictObject({ id: IdSchema, predicate: z.literal('uses'), target: ObjectRefSchema }),
  z.strictObject({ id: IdSchema, predicate: z.literal('continues_from'), target: ObjectRefSchema }),
]);

// ASCII map keys are stable identity. Labels and option strings are authored content,
// may use any language, and do not change when the interface locale changes.
const FieldLabelSchema = z.string().min(1).max(120);
export const TypedFieldSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      label: FieldLabelSchema,
      type: z.literal('text'),
      value: z.string().max(20_000).nullable(),
    }),
    z.strictObject({
      label: FieldLabelSchema,
      type: z.literal('number'),
      value: z.number().finite().nullable(),
    }),
    z.strictObject({
      label: FieldLabelSchema,
      type: z.literal('boolean'),
      value: z.boolean().nullable(),
    }),
    z.strictObject({
      label: FieldLabelSchema,
      type: z.literal('date'),
      value: z.iso.date().nullable(),
    }),
    z
      .strictObject({
        label: FieldLabelSchema,
        type: z.literal('select'),
        options: z.array(z.string().min(1).max(100)).min(1).max(50),
        value: z.string().nullable(),
      })
      .refine((field) => field.value === null || field.options.includes(field.value), {
        message: 'Select value must be one of the declared options',
        path: ['value'],
      }),
  ])
  .refine(
    (field) => new TextEncoder().encode(JSON.stringify(field)).byteLength <= 32_768,
    'A field must fit within 32 KiB',
  );
export const PropertiesSchema = z
  .record(FieldKeySchema, TypedFieldSchema)
  .refine((properties) => Object.keys(properties).length <= 64, 'At most 64 fields are supported');
export const ContentSchema = z.strictObject({
  title: z.string().max(240), // An untitled note stores ""; the UI localizes its placeholder.
  body: z.string().max(1_000_000),
  properties: PropertiesSchema,
  relations: z.array(RelationSchema).max(100),
});
export const PatchSchema = ContentSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  'A patch must change at least one field',
);

const ProposalEnvelope = {
  operationKey: OperationKeySchema,
  purpose: z.string().min(1).max(1_000),
  reason: z.string().min(1).max(4_000),
  sources: z.array(PinnedRefSchema).max(50),
  supersedes: IdSchema.optional(),
};
// Core requires a whole-space propose grant for creation. An object grant may
// only update existing authorized targets. A candidate never becomes an object
// until human acceptance; its requested ID is reserved, not a current head.
export const ProposeSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...ProposalEnvelope,
    action: z.literal('update'),
    targetId: IdSchema,
    baseRevision: RevisionSchema,
    patch: PatchSchema,
  }),
  z.strictObject({
    ...ProposalEnvelope,
    action: z.literal('create'),
    newObject: z.strictObject({
      id: IdSchema,
      kind: AgentCreatableKindSchema,
      content: ContentSchema,
    }),
  }),
]);
export const ExpectedTargetSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('absent') }),
  z.strictObject({ state: z.literal('revision'), revision: RevisionSchema }),
]);
// Protection, origin, grants and knowledge-review state are human-owned and
// absent from agent patches. Unknown keys are rejected, never silently stripped.
const ReviewEnvelope = {
  operationKey: OperationKeySchema,
  proposalId: IdSchema,
  expectedProposalVersion: RevisionSchema,
  expectedPayloadHash: DigestSchema,
};
export const ReviewSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    ...ReviewEnvelope,
    decision: z.literal('accept'),
    expectedTarget: ExpectedTargetSchema,
  }),
  // A stale/conflicted proposal can always be rejected by the person. Rejection
  // guards the candidate/status, not the target's current head or old agent grant.
  z.strictObject({ ...ReviewEnvelope, decision: z.literal('reject') }),
]);
export const HumanSaveSchema = z.strictObject({
  operationKey: OperationKeySchema,
  targetId: IdSchema,
  expectedRevision: RevisionSchema,
  content: ContentSchema,
  generation: SequenceSchema.optional(),
});
export const UndoSchema = z.strictObject({
  operationKey: OperationKeySchema,
  changeId: IdSchema,
  expectedRevision: RevisionSchema,
});
// Trusted UI may read a complete object within the managed payload limit.
export const HumanReadSchema = z.strictObject({
  objectId: IdSchema,
  revision: RevisionSchema.optional(),
});

export const ReadSectionSchema = z.enum(['summary', 'body', 'properties', 'relations']);
const ReadBudgetSchema = z.number().int().min(1_024).max(65_536);
// An agent explicitly selects a section/budget. Continuations bind the resolved
// revision and grant scope. Initial/current and continuation inputs cannot mix.
export const ReadSchema = z.union([
  z.strictObject({ ref: ObjectRefSchema, section: ReadSectionSchema, maxBytes: ReadBudgetSchema }),
  z.strictObject({ cursor: z.string().min(1).max(2_048), maxBytes: ReadBudgetSchema }),
]);
export const ReadCursorSchema = z.strictObject({
  version: z.literal(1),
  instanceId: IdSchema,
  scopeDigest: DigestSchema,
  ref: PinnedRefSchema,
  digest: DigestSchema,
  section: ReadSectionSchema,
  nextOffset: SequenceSchema,
});
const PageEnvelope = {
  ref: PinnedRefSchema,
  digest: DigestSchema,
  returnedBytes: SequenceSchema,
  unavailableReferences: z.boolean(),
  truncated: z.boolean(),
  nextCursor: z.string().min(1).max(2_048).nullable(),
};
const EntryRangeSchema = z.strictObject({
  unit: z.literal('entries'),
  start: SequenceSchema,
  endExclusive: SequenceSchema,
  total: SequenceSchema,
});
export const ReadPageSchema = z.discriminatedUnion('section', [
  z.strictObject({
    ...PageEnvelope,
    section: z.literal('summary'),
    title: z.string().max(240),
    kind: KindSchema,
    currentRevision: RevisionSchema,
    lifecycle: z.enum(['active', 'archived']),
    protectedFields: z.array(z.string().max(80)).max(68),
    knowledgeReviewedRevision: RevisionSchema.nullable(),
    origin: z.strictObject({
      mode: z.enum(['managed', 'imported-copy', 'external-reference']),
      label: z.string().max(240),
      locator: z.string().max(2_048).optional(),
      sourceDigest: DigestSchema.optional(),
      observedAt: z.iso.datetime().optional(),
    }),
  }),
  z.strictObject({
    ...PageEnvelope,
    section: z.literal('body'),
    text: z.string(),
    range: z.strictObject({
      unit: z.literal('unicode-code-points'),
      start: SequenceSchema,
      endExclusive: SequenceSchema,
      total: SequenceSchema,
    }),
  }),
  z.strictObject({
    ...PageEnvelope,
    section: z.literal('properties'),
    entries: z.array(z.strictObject({ key: FieldKeySchema, field: TypedFieldSchema })),
    range: EntryRangeSchema,
  }),
  z.strictObject({
    ...PageEnvelope,
    section: z.literal('relations'),
    entries: z.array(RelationSchema),
    range: EntryRangeSchema,
  }),
]);
export const QuerySchema = z.strictObject({
  filter: z.strictObject({
    kind: KindSchema.optional(),
    projectId: IdSchema.optional(),
    text: z.string().min(1).max(200).optional(),
    property: z
      .strictObject({
        key: FieldKeySchema,
        equals: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
      })
      .optional(),
  }),
  limit: z.number().int().min(1).max(50),
  maxBytes: z.number().int().min(1_024).max(65_536),
  cursor: z.string().max(2_048).optional(),
});
export const CursorSchema = z.strictObject({
  version: z.literal(1),
  queryDigest: DigestSchema,
  scopeDigest: DigestSchema,
  atSequence: SequenceSchema,
  afterId: IdSchema,
});
export const GrantScopeSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('space') }),
  z.strictObject({ mode: z.literal('objects'), objectIds: z.array(IdSchema).min(1).max(1_000) }),
]);
export const AgentToolSchema = z.enum([
  'space_discover',
  'objects_query',
  'object_read',
  'changes_list',
  'operation_status',
  'proposal_create',
]);

export type Locale = z.infer<typeof LocaleSchema>;
export type ObjectContent = z.infer<typeof ContentSchema>;
export type ProposalInput = z.infer<typeof ProposeSchema>;
export type ReviewInput = z.infer<typeof ReviewSchema>;
export type QueryInput = z.infer<typeof QuerySchema>;
export type PinnedRef = z.infer<typeof PinnedRefSchema>;
export type ObjectRef = z.infer<typeof ObjectRefSchema>;
export type ReadPage = z.infer<typeof ReadPageSchema>;
export type AgentTool = z.infer<typeof AgentToolSchema>;

// Deferred product capabilities are not advertised by the phase 3 agent facade.
export const deferredAgentTools = [
  'schema_describe',
  'text_search',
  'relations_expand',
  'accepted_change_read',
] as const;
