import { z } from 'zod';
import { OriginSchema, PolicySchema } from './core.js';
import type { DraftReceipt, DraftSnapshot, ObjectSummary, QueryPage, WriteResult } from './core.js';
import {
  ContentSchema,
  DigestSchema,
  IdSchema,
  OperationKeySchema,
  PinnedRefSchema,
  QuerySchema,
  RevisionSchema,
  SequenceSchema,
} from './schema.js';
import type { Result, ErrorCode } from './errors.js';
import { errorCodes } from './errors.js';
import type { BoundRequest } from './desktop.js';

export const LOCAL_FORMAT_VERSION = 2;
export const LOCAL_CORE_VERSION = 2;
export const localLimits = Object.freeze({
  depth: 12,
  visited: 1_000,
  selectedBytes: 52_428_800,
  objectBytes: 1_048_576,
  planBytes: 1_048_576,
  pageBytes: 65_536,
  databaseBytes: 536_870_912,
});
export const requiredLocalErrorCodes = [
  'IMPORT_SOURCE_CHANGED',
  'IMPORT_PLAN_CHANGED',
  'DESTINATION_EXISTS',
  'UNDO_NOT_SUPPORTED',
] as const;
export const LocalProfileSchema = z.enum(['plain-files/v1', 'knowledge-project-repos/v1']);
export const LifecycleSchema = z.enum(['active', 'archived']);
export const HumanQuerySchema = QuerySchema.extend({
  filter: QuerySchema.shape.filter.extend({
    lifecycle: z.enum(['active', 'archived', 'all']).optional(),
  }),
});
export type HumanQueryInput = z.infer<typeof HumanQuerySchema>;
export type HumanQueryPage = Omit<QueryPage, 'executed'> & { executed: HumanQueryInput['filter'] };
export const LifecycleInputSchema = z.strictObject({
  operationKey: OperationKeySchema,
  objectId: IdSchema,
  expectedRevision: RevisionSchema,
  lifecycle: LifecycleSchema,
});

/** Trusted Core/Main only. No path-bearing schema is forwarded by preload. */
export const LocalPathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'Absolute local path required');
export const SourceFingerprintSchema = z.strictObject({
  identity: DigestSchema,
  kind: z.enum(['file', 'directory']),
  bytes: SequenceSchema,
  modifiedNs: z.string().regex(/^-?\d+$/),
});
export const TrustedSelectionSchema = z.strictObject({ path: LocalPathSchema });
export const PrepareImportSchema = z.strictObject({
  selections: z.array(TrustedSelectionSchema).min(1).max(1_000),
  profileId: LocalProfileSchema,
});
export const ImportIssueSchema = z.enum([
  'symlink',
  'excluded',
  'depth',
  'visited',
  'selected-bytes',
  'unsupported',
  'not-utf8',
  'not-text',
  'not-regular',
  'unreadable',
  'object-bytes',
  'path-length',
]);
export const ImportActionSchema = z.enum([
  'managed-copy',
  'external-reference',
  'project-group',
  'link-relations',
  'skip',
]);
export const PreviewEntrySchema = z.strictObject({
  id: IdSchema,
  relativePath: z.string().max(2_048),
  title: z.string().max(240),
  kind: z.enum(['text', 'repository', 'file-reference', 'group', 'skipped']),
  suggestedAction: ImportActionSchema,
  bytes: SequenceSchema,
  groupId: IdSchema.nullable(),
  issue: ImportIssueSchema.nullable(),
});
export type PreviewEntry = z.infer<typeof PreviewEntrySchema>;
export const PreviewGroupSchema = z.strictObject({
  id: IdSchema,
  title: z.string().max(240),
  relativePath: z.string().max(2_048),
});
export const ScanSummarySchema = z.strictObject({
  visited: SequenceSchema,
  managedBytes: SequenceSchema,
  candidates: SequenceSchema,
  skipped: SequenceSchema,
  truncated: z.boolean(),
  limitReasons: z.array(ImportIssueSchema).max(10),
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;

export const PreparedSourceSchema = z.strictObject({
  entry: PreviewEntrySchema,
  path: LocalPathSchema.nullable(),
  fingerprint: SourceFingerprintSchema.nullable(),
  rawDigest: DigestSchema.nullable(),
  observedAt: z.iso.datetime(),
});
export const PreparedImportSchema = z.strictObject({
  id: IdSchema,
  profileId: LocalProfileSchema,
  digest: DigestSchema,
  roots: z.array(LocalPathSchema).max(1_000),
  groups: z.array(PreviewGroupSchema).max(1_000),
  sources: z.array(PreparedSourceSchema).max(1_000),
  summary: ScanSummarySchema,
});
export type PreparedImport = z.infer<typeof PreparedImportSchema>;
export type PreparedSource = z.infer<typeof PreparedSourceSchema>;
export type ImportPreviewPage = {
  planId: string;
  planDigest: string;
  profileId: PreparedImport['profileId'];
  rootLabels: string[];
  rootCount: number;
  groups: z.infer<typeof PreviewGroupSchema>[];
  entries: PreviewEntry[];
  summary: ScanSummary;
  nextCursor: string | null;
  returnedBytes: number;
};
export const ImportPreviewReadSchema = z.strictObject({
  planId: IdSchema,
  expectedPlanDigest: DigestSchema,
  cursor: z.string().max(4_096).optional(),
  maxBytes: z.number().int().min(1_024).max(65_536),
});
const ProjectChoiceSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('existing'), objectId: IdSchema }),
  z.strictObject({ mode: z.literal('group'), groupId: IdSchema }),
]);
export const ImportChoiceSchema = z.strictObject({
  itemId: IdSchema,
  action: z.enum(['managed-copy', 'external-reference', 'skip']),
  title: z.string().max(240).optional(),
  project: ProjectChoiceSchema,
  useAssetIds: z.array(IdSchema).max(20),
});
export const ConfirmImportSchema = z
  .strictObject({
    operationKey: OperationKeySchema,
    planId: IdSchema,
    expectedPlanDigest: DigestSchema,
    choices: z.array(ImportChoiceSchema).max(1_000),
    groups: z
      .array(
        z.strictObject({
          groupId: IdSchema,
          title: z.string().max(240),
          existingProjectId: IdSchema.optional(),
        }),
      )
      .max(1_000),
  })
  .refine(
    (p) =>
      new Set(p.choices.map((i) => i.itemId)).size === p.choices.length &&
      new Set(p.groups.map((g) => g.groupId)).size === p.groups.length,
    'Duplicate import choice',
  );
