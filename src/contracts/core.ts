import { z } from 'zod';
import {
  ContentSchema,
  DigestSchema,
  GrantScopeSchema,
  IdSchema,
  KindSchema,
  OperationKeySchema,
  PinnedRefSchema,
  RevisionSchema,
  SequenceSchema,
} from './schema.js';
import type {
  ObjectContent,
  ObjectRef,
  PinnedRef,
  ProposalInput,
  ReadPage,
  ReviewInput,
  QueryInput,
  AgentTool,
} from './schema.js';
import type { Result } from './errors.js';
import type { KnowledgeReviewMetadata } from './knowledge-review.js';
export type { KnowledgeReviewMetadata, KnowledgeReviewState } from './knowledge-review.js';
import type { ContextServices, ContextUsageHint } from './context.js';
import type {
  LocalHumanServices,
  HumanQueryInput,
  HumanQueryPage,
  ImportItemState,
  ImportRunState,
} from './local.js';
export type {
  SchemaDescribeInput,
  SchemaDescription,
  TextSearchInput,
  TextSearchPage,
  RelationsExpandInitial,
  RelationsExpandInput,
  ExpandedEdge,
  RelationsExpandPage,
  AcceptedChangeReadInput,
  AcceptedChangeSummary,
  AcceptedEvidenceItem,
  AcceptedChangeEvidencePage,
  AcceptedChangePage,
} from './context.js';

export const PolicySchema = z.strictObject({
  protectedFields: z
    .array(z.string().regex(/^(title|body|relations|properties|properties\.[a-z][a-z0-9_]{0,63})$/))
    .max(68),
});
export const OriginSchema = z.strictObject({
  mode: z.enum(['managed', 'imported-copy', 'external-reference']),
  label: z.string().max(240),
  locator: z.string().max(2_048).optional(),
  sourceDigest: DigestSchema.optional(),
  observedAt: z.iso.datetime().optional(),
});
export const CreateObjectSchema = z.strictObject({
  operationKey: OperationKeySchema,
  id: IdSchema.optional(),
  kind: KindSchema,
  content: ContentSchema,
  policy: PolicySchema.optional(),
  origin: OriginSchema.optional(),
  generation: SequenceSchema.optional(),
});
export const SetPolicySchema = z.strictObject({
  operationKey: OperationKeySchema,
  objectId: IdSchema,
  expectedRevision: RevisionSchema,
  policy: PolicySchema,
});
export const KnowledgeReviewSchema = z.strictObject({
  operationKey: OperationKeySchema,
  ref: PinnedRefSchema,
});
export const GrantSpecSchema = z
  .strictObject({
    label: z.string().min(1).max(120),
    scope: GrantScopeSchema,
    capabilities: z.strictObject({ read: z.boolean(), propose: z.boolean() }),
    creation: z
      .strictObject({ enabled: z.boolean(), kinds: z.array(z.enum(['document', 'record'])).max(2) })
      .optional(),
  })
  .refine(
    (s) => !s.capabilities.propose || s.capabilities.read,
    'Propose access requires read access',
  )
  .refine(
    (s) =>
      !s.creation?.enabled ||
      (s.scope.mode === 'space' && s.capabilities.propose && s.creation.kinds.length > 0),
    'Creation requires explicit space/propose access and kinds',
  );