export type ConfirmImportInput = z.infer<typeof ConfirmImportSchema>;

/** Immutable approved payload; body bytes are supplied only by verified source capture. */
export const ImportManifestItemSchema = z.strictObject({
  id: IdSchema,
  targetId: IdSchema,
  relativePath: z.string().max(2_048),
  action: ImportActionSchema,
  kind: z.enum(['document', 'project', 'asset']),
  sourcePath: LocalPathSchema.nullable(),
  fingerprint: SourceFingerprintSchema.nullable(),
  rawDigest: DigestSchema.nullable(),
  sourceKey: DigestSchema,
  sourceVersion: DigestSchema,
  content: ContentSchema,
  origin: OriginSchema,
  dependsOn: z.array(IdSchema).max(40),
  expectedRevision: RevisionSchema.nullable(),
});
export const ImportManifestSchema = z
  .strictObject({
    id: IdSchema,
    spaceId: IdSchema,
    instanceId: IdSchema,
    profileId: LocalProfileSchema,
    planDigest: DigestSchema,
    createdAt: z.iso.datetime(),
    parentRunId: IdSchema.optional(),
    items: z.array(ImportManifestItemSchema).min(1).max(1_000),
  })
  .refine(
    (p) =>
      new Set(p.items.map((i) => i.id)).size === p.items.length &&
      new Set(
        p.items
          .filter((i) => !['link-relations', 'skip'].includes(i.action))
          .map((i) => i.targetId),
      ).size === p.items.filter((i) => !['link-relations', 'skip'].includes(i.action)).length,
    'Duplicate item identity',
  );
export type ImportManifest = z.infer<typeof ImportManifestSchema>;
export type ImportManifestItem = z.infer<typeof ImportManifestItemSchema>;
export const StartImportSchema = z.strictObject({
  operationKey: OperationKeySchema,
  manifest: ImportManifestSchema,
  expectedManifestDigest: DigestSchema,
});
export const ImportRunRefSchema = z.strictObject({
  runId: IdSchema,
  expectedManifestDigest: DigestSchema,
});
export const PauseImportSchema = ImportRunRefSchema.extend({ operationKey: OperationKeySchema });
export const ResumeImportSchema = ImportRunRefSchema.extend({ operationKey: OperationKeySchema });
export const ImportStepSchema = ImportRunRefSchema.extend({
  operationKey: OperationKeySchema,
  itemId: IdSchema,
  body: z.string().max(1_000_000).optional(),
  capturedDigest: DigestSchema.nullable(),
  captureError: z
    .enum(['SOURCE_UNAVAILABLE', 'IMPORT_SOURCE_CHANGED', 'UNSUPPORTED_IMPORT', 'LIMIT_EXCEEDED'])
    .optional(),
});
export const ImportRetrySchema = ImportRunRefSchema.extend({
  operationKey: OperationKeySchema,
  itemIds: z.array(IdSchema).min(1).max(1_000),
});
export const ImportRunReadSchema = z.strictObject({
  runId: IdSchema,
  afterItemId: IdSchema.optional(),
  limit: z.number().int().min(1).max(50),
  maxBytes: z.number().int().min(1_024).max(65_536),
});
export const ImportListSchema = z.strictObject({
  beforeId: IdSchema.optional(),
  limit: z.number().int().min(1).max(50),
});
export type ImportItemState = 'pending' | 'committed' | 'reused' | 'skipped' | 'failed' | 'blocked';
export type ImportRunState =
  'ready' | 'running' | 'paused' | 'needs-repreview' | 'finished' | 'finished-with-errors';
export const ImportItemResultSchema = z.strictObject({
  id: IdSchema,
  targetId: IdSchema,
  relativePath: z.string().max(2_048),
  title: z.string().max(240),
  action: ImportActionSchema,
  state: z.enum(['pending', 'committed', 'reused', 'skipped', 'failed', 'blocked']),
  attempt: SequenceSchema,
  operationKey: OperationKeySchema,
  originalRef: PinnedRefSchema.nullable(),
  error: z.strictObject({ code: z.enum(errorCodes), retryable: z.boolean() }).nullable(),
});
export type ImportItemResult = z.infer<typeof ImportItemResultSchema>;
export type ImportRunSummary = {
  id: string;
  manifestDigest: string;
  profileId: PreparedImport['profileId'];
  createdAt: string;
  state: ImportRunState;
  progressRevision: number;
  total: number;
  committed: number;
  reused: number;
  skipped: number;
  failed: number;
  blocked: number;
  needsSourceConfirmation: boolean;
};
export type ImportRunPage = {
  run: ImportRunSummary;
  items: ImportItemResult[];
  nextAfterItemId: string | null;
  returnedBytes: number;
  /** Main-only live coordinator failure; absent after restart, never a durable item result. */
  coordinatorError?: import('./errors.js').Failure['error'];
};
export type ImportRunsPage = { items: ImportRunSummary[]; nextBeforeId: string | null };
export const RelinkInputSchema = z.strictObject({
  operationKey: OperationKeySchema,
  objectId: IdSchema,
  expectedRevision: RevisionSchema,
  locator: LocalPathSchema,
  observedAt: z.iso.datetime(),
});
export const RecoverableListSchema = z.strictObject({
  cursor: z.string().max(4_096).optional(),
  limit: z.number().int().min(1).max(50),
});
export const RecoverableReadSchema = z.strictObject({ recoveryRef: z.string().min(1).max(4_096) });
export const RecoverableCopySchema = RecoverableReadSchema.extend({
  operationKey: OperationKeySchema,
  newDraftId: IdSchema,
});
export type RecoveryDraftSummary = DraftReceipt & {
  recoveryRef: string;
  fromOtherInstallation: true;
};
export type RecoveryDraftPage = { items: RecoveryDraftSummary[]; nextCursor: string | null };
export type RecoveryDraftView = DraftSnapshot & {
  recoveryRef: string;
  fromOtherInstallation: true;
};
export type RecoveryDraftCopy = DraftReceipt & {
  copiedFrom: { draftId: string; generation: number; digest: string };
};

export interface LocalHumanServices {
  setLifecycle(input: z.infer<typeof LifecycleInputSchema>): Result<WriteResult>;
  /** Trusted Main only: locator is injected after native selection, never forwarded raw. */
  relinkExternalAsset(input: z.infer<typeof RelinkInputSchema>): Result<WriteResult>;
  /** Trusted import coordinator only. Renderer cannot assert a verified manifest/capture. */
  startImport(input: z.infer<typeof StartImportSchema>): Result<ImportRunSummary>;
  /** Trusted import coordinator only; capture is rechecked outside and inside the transaction. */
  commitImportItem(input: z.infer<typeof ImportStepSchema>): Result<ImportItemResult>;
  retryImport(input: z.infer<typeof ImportRetrySchema>): Result<ImportRunSummary>;
  pauseImport(input: z.infer<typeof PauseImportSchema>): Result<ImportRunSummary>;
  /** Only resumes the current confirmed source authorization; otherwise SOURCE_CHANGED. */
  resumeImport(input: z.infer<typeof ResumeImportSchema>): Result<ImportRunSummary>;
  getImport(input: z.infer<typeof ImportRunReadSchema>): Result<ImportRunPage>;
  /** Trusted import coordinator only; includes confirmed source paths. */
  getImportManifest(input: z.infer<typeof ImportRunRefSchema>): Result<ImportManifest>;
  listImports(input: z.infer<typeof ImportListSchema>): Result<ImportRunsPage>;
  listRecoverableDrafts(input: z.infer<typeof RecoverableListSchema>): Result<RecoveryDraftPage>;
  readRecoverableDraft(input: z.infer<typeof RecoverableReadSchema>): Result<RecoveryDraftView>;
  copyRecoverableDraft(input: z.infer<typeof RecoverableCopySchema>): Result<RecoveryDraftCopy>;
}