export const CreateGrantSchema = z.strictObject({
  operationKey: OperationKeySchema,
  spec: GrantSpecSchema,
});
export const UpdateGrantSchema = z.strictObject({
  operationKey: OperationKeySchema,
  grantId: IdSchema,
  expectedGeneration: RevisionSchema,
  spec: GrantSpecSchema,
  revoked: z.boolean(),
});
export const DraftSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('editor') }),
  z.strictObject({ kind: z.literal('proposal'), proposalId: IdSchema }),
  z.strictObject({ kind: z.literal('revision'), ref: PinnedRefSchema }),
]);
export const DraftTargetSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('existing'),
    objectId: IdSchema,
    baseRevision: RevisionSchema,
  }),
  z.strictObject({ state: z.literal('new'), kind: z.enum(['document', 'record']) }),
]);
export const SaveDraftSchema = z.strictObject({
  operationKey: OperationKeySchema,
  draftId: IdSchema,
  generation: SequenceSchema,
  target: DraftTargetSchema,
  source: DraftSourceSchema,
  content: ContentSchema,
});
export const DraftListSchema = z.strictObject({
  beforeId: IdSchema.optional(),
  limit: z.number().int().min(1).max(50),
});
export const DiscardDraftSchema = z.strictObject({
  operationKey: OperationKeySchema,
  draftId: IdSchema,
  expectedGeneration: SequenceSchema,
});
export const PageRequestSchema = z.strictObject({
  after: SequenceSchema.optional(),
  through: SequenceSchema.optional(),
  limit: z.number().int().min(1).max(50),
});
export const HistorySchema = z.strictObject({
  objectId: IdSchema,
  beforeRevision: RevisionSchema.optional(),
  limit: z.number().int().min(1).max(50),
});
export const ProposalListSchema = z.strictObject({
  status: z.enum(['pending', 'conflicted', 'applied', 'rejected']).optional(),
  afterId: IdSchema.optional(),
  limit: z.number().int().min(1).max(50),
});
export const MarkSeenSchema = z.strictObject({ proposalId: IdSchema, seen: z.boolean() });
export const OperationStatusSchema = z.strictObject({ operationKey: OperationKeySchema });

export type Kind = z.infer<typeof KindSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Origin = z.infer<typeof OriginSchema>;
export type GrantSpec = z.infer<typeof GrantSpecSchema>;
export type CreateObjectInput = z.infer<typeof CreateObjectSchema>;
export type GrantCreationInput = z.infer<typeof CreateGrantSchema>;
export type SaveDraftInput = z.infer<typeof SaveDraftSchema>;
export type Actor = { kind: 'human' | 'agent'; namespace: string };
export type SpaceStatus = {
  spaceId: string;
  instanceId: string;
  title: string;
  example: boolean;
  formatVersion: 2;
  coreContractVersion: 2;
  authoritySequence: number;
  activitySequence: number;
};
export type KnowledgeReview = {
  reviewedRevision: number;
  objectRef: PinnedRef;
  reviewedAt: string;
  actor: Actor;
} | null;
export type RelationTarget = {
  relationId: string;
  declared: ObjectRef;
  status: 'available' | 'unavailable';
  resolved: PinnedRef | null;
  title?: string;
  kind?: Kind;
};
export type ObjectSnapshot = {
  spaceId: string;
  instanceId: string;
  id: string;
  kind: Kind;
  revision: number;
  lifecycle: 'active' | 'archived';
  content: ObjectContent;
  policy: Policy;
  origin: Origin;
  digest: string;
  parentRevision: number | null;
  createdAt: string;
  actor: Actor;
  changeId: string;
  authoritySequence: number;
  knowledgeReview: KnowledgeReview;
};
export type ObjectView = {
  object: ObjectSnapshot;
  currentRevision: number;
  relationTargets: RelationTarget[];
};
export type ObjectSummary = KnowledgeReviewMetadata & {
  ref: PinnedRef;
  title: string;
  kind: Kind;
  lifecycle: 'active' | 'archived';
  digest: string;
  updatedAt: string;
};
export type WriteResult = {
  state: 'created' | 'saved' | 'unchanged' | 'archived' | 'restored';
  object: ObjectSnapshot;
  changeId: string | null;
  authoritySequence: number;
  generation: number | null;
};
export type GrantSummary = {
  id: string;
  generation: number;
  label: string;
  scope: GrantSpec['scope'];
  capabilities: GrantSpec['capabilities'];
  creation: { enabled: boolean; kinds: ('document' | 'record')[] };
  revoked: boolean;
  createdAt: string;
};
// Token is an ephemeral issuance field; only the summary is in the durable receipt.
// A same-key retry returns the same summary with token:null, never a stored secret.
export type IssuedGrant = { grant: GrantSummary; token: string | null };
export type ProposalStatus = 'pending' | 'conflicted' | 'applied' | 'rejected';
export type ProposalSnapshot = {
  id: string;
  action: 'create' | 'update';
  targetId: string;
  kind: Kind;
  baseRevision: number | null;
  payload: ProposalInput;
  payloadHash: string;
  grantId: string;
  status: ProposalStatus;
  statusVersion: number;
  resultRevision: number | null;
  createdAt: string;
  resolvedAt: string | null;
  conflictCode: string | null;
};
export type ProposalReceipt = Omit<ProposalSnapshot, 'payload'> & { purpose: string };
export type ProposalSummary = ProposalReceipt & { seen: boolean };
export type ProposalView = {
  proposal: ProposalSnapshot;
  base: ObjectSnapshot | null;
  current: ObjectSnapshot | null;
  proposedContent: ObjectContent;
  seen: boolean;
};
export type ReviewResult = {
  outcome: 'applied' | 'rejected' | 'conflicted';
  proposal: ProposalSnapshot;
  object: ObjectSnapshot | null;
  changeId: string;
  authoritySequence: number;
};
export type ScopeSummary = {
  mode: 'space' | 'objects';
  digest: string;
  objectCount: number | null;
};
export type RevisionSummary = Pick<
  ObjectSnapshot,
  'revision' | 'digest' | 'actor' | 'lifecycle' | 'changeId' | 'createdAt' | 'authoritySequence'