export const ArtifactOperationSchema = z.strictObject({
  operationId: IdSchema,
  destination: LocalPathSchema,
});
/** Trusted destination operation; Main pins the exact reviewed backup bytes. */
export const RestoreArtifactOperationSchema = ArtifactOperationSchema.extend({
  expectedBackupDigest: DigestSchema.optional(),
});
export type ArtifactKind = 'readable-export' | 'sqlite-backup' | 'restored-space';
export const SnapshotIdentitySchema = z.strictObject({
  spaceId: IdSchema,
  instanceId: IdSchema,
  formatVersion: z.literal(2),
  coreContractVersion: z.literal(2),
  authoritySequence: SequenceSchema,
  activitySequence: SequenceSchema,
});
export const SnapshotCountsSchema = z.strictObject({
  objects: SequenceSchema,
  revisions: SequenceSchema,
  proposals: SequenceSchema,
  receipts: SequenceSchema,
  retainedDrafts: SequenceSchema,
  externalReferences: SequenceSchema,
});
export type SnapshotIdentity = z.infer<typeof SnapshotIdentitySchema>;
export type SnapshotCounts = z.infer<typeof SnapshotCountsSchema>;
export const BackupManifestSchema = z.strictObject({
  format: z.literal('agentspace-backup/v1'),
  complete: z.literal(true),
  operationId: IdSchema,
  requestDigest: DigestSchema,
  createdAt: z.iso.datetime(),
  database: z.strictObject({
    name: z.literal('backup.sqlite'),
    sha256: DigestSchema,
    bytes: SequenceSchema,
  }),
  snapshot: SnapshotIdentitySchema,
  counts: SnapshotCountsSchema,
  externalTargetBytesIncluded: z.literal(false),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;
export const ExportIndexEntrySchema = z.strictObject({
  id: IdSchema,
  revision: RevisionSchema,
  metadataSha256: DigestSchema,
  bodySha256: DigestSchema,
});
export const ExportManifestSchema = z.strictObject({
  format: z.literal('agentspace-export/v1'),
  complete: z.literal(true),
  operationId: IdSchema,
  requestDigest: DigestSchema,
  createdAt: z.iso.datetime(),
  snapshot: SnapshotIdentitySchema,
  counts: SnapshotCountsSchema,
  index: z.strictObject({
    name: z.literal('objects.jsonl'),
    sha256: DigestSchema,
    entries: SequenceSchema,
    bytes: SequenceSchema,
  }),
  includesHistory: z.literal(false),
  includesDrafts: z.literal(false),
  externalTargetBytesIncluded: z.literal(false),
  historicalPinBodiesIncluded: z.literal(false),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
export const ExportObjectSchema = z.strictObject({
  objectId: IdSchema,
  kind: z.enum(['document', 'project', 'record', 'asset']),
  revision: RevisionSchema,
  lifecycle: LifecycleSchema,
  content: ContentSchema.omit({ body: true }),
  policy: PolicySchema,
  origin: OriginSchema,
  bodySha256: DigestSchema,
  bodyBytes: SequenceSchema,
});
export const ArtifactReceiptSchema = z.strictObject({
  operationId: IdSchema,
  requestDigest: DigestSchema,
  kind: z.enum(['readable-export', 'sqlite-backup', 'restored-space']),
  completedAt: z.iso.datetime(),
  snapshot: SnapshotIdentitySchema,
  counts: SnapshotCountsSchema,
  artifactDigest: DigestSchema,
  externalTargetBytesIncluded: z.literal(false),
});
export type ArtifactReceipt = z.infer<typeof ArtifactReceiptSchema>;
export const RestoredArtifactSchema = ArtifactReceiptSchema.extend({
  kind: z.literal('restored-space'),
  sourceInstanceId: IdSchema,
  disabledGrants: SequenceSchema,
});
export type RestoredArtifact = z.infer<typeof RestoredArtifactSchema>;
export type LocalProgress = {
  stage:
    | 'scanning'
    | 'awaiting-confirmation'
    | 'importing'
    | 'copying'
    | 'writing'
    | 'validating'
    | 'complete'
    | 'paused'
    | 'failed';
  completed: number;
  total: number | null;
  bytes: number | null;
  receipt: ArtifactReceipt | null;
  error: { code: ErrorCode; retryable: boolean } | null;
};

/** Native requests use chooser-selected locations and opaque handles, never renderer paths or namespaces. */
export const LocalHandleSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ChooseImportSchema = z.strictObject({
  mode: z.enum(['files', 'folder']),
  profileId: LocalProfileSchema,
});
export const ReadPreviewHandleSchema = z.strictObject({
  handle: LocalHandleSchema,
  cursor: z.string().max(4_096).optional(),
  maxBytes: z.number().int().min(1_024).max(65_536),
});
export const ConfirmImportHandleSchema = z
  .strictObject({
    handle: LocalHandleSchema,
    operationKey: ConfirmImportSchema.shape.operationKey,
    expectedPlanDigest: ConfirmImportSchema.shape.expectedPlanDigest,
    choices: ConfirmImportSchema.shape.choices,
    groups: ConfirmImportSchema.shape.groups,
  })
  .refine(
    (p) =>
      new Set(p.choices.map((i) => i.itemId)).size === p.choices.length &&
      new Set(p.groups.map((g) => g.groupId)).size === p.groups.length,
    'Duplicate import choice',
  );
export const TransferRequestSchema = z.strictObject({ operationId: IdSchema });
export const HandleRequestSchema = z.strictObject({ handle: LocalHandleSchema });
export const RestoreBackupRequestSchema = HandleRequestSchema.extend({ operationId: IdSchema });
export const RelinkChooseSchema = z.strictObject({
  objectId: IdSchema,
  expectedRevision: RevisionSchema,
});
export const RelinkConfirmSchema = z.strictObject({
  handle: LocalHandleSchema,
  operationKey: OperationKeySchema,
  expectedRevision: RevisionSchema,
});
export type PreviewSession = { handle: string; page: ImportPreviewPage };
export type RelinkSession = {
  handle: string;
  objectId: string;
  expectedRevision: number;
  oldLabel: string;
  newLabel: string;
};
export type TransferSession = { handle: string; kind: ArtifactKind; destinationLabel: string };
export type RestorePreview = {
  handle: string;
  snapshot: SnapshotIdentity;
  counts: SnapshotCounts;
  externalTargetBytesIncluded: false;
};
export type ImportResumeSession =
  | { state: 'resumed'; run: ImportRunSummary }
  | { state: 'confirmation-required'; preview: PreviewSession }
  | { state: 'cancelled'; run: ImportRunSummary };
export interface LocalDesktopMethods {
  chooseImport(
    input: BoundRequest<z.infer<typeof ChooseImportSchema>>,
  ): Promise<Result<PreviewSession | null>>;
  readImportPreview(
    input: BoundRequest<z.infer<typeof ReadPreviewHandleSchema>>,
  ): Promise<Result<ImportPreviewPage>>;
  confirmImport(
    input: BoundRequest<z.infer<typeof ConfirmImportHandleSchema>>,
  ): Promise<Result<ImportRunSummary>>;
  /** Reattachment opens a native source chooser and a new approval; no silent path replay. */
  resumeImport(
    input: BoundRequest<z.infer<typeof ResumeImportSchema>>,
  ): Promise<Result<ImportResumeSession>>;
  exportCurrent(
    input: BoundRequest<z.infer<typeof TransferRequestSchema>>,
  ): Promise<Result<TransferSession | null>>;
  backupSpace(
    input: BoundRequest<z.infer<typeof TransferRequestSchema>>,
  ): Promise<Result<TransferSession | null>>;
  chooseBackup(): Promise<Result<RestorePreview | null>>;
  restoreBackup(
    input: z.infer<typeof RestoreBackupRequestSchema>,
  ): Promise<Result<TransferSession | null>>;
  readLocalTransfer(input: z.infer<typeof HandleRequestSchema>): Promise<Result<LocalProgress>>;
  openRestoredSpace(
    input: z.infer<typeof HandleRequestSchema>,
  ): Promise<Result<import('./app.js').SpaceSession>>;
  chooseRelink(
    input: BoundRequest<z.infer<typeof RelinkChooseSchema>>,
  ): Promise<Result<RelinkSession | null>>;
  confirmRelink(
    input: BoundRequest<z.infer<typeof RelinkConfirmSchema>>,
  ): Promise<Result<WriteResult>>;
}

export type ArchivedObjectSummary = ObjectSummary;