> & { title: string; ref: PinnedRef };
export type HistoryPage = {
  items: RevisionSummary[];
  nextBeforeRevision: number | null;
  truncated: boolean;
};
export type ProposalPage = {
  items: ProposalSummary[];
  nextAfterId: string | null;
  truncated: boolean;
};
export type DraftPage = { items: DraftReceipt[]; nextBeforeId: string | null; truncated: boolean };
export type QueryPage = {
  items: ObjectSummary[];
  executed: QueryInput['filter'];
  scope: ScopeSummary;
  authoritySequence: number;
  nextCursor: string | null;
  truncated: boolean;
  returnedBytes: number;
  searchMode: 'none' | 'literal' | 'trigram-literal';
};
export type ChangeSummary = {
  acceptedChangeReadable: boolean;
  sequence: number;
  id: string;
  action: string;
  objectId: string | null;
  beforeRevision: number | null;
  afterRevision: number | null;
  proposalId: string | null;
  actor: Actor;
  recordedAt: string;
};
export type DeliveredReference = {
  ref: PinnedRef;
  section?: 'summary' | 'body' | 'properties' | 'relations';
  range?: {
    start: number;
    endExclusive: number;
    total: number;
    unit: 'unicode-code-points' | 'entries';
  };
};
export type ActivityEntry = {
  id: number;
  kind: string;
  stage: 'prepared' | 'committed-change';
  actor: Actor;
  recordedAt: string;
  objectId: string | null;
  proposalId: string | null;
  authoritySequence: number | null;
  tool: string | null;
  delivered: DeliveredReference[];
  details: Record<string, string | number | boolean | null>;
};
export type SequencePage<T> = {
  items: T[];
  through: number;
  nextAfter: number | null;
  truncated: boolean;
};
export type DraftReceipt = {
  draftId: string;
  generation: number;
  target: SaveDraftInput['target'];
  source: SaveDraftInput['source'];
  digest: string;
  retained: boolean;
  updatedAt: string;
};
export type DraftSnapshot = DraftReceipt & { content: ObjectContent };
export type ReceiptBusinessOutcome =
  | {
      kind: 'object';
      state: WriteResult['state'];
      ref: PinnedRef;
      generation: number | null;
      authoritySequence: number;
      changeId: string | null;
    }
  | {
      kind: 'review';
      outcome: ReviewResult['outcome'];
      proposalId: string;
      statusVersion: number;
      payloadHash: string;
      objectRef: PinnedRef | null;
      authoritySequence: number;
      changeId: string;
    }
  | {
      kind: 'proposal';
      proposalId: string;
      targetId: string;
      status: ProposalStatus;
      statusVersion: number;
      payloadHash: string;
    }
  | { kind: 'draft'; draftId: string; generation: number; retained: boolean; digest: string }
  | { kind: 'grant'; grantId: string; generation: number; revoked: boolean }
  | { kind: 'knowledge-review'; ref: PinnedRef }
  | {
      kind: 'import';
      runId: string;
      manifestDigest: string;
      state: ImportRunState;
      progressRevision: number;
    }
  | {
      kind: 'import-item';
      runId: string;
      itemId: string;
      state: ImportItemState;
      ref: PinnedRef | null;
    };
export type ReceiptSummary = {
  operationKey: string;
  command: string;
  requestDigest: string;
  recordedAt: string;
  outcome: 'succeeded' | 'failed';
  errorCode: string | null;
  business: ReceiptBusinessOutcome | null;
  objectRef: PinnedRef | null;
  proposalId: string | null;
  changeId: string | null;
};
export type OperationStatus =
  | { state: 'not_found'; operationKey: string; interpretation: 'not_a_failure_confirmation' }
  | { state: 'recorded'; receipt: ReceiptSummary; currentProposal: ProposalSummary | null };
export type DiscoverResult = {
  implementedTools: AgentTool[];
  usageHints: ContextUsageHint[];
  status: SpaceStatus;
  kinds: Kind[];
  scope: ScopeSummary;
  capabilities: GrantSpec['capabilities'];
  creation: GrantSummary['creation'];
  limits: { objectBytes: number; readBytes: number; queryItems: number };
};

export interface HumanServices extends ContextServices, LocalHumanServices {
  status(): Result<SpaceStatus>;
  createObject(input: CreateObjectInput): Result<WriteResult>;
  saveObject(input: z.infer<typeof import('./schema.js').HumanSaveSchema>): Result<WriteResult>;
  readObject(input: z.infer<typeof import('./schema.js').HumanReadSchema>): Result<ObjectView>;
  query(input: HumanQueryInput): Result<HumanQueryPage>;
  history(input: z.infer<typeof HistorySchema>): Result<HistoryPage>;
  setPolicy(input: z.infer<typeof SetPolicySchema>): Result<WriteResult>;
  markKnowledgeReviewed(input: z.infer<typeof KnowledgeReviewSchema>): Result<KnowledgeReview>;
  createGrant(input: GrantCreationInput): Result<IssuedGrant>;
  updateGrant(input: z.infer<typeof UpdateGrantSchema>): Result<GrantSummary>;
  listGrants(): Result<GrantSummary[]>;
  getProposal(input: { proposalId: string }): Result<ProposalView>;
  listProposals(input: z.infer<typeof ProposalListSchema>): Result<ProposalPage>;
  markProposalSeen(
    input: z.infer<typeof MarkSeenSchema>,
  ): Result<{ proposalId: string; seen: boolean }>;
  reviewProposal(input: ReviewInput): Result<ReviewResult>;
  undoChange(input: z.infer<typeof import('./schema.js').UndoSchema>): Result<WriteResult>;
  saveDraft(input: SaveDraftInput): Result<DraftReceipt>;
  listDrafts(input: z.infer<typeof DraftListSchema>): Result<DraftPage>;
  readDraft(input: { draftId: string }): Result<DraftSnapshot>;
  discardDraft(input: z.infer<typeof DiscardDraftSchema>): Result<DraftReceipt>;
  changes(input: z.infer<typeof PageRequestSchema>): Result<SequencePage<ChangeSummary>>;
  activity(input: z.infer<typeof PageRequestSchema>): Result<SequencePage<ActivityEntry>>;
  operationStatus(input: z.infer<typeof OperationStatusSchema>): Result<OperationStatus>;
}
export interface AgentServices extends ContextServices {
  discover(): Result<DiscoverResult>;
  query(input: QueryInput): Result<QueryPage>;
  read(input: z.infer<typeof import('./schema.js').ReadSchema>): Result<ReadPage>;
  propose(input: ProposalInput): Result<ProposalReceipt>;
  changes(input: z.infer<typeof PageRequestSchema>): Result<SequencePage<ChangeSummary>>;
  operationStatus(input: z.infer<typeof OperationStatusSchema>): Result<OperationStatus>;
}
