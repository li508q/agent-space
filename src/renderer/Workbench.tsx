import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  BookOpen,
  ChevronLeft,
  FileText,
  Folder,
  ListChecks,
  Search,
  Activity,
  PanelLeft,
  Plus,
} from 'lucide-react';
import type { AppPreferences, DesktopApi, MenuCommand, SpaceSession } from '../contracts/app.js';
import type {
  ActivityEntry,
  DraftReceipt,
  DraftSnapshot,
  GrantSummary,
  ObjectSummary,
  ObjectSnapshot,
  ObjectView,
  ProposalView,
  SpaceStatus,
  WriteResult,
  Kind,
  KnowledgeReviewState,
} from '../contracts/core.js';
import type { ErrorCode } from '../contracts/errors.js';
import type { Result } from '../contracts/errors.js';
import type { HumanQueryInput, RelinkSession } from '../contracts/local.js';
import type { ObjectContent, ObjectRef, QueryInput } from '../contracts/schema.js';
import { formatNumber, t, titleText, type Locale } from './i18n/index.js';
import { bound, RequestGate, sameBinding } from './state/binding.js';
import { EditorSession, type EditorSnapshot } from './state/editor.js';
import {
  EditorTransitions,
  type TransitionStage,
  type TransitionTicket,
} from './state/transition.js';
import { OperationTask } from './state/operation.js';
import { RecentWork } from './state/recent.js';
import { preparationKey, type AccessDraft, type AccessObject } from './state/collaboration.js';
import {
  ProposalLists,
  collectionFor,
  collectionStatuses,
  proposalStatusKey,
  type ReviewCollection,
} from './state/change-discovery.js';
import { recordFromFields } from './state/material.js';
import {
  ErrorNotice,
  Modal,
  newKey,
  noteFromVersion,
  TaskContext,
  ReferenceRefreshContext,
  Time,
  useLocale,
  type MakeTask,
} from './ui.js';
import { AgentAccess } from './components/AgentAccess.js';
import { ActivityPane } from './components/ActivityPane.js';
import { DetailsPane } from './components/DetailsPane.js';
import { DocumentPane } from './components/DocumentPane.js';
import { HistoryPane } from './components/HistoryPane.js';
import { Preferences } from './components/Preferences.js';
import { ReviewPane } from './components/ReviewPane.js';
import { SourceReader } from './components/SourceReader.js';
import { PropertiesEditor } from './components/PropertiesEditor.js';
import { RelationsEditor } from './components/RelationsEditor.js';
import { RecordsTable } from './components/RecordsTable.js';
import { ObjectActionsDialog } from './components/ObjectActionsDialog.js';
import { ImportDialog } from './components/ImportDialog.js';
import { RecoveryDialog } from './components/RecoveryDialog.js';
import { ContextPreparation } from './components/ContextPreparation.js';

type Destination = 'continue' | 'projects' | 'library' | 'review';
type ReaderEntry = {
  entryId: string;
  reference: ObjectRef;
  trigger?: string;
  scrollTop: number;
  region: 'context' | 'review' | 'document' | 'source' | 'table';
  fallback?: string;
  outerDocument?: { scrollTop: number; width: number; height: number; dpr: number };
};
type ReaderOrigin = {
  editorId: string | null;
  objectId: string | null;
  draftId: string | null;
  destination: Destination;
  selectedProposal: string | null;
  reviewCollection: ReviewCollection;
  aux: 'details' | 'history' | null;
  tableOpen: boolean;
  projectWriting: boolean;
  materialCount: number;
  referenceCounts: { continuation: number; assets: number };
  edited: boolean;
};
type EditorReadOptions = {
  preserveReaders?: boolean;
  reuseExisting?: boolean;
  sourceEntryId?: string;
  requireWritable?: boolean;
  returning?: boolean;
  recordRecent?: boolean;
  readingCheckpoint?: Pick<ReaderOrigin, 'materialCount' | 'referenceCounts'>;
};
export type WorkbenchHandle = {
  bindingId: string;
  openImports: () => void;
  prepareToLeave: () => Promise<boolean>;
  discardEdits: () => Promise<boolean>;
  copyEdits: () => Promise<void>;
  afterComposition: () => Promise<void>;
  lockInput: (locked: boolean, source?: 'close' | 'space') => boolean;
  command: (command: MenuCommand) => void;
};
type Props = {
  api: DesktopApi;
  session: SpaceSession;
  scale: AppPreferences['textScale'];
  preferencesBusy: boolean;
  closingLocked: boolean;
  onLocale: (locale: Locale) => void;
  onScale: (factor: AppPreferences['textScale']) => void;
};

function positionStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return localStorage;
  } catch {
    return {
      getItem: () => {
        throw new Error('UI position storage unavailable');
      },
      setItem: () => {},
    };
  }
}
const positionKey = (session: SpaceSession) =>
  `agentspace.position.${session.status.spaceId}.${session.status.instanceId}`;
function remembered(session: SpaceSession): string | null {
  try {
    const id = localStorage.getItem(positionKey(session));
    return id && /^[\da-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const Workbench = forwardRef<WorkbenchHandle, Props>(function Workbench(
  { api, session, scale, preferencesBusy, closingLocked, onLocale, onScale },
  ref,
) {
  const locale = useLocale();
  const [destination, setDestination] = useState<Destination>('continue');
  const [objects, setObjects] = useState<ObjectSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState(''),
    [kind, setKind] = useState<QueryInput['filter']['kind']>(),
    [projectId, setProjectId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<KnowledgeReviewState | ''>('');
  const recentWork = useMemo(
    () => new RecentWork(api, session, positionStorage()),
    [api, session.bindingId, session.status.spaceId, session.status.instanceId],
  );
  const recent = useSyncExternalStore(recentWork.subscribe, recentWork.getSnapshot);
  const proposalLists = useMemo(
    () => new ProposalLists(api, session),
    [api, session.bindingId, session.status.spaceId, session.status.instanceId],
  );
  const proposalState = useSyncExternalStore(proposalLists.subscribe, proposalLists.getSnapshot);
  const proposals = [
    ...proposalState.groups.pending.items,
    ...proposalState.groups.conflicted.items,
  ];
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const editorRef = useRef<EditorSession | null>(null);
  const [aux, setAux] = useState<'details' | 'history' | null>(null);
  const [metadataDialog, setMetadataDialog] = useState<
    'fields' | 'relations' | 'lifecycle' | 'relink' | null
  >(null);
  const [lifecycle, setLifecycle] = useState<'active' | 'archived' | 'all'>('active');
  const [tableOpen, setTableOpen] = useState(false);
  const [readers, setReaders] = useState<ReaderEntry[]>([]);
  const [readerEditing, setReaderEditing] = useState(false);
  const readerOrigin = useRef<ReaderOrigin | null>(null),
    readerEditTrigger = useRef<string | null>(null);
  const readerRouteEpoch = useRef(0);
  const [sourceAction, setSourceAction] = useState<{
    entryId: string;
    error: ErrorCode | null;
    archived: boolean;
    returning?: boolean;
  } | null>(null);
  const [writingRequest, setWritingRequest] = useState(0),
    [existingReaderDraft, setExistingReaderDraft] = useState(false),
    [restoreMaterialCount, setRestoreMaterialCount] = useState(0);
  const [restoreReferenceCounts, setRestoreReferenceCounts] =
    useState<ReaderOrigin['referenceCounts']>();
  const [drafts, setDrafts] = useState<DraftReceipt[]>([]),
    [draftNext, setDraftNext] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false),
    [draftError, setDraftError] = useState<ErrorCode | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]),
    [activityOpen, setActivityOpen] = useState(false);
  const [activityChangesRequest, setActivityChangesRequest] = useState(0);
  const [status, setStatus] = useState<SpaceStatus>(session.status);
  const [grants, setGrants] = useState<GrantSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextSeed, setContextSeed] = useState<ObjectSnapshot | null>(null),
    [contextOpen, setContextOpen] = useState(false),
    [contextReturn, setContextReturn] = useState<'settings' | 'imports' | null>(null),
    [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null);
  const accessCloseBlocked = useRef(false),
    contextTrigger = useRef<string | null>(null),
    contextRouteEpoch = useRef(0);
  const [importsOpen, setImportsOpen] = useState(false),
    [recoveryOpen, setRecoveryOpen] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null),
    [feedback, setFeedback] = useState(false);
  const [activityError, setActivityError] = useState<ErrorCode | null>(null);
  const [queryError, setQueryError] = useState<ErrorCode | null>(null);
  const [activityReturn, setActivityReturn] = useState<'reader' | 'proposal' | null>(null);
  const [leaveAction, setLeaveAction] = useState<{
    action: (ticket: TransitionTicket) => Promise<void>;
    stage: 'opening' | 'creating';
  } | null>(null);
  const [transitionStage, setTransitionStage] = useState<TransitionStage | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1099px)').matches);
  const [listOpen, setListOpen] = useState(true);
  const compact = narrow || scale >= 1.5;
  const alive = useRef(true),
    queryGate = useRef(new RequestGate()),
    objectGate = useRef(new RequestGate()),
    headGate = useRef(new RequestGate());
  const objectFilter: HumanQueryInput['filter'] = {
    lifecycle,
    ...(destination === 'projects' ? { kind: 'project' as const } : kind ? { kind } : {}),
    ...(text ? { text } : {}),
    ...(projectId ? { projectId } : {}),
    ...(destination === 'library' && reviewFilter ? { knowledgeReviewStates: [reviewFilter] } : {}),
  };
  const objectQueryKey = JSON.stringify({
    binding: session.bindingId,
    destination,
    filter: objectFilter,
  });
  const queryScope = useRef(objectQueryKey);
  queryScope.current = objectQueryKey;
  const queryChain = useRef<{
    key: string;
    cursor: string | null;
    authority: number;
    scope: string;
  } | null>(null);
  const failedQueryCursor = useRef<string | undefined>(undefined);
  const knownAuthority = useRef(session.status.authoritySequence);
  const draftEpoch = useRef(0),
    grantEpoch = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const tasks = useRef(new Map<string, OperationTask<unknown>>());
  const commandTask = useRef<{ task: OperationTask<WriteResult>; installed: boolean } | null>(null);
  const navigationRef = useRef<EditorTransitions | null>(null);
  if (!navigationRef.current)
    navigationRef.current = new EditorTransitions(
      {
        current: () => editorRef.current,
        invalidateReads: () => {
          objectGate.current.invalidate();
          headGate.current.invalidate();
          editorRef.current?.invalidateHeadReview();
        },
        changed: (stage) => {
          if (alive.current) setTransitionStage(stage);
        },
      },
      closingLocked ? ['close'] : [],
    );
  const navigation = navigationRef.current;
  const openingReference = useRef(false);
  const operations = useRef<MakeTask>((key, send) => {
    const task = new OperationTask(api, session, key, send);
    tasks.current.set(key, task);
    return task;
  });
  const currentActions = useRef({
    refreshAll: () => {},
    pollObject: () => {},
    invalidateKnowledgeReads: () => {},
  });

  async function resolveOperations() {
    for (const task of tasks.current.values()) {
      if (task.unknown || task.isPending) {
        try {
          await task.run();
        } catch {
          setError('OPERATION_UNKNOWN');
          return false;
        }
      }
    }
    return true;
  }
  async function prepareCurrent() {
    const activeEditor = editorRef.current;
    if (activeEditor && !(await activeEditor.prepareToLeave())) return false;
    if (activeEditor !== editorRef.current) return false;
    const resolved = await resolveOperations();
    return resolved && activeEditor === editorRef.current;
  }
  async function prepareToLeave() {
    await navigation.whenIdle();
    return alive.current && prepareCurrent();
  }
  async function discardCurrent() {
    if (!(await resolveOperations())) return false;
    return !editorRef.current || (await editorRef.current.discardEdits());
  }
  async function discardEdits() {
    await navigation.whenIdle();
    return alive.current && discardCurrent();
  }
  async function copyEdits() {
    const active = editorRef.current;
    if (!active) return;
    try {
      const result = await api.copyText({ text: active.getSnapshot().content.body });
      if (result.ok) setFeedback(true);
      else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    }
  }
  async function protect(
    action: (ticket: TransitionTicket) => Promise<void>,
    stage: 'opening' | 'creating' = 'opening',
    discard = false,
  ) {
    if (busy) return;
    try {
      await navigation.run(stage, discard ? discardCurrent : prepareCurrent, action, () =>
        setLeaveAction({ action, stage }),
      );
    } catch {
      if (alive.current) setError('OPERATION_UNKNOWN');
    }
  }

  function remember(id: string) {
    // UI position only. No authored material or credentials enter browser storage.
    try {
      localStorage.setItem(positionKey(session), id);
    } catch {
      /* Position is optional. */
    }
  }
  function clearReaders() {
    setActivityReturn(null);
    readerRouteEpoch.current++;
    setReaders([]);
    setReaderEditing(false);
    readerOrigin.current = null;
    readerEditTrigger.current = null;
    setSourceAction(null);
  }
  function installEditor(
    view: ObjectView | null,
    options: {
      draft?: DraftSnapshot;
      content?: ObjectContent;
      proposalId?: string;
      kind?: 'document' | 'record';
      ticket?: TransitionTicket;
      preserveReaders?: boolean;
      headVerified?: boolean;
      recordRecent?: boolean;
      readingCheckpoint?: EditorReadOptions['readingCheckpoint'];
    } = {},
  ) {
    if (!alive.current || !navigation.claimInstall(options.ticket)) return null;
    const { draft, content, proposalId, kind } = options;
    const own: EditorSession = new EditorSession(api, session, view, {
      draft,
      content,
      kind,
      source: proposalId ? { kind: 'proposal', proposalId } : undefined,
      headVerified: options.headVerified,
      onSaveStarting: () => {
        if (alive.current && editorRef.current === own)
          currentActions.current.invalidateKnowledgeReads();
      },
      onSaveFailed: () => {
        if (alive.current && editorRef.current === own) currentActions.current.refreshAll();
      },
      onSaved: (object) => {
        if (!alive.current || editorRef.current !== own) return;
        remember(object.id);
        // Re-evaluate the current kind/search/project scope rather than inserting into a stale filter.
        currentActions.current.refreshAll();
        setRefresh((value) => value + 1);
      },
    });
    navigation.inherit(own);
    headGate.current.invalidate();
    editorRef.current?.dispose();
    editorRef.current = own;
    if (!options.preserveReaders) clearReaders();
    setWritingRequest(0);
    setExistingReaderDraft(false);
    setRestoreMaterialCount(options.readingCheckpoint?.materialCount ?? 0);
    setRestoreReferenceCounts(options.readingCheckpoint?.referenceCounts);
    setEditor(own);
    setSelectedProposal(null);
    setListOpen(false);
    setAux(null);
    setTableOpen(false);
    setMetadataDialog(null);
    if (view) remember(view.object.id);
    if (view && options.recordRecent) recentWork.remember(view.object.id);
    return own;
  }
  async function readEditor(
    id: string,
    transition?: TransitionTicket,
    options: EditorReadOptions = {},
  ) {
    const ticket = objectGate.current.begin(session, id),
      previous = editorRef.current;
    const report = (code: ErrorCode | null, archived = false) => {
      if (options.sourceEntryId)
        setSourceAction({
          entryId: options.sourceEntryId,
          error: code,
          archived,
          returning: options.returning,
        });
      else setError(code);
    };
    report(null);
    try {
      const result = await api.readObject(bound(session, { objectId: id }));
      if (
        !alive.current ||
        !objectGate.current.accepts(ticket, session, id) ||
        previous !== editorRef.current
      )
        return null;
      if (result.ok) {
        if (options.requireWritable && result.value.object.lifecycle === 'archived') {
          report(null, true);
          return null;
        }
        let own: EditorSession | null;
        if (
          options.reuseExisting &&
          previous?.getSnapshot().objectId === id &&
          sameBinding(previous.session, session)
        ) {
          if (!navigation.claimInstall(transition)) return null;
          previous.observe(result.value);
          own = previous;
          setSelectedProposal(null);
          setListOpen(false);
          setAux(null);
          setTableOpen(false);
          setMetadataDialog(null);
        } else
          own = installEditor(result.value, {
            ticket: transition,
            preserveReaders: options.preserveReaders,
            recordRecent: options.recordRecent,
            readingCheckpoint: options.readingCheckpoint,
          });
        if (!own) return null;
        // Review's result/current-object action enters the document workspace.
        // Ordinary project browsing keeps its project destination.
        if (options.recordRecent && options.reuseExisting) recentWork.remember(id);
        if (destination === 'review') {
          invalidateObjectQuery();
          setDestination('library');
        }
        return own;
      } else report(result.error.code);
    } catch {
      if (alive.current && objectGate.current.accepts(ticket, session, id))
        report('OPERATION_UNKNOWN');
    }
    return null;
  }
  function openEditor(id: string) {
    void protect(async (ticket) => {
      await readEditor(id, ticket, { recordRecent: true });
    });
  }

  async function createNote(
    content: ObjectContent = { title: '', body: '', properties: {}, relations: [] },
    kind: Kind = 'document',
    ticket?: TransitionTicket,
    retryOriginal = false,
  ) {
    if (!ticket || !navigation.isCurrent(ticket)) return;
    invalidateKnowledgeReads();
    if (
      !commandTask.current ||
      commandTask.current.installed ||
      (!retryOriginal && commandTask.current.task.settled)
    ) {
      const input = {
        operationKey: newKey('create'),
        id: crypto.randomUUID(),
        kind,
        content: structuredClone(content),
        generation: 0,
      };
      commandTask.current = {
        installed: false,
        task: operations.current(input.operationKey, () => api.createObject(bound(session, input))),
      };
    }
    setBusy(true);
    setError(null);
    try {
      const result = await commandTask.current.task.run();
      if (!alive.current || !navigation.isCurrent(ticket)) return;
      if (result.ok) {
        if (
          !installEditor(
            {
              object: result.value.object,
              currentRevision: result.value.object.revision,
              relationTargets: [],
            },
            { ticket, headVerified: false, recordRecent: true },
          )
        )
          return;
        commandTask.current.installed = true;
        if (result.value.object.kind === 'project') setWritingRequest(1);
        setDestination(result.value.object.kind === 'project' ? 'projects' : 'library');
        setLifecycle('active');
        setText('');
        setKind(undefined);
        setProjectId(null);
        currentActions.current.refreshAll();
        setRefresh((value) => value + 1);
      } else {
        setError(result.error.code);
        commandTask.current = null;
        currentActions.current.refreshAll();
      }
    } catch {
      if (alive.current && navigation.isCurrent(ticket)) {
        setError('OPERATION_UNKNOWN');
        currentActions.current.refreshAll();
      }
    } finally {
      if (alive.current && navigation.isCurrent(ticket)) setBusy(false);
    }
  }
  async function copyVersion(view: ObjectView) {
    await protect(
      (ticket) => createNote(noteFromVersion(view, locale), 'document', ticket),
      'creating',
    );
  }
  async function useProposalDraft(view: ProposalView) {
    await protect(async (ticket) => {
      const content = structuredClone(view.proposedContent);
      const own = installEditor(null, {
        content,
        proposalId: view.proposal.id,
        kind: view.proposal.kind === 'record' ? 'record' : 'document',
        ticket,
      });
      if (!own) return;
      setDestination('library');
      await own.keepDraft();
    });
  }
  async function resumeDraft(draftId: string) {
    await protect(async (ticket) => {
      await readDraftEditor(draftId, ticket);
    });
  }
  async function readDraftEditor(
    draftId: string,
    ticket: TransitionTicket,
    options: EditorReadOptions = {},
  ) {
    const report = (code: ErrorCode) => {
      if (options.sourceEntryId)
        setSourceAction({
          entryId: options.sourceEntryId,
          error: code,
          archived: false,
          returning: options.returning,
        });
      else setError(code);
    };
    const result = await api.readDraft(bound(session, { draftId })).catch(() => null);
    if (!alive.current || !navigation.isCurrent(ticket)) return null;
    if (!result?.ok) {
      report(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      return null;
    }
    const draft = result.value;
    const current =
      draft.target.state === 'existing'
        ? await api
            .readObject(bound(session, { objectId: draft.target.objectId }))
            .catch(() => null)
        : null;
    if (!alive.current || !navigation.isCurrent(ticket)) return null;
    if (draft.target.state === 'existing' && !current?.ok) {
      report(current && !current.ok ? current.error.code : 'OPERATION_UNKNOWN');
      return null;
    }
    const own = installEditor(current?.ok ? current.value : null, {
      draft,
      ticket,
      preserveReaders: options.preserveReaders,
      recordRecent: !options.preserveReaders,
      readingCheckpoint: options.readingCheckpoint,
    });
    if (own && !options.preserveReaders) setDestination('library');
    return own;
  }

  async function loadObjects(next?: string) {
    if (destination !== 'library' && destination !== 'projects') return;
    const key = objectQueryKey;
    if (
      next &&
      (!queryChain.current || queryChain.current.key !== key || queryChain.current.cursor !== next)
    )
      return;
    const ticket = queryGate.current.begin(session);
    const current = () =>
      alive.current && queryGate.current.accepts(ticket, session) && queryScope.current === key;
    setLoading(true);
    setQueryError(null);
    failedQueryCursor.current = undefined;
    if (!next) {
      queryChain.current = null;
      setCursor(null);
    }
    try {
      const result = await api.query(
        bound(session, {
          filter: objectFilter,
          limit: 50,
          maxBytes: 65_536,
          ...(next ? { cursor: next } : {}),
        }),
      );
      if (!current()) return;
      if (result.ok) {
        const page = result.value;
        if (
          page.authoritySequence < knownAuthority.current ||
          (next &&
            (queryChain.current?.authority !== page.authoritySequence ||
              queryChain.current.scope !== page.scope.digest))
        ) {
          invalidateObjectQuery();
          void loadObjects();
          return;
        }
        knownAuthority.current = Math.max(knownAuthority.current, page.authoritySequence);
        setObjects((old) =>
          next
            ? [
                ...old,
                ...result.value.items.filter(
                  (item) => !old.some((entry) => entry.ref.objectId === item.ref.objectId),
                ),
              ]
            : result.value.items,
        );
        setCursor(result.value.nextCursor);
        queryChain.current = {
          key,
          cursor: page.nextCursor,
          authority: page.authoritySequence,
          scope: page.scope.digest,
        };
        setQueryError(null);
      } else {
        failedQueryCursor.current = next;
        setQueryError(result.error.code);
        if (result.error.code === 'CURSOR_STALE') {
          invalidateObjectQuery();
          void loadObjects();
        }
      }
    } catch {
      if (current()) {
        failedQueryCursor.current = next;
        setQueryError('OPERATION_UNKNOWN');
      }
    } finally {
      if (current()) setLoading(false);
    }
  }
  function invalidateObjectQuery() {
    queryGate.current.invalidate();
    queryChain.current = null;
    failedQueryCursor.current = undefined;
    setCursor(null);
    setObjects([]);
    setLoading(destination === 'library' || destination === 'projects');
    setQueryError(null);
  }
  function invalidateKnowledgeReads() {
    invalidateObjectQuery();
    headGate.current.invalidate();
    editorRef.current?.invalidateHeadReview();
    recentWork.invalidate();
    draftEpoch.current++;
    setDraftLoading(false);
  }
  async function refreshKnowledgeDiscovery() {
    invalidateKnowledgeReads();
    await Promise.all([
      loadObjects(),
      pollObject(),
      loadDrafts(),
      destination === 'continue' ? recentWork.refresh() : Promise.resolve(),
    ]);
  }
  async function loadProposals() {
    await proposalLists.refresh();
  }
  async function openActivityProposal(proposalId: string) {
    await protect(async (ticket) => {
      const result = await api.getProposal(bound(session, { proposalId })).catch(() => null);
      if (!alive.current || !navigation.isCurrent(ticket)) return;
      if (!result?.ok) {
        setActivityError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
        return;
      }
      clearReaders();
      void proposalLists.select(collectionFor(result.value.proposal.status));
      setSelectedProposal(proposalId);
      setDestination('review');
      setAux(null);
      setTableOpen(false);
      setListOpen(false);
      setActivityError(null);
      setActivityReturn('proposal');
      setActivityOpen(false);
    });
  }
  function returnActivity() {
    setActivityReturn(null);
    setActivityOpen(true);
  }
  async function loadDrafts(next?: string) {
    const ticket = ++draftEpoch.current;
    const current = () => alive.current && ticket === draftEpoch.current;
    setDraftLoading(true);
    setDraftError(null);
    try {
      const result = await api.listDrafts(
        bound(session, { limit: 20, ...(next ? { beforeId: next } : {}) }),
      );
      if (!current()) return;
      if (!result.ok) {
        setDraftError(result.error.code);
        return;
      }
      setDrafts((old) =>
        next
          ? [...old, ...result.value.items.filter((entry) => entry.retained)]
          : result.value.items.filter((entry) => entry.retained),
      );
      setDraftNext(result.value.nextBeforeId);
    } catch {
      if (current()) setDraftError('OPERATION_UNKNOWN');
    } finally {
      if (current()) setDraftLoading(false);
    }
  }
  async function pollObject() {
    const current = editorRef.current;
    const id = current?.getSnapshot().objectId;
    if (!current || !id) return;
    const ticket = headGate.current.begin(session, id);
    const accepts = () =>
      alive.current &&
      editorRef.current === current &&
      headGate.current.accepts(ticket, session, id);
    current.beginHeadReviewRead();
    try {
      const result = await api.readObject(bound(session, { objectId: id }));
      if (!accepts()) return;
      if (result.ok) current.observe(result.value);
      else current.failHeadReviewRead(result.error.code);
    } catch {
      if (accepts()) current.failHeadReviewRead('OPERATION_UNKNOWN');
    } finally {
      if (accepts()) current.finishHeadReviewRead();
    }
  }
  async function loadGrants() {
    const ticket = ++grantEpoch.current;
    const result = await api.listGrants(bound(session, null)).catch(() => null);
    if (alive.current && ticket === grantEpoch.current && result?.ok) setGrants(result.value);
  }
  currentActions.current = {
    refreshAll: () => {
      void refreshKnowledgeDiscovery();
      void loadProposals();
      void loadGrants();
    },
    pollObject: () => {
      void pollObject();
    },
    invalidateKnowledgeReads,
  };
  useEffect(() => {
    void loadObjects();
  }, [destination, kind, text, projectId, lifecycle, reviewFilter]);
  useEffect(() => {
    recentWork.activate();
    if (destination === 'continue') {
      void recentWork.refresh();
      void loadDrafts();
    } else recentWork.invalidate();
  }, [destination, recentWork]);
  useEffect(() => {
    alive.current = true;
    navigation.activate();
    proposalLists.activate();
    recentWork.activate();
    void loadProposals();
    void loadDrafts();
    void loadGrants();
    const id = remembered(session);
    if (id) void readEditor(id);
    let polling = false,
      authority = session.status.authoritySequence;
    async function poll() {
      if (polling || !alive.current) return;
      polling = true;
      try {
        const now = await api.status(bound(session, null));
        if (!alive.current || !now.ok) return;
        setStatus(now.value);
        knownAuthority.current = Math.max(knownAuthority.current, now.value.authoritySequence);
        if (now.value.authoritySequence !== authority) {
          authority = now.value.authoritySequence;
          currentActions.current.refreshAll();
          setRefresh((value) => value + 1);
        }
        const result = await api.activity(
          bound(session, {
            after: Math.max(0, now.value.activitySequence - 50),
            through: now.value.activitySequence,
            limit: 50,
          }),
        );
        if (alive.current && result.ok)
          setActivity((old) => {
            const map = new Map(old.map((entry) => [entry.id, entry]));
            for (const entry of result.value.items) map.set(entry.id, entry);
            return [...map.values()].sort((a, b) => b.id - a.id).slice(0, 200);
          });
      } catch {
        /* Polling does not replace a writing error or claim a connection. */
      } finally {
        polling = false;
      }
    }
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    const onFocus = () => {
      void poll();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      navigation.dispose();
      proposalLists.dispose();
      recentWork.dispose();
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      queryGate.current.invalidate();
      objectGate.current.invalidate();
      headGate.current.invalidate();
      editorRef.current?.dispose();
    };
  }, [session.bindingId]);
  useEffect(() => {
    navigation.setLock('close', closingLocked);
  }, [closingLocked]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)');
    const listener = () => setNarrow(media.matches);
    media.addEventListener('change', listener);
    listener();
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.isComposing || editorRef.current?.getSnapshot().composing) return;
      if (event.key === 'Escape' && settingsOpen && accessCloseBlocked.current) {
        event.preventDefault();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if ((event.metaKey || event.ctrlKey) && ['s', 'k', 'n'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        command(
          event.key.toLowerCase() === 's'
            ? 'save'
            : event.key.toLowerCase() === 'k'
              ? 'search'
              : 'new-note',
        );
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  function command(value: MenuCommand) {
    if (navigation.pending || navigation.locked) return;
    if (value === 'save') {
      void editorRef.current?.saveNow();
      return;
    }
    if (value === 'settings') {
      const route = contextRouteEpoch.current;
      void (editorRef.current?.afterComposition() ?? Promise.resolve()).then(() => {
        if (!alive.current || route !== contextRouteEpoch.current) return;
        if (contextOpen) {
          setContextOpen(false);
          setContextReturn('settings');
        }
        setSettingsOpen(true);
      });
      return;
    }
    if (value === 'new-note') {
      void protect((ticket) => createNote(undefined, 'document', ticket), 'creating');
      return;
    }
    void protect(async () => {
      invalidateKnowledgeReads();
      setDestination('library');
      setReviewFilter('');
      clearReaders();
      setAux(null);
      setTableOpen(false);
      setListOpen(true);
      if (destination === 'library' && !reviewFilter) void loadObjects();
      requestAnimationFrame(() => searchRef.current?.focus());
    });
  }
  function openImports(fromPreparation = false) {
    const route = contextRouteEpoch.current;
    void (editorRef.current?.afterComposition() ?? Promise.resolve()).then(() => {
      if (
        !alive.current ||
        navigation.pending ||
        navigation.locked ||
        (fromPreparation && (route !== contextRouteEpoch.current || !contextOpen))
      )
        return;
      if (fromPreparation) {
        setContextReturn('imports');
        setContextOpen(false);
      } else setContextReturn(null);
      setImportsOpen(true);
    });
  }
  function prepareContext(object: ObjectSnapshot, trigger: string) {
    if (
      navigation.pending ||
      navigation.locked ||
      object.spaceId !== session.status.spaceId ||
      object.instanceId !== session.status.instanceId
    )
      return;
    contextRouteEpoch.current++;
    contextTrigger.current = trigger;
    setContextSeed((old) =>
      old && preparationKey(session, old) === preparationKey(session, object) ? old : object,
    );
    setContextReturn(null);
    setContextOpen(true);
  }
  function closeContext() {
    contextRouteEpoch.current++;
    setContextOpen(false);
    setContextReturn(null);
    requestAnimationFrame(() =>
      document.getElementById(contextTrigger.current ?? '')?.focus({ preventScroll: true }),
    );
  }
  function prepareAccess(objects: AccessObject[]) {
    setAccessDraft((old) =>
      old && JSON.stringify(old.objects) === JSON.stringify(objects)
        ? old
        : { id: newKey('prepared-access'), objects },
    );
    setContextOpen(false);
    setContextReturn('settings');
    setSettingsOpen(true);
    requestAnimationFrame(() => {
      const heading = document.getElementById('agent-access-heading');
      heading?.focus();
    });
  }
  useImperativeHandle(ref, () => ({
    bindingId: session.bindingId,
    openImports: () => openImports(),
    prepareToLeave,
    discardEdits,
    copyEdits,
    command,
    afterComposition: () => editorRef.current?.afterComposition() ?? Promise.resolve(),
    lockInput: (locked, source = 'close') => navigation.setLock(source, locked),
  }));

  function openReference(reference: ObjectRef, trigger?: string, onOpened?: () => void) {
    if (
      openingReference.current ||
      navigation.pending ||
      navigation.locked ||
      editorRef.current?.getSnapshot().locked
    )
      return;
    openingReference.current = true;
    const activeEditor = editorRef.current;
    const intentRoute = readerRouteEpoch.current;
    void (async () => {
      await activeEditor?.afterComposition();
      if (
        !alive.current ||
        intentRoute !== readerRouteEpoch.current ||
        activeEditor !== editorRef.current ||
        navigation.pending ||
        navigation.locked ||
        activeEditor?.getSnapshot().locked
      )
        return;
      const origin = trigger ? document.getElementById(trigger) : document.activeElement;
      const source = origin instanceof Element ? origin.closest('.source-reader') : null;
      const scroll =
        (origin instanceof Element ? origin.closest('.as-scroll-region') : null) ??
        source?.querySelector('.document-scroll');
      const region: ReaderEntry['region'] = scroll?.classList.contains('context-scroll')
        ? 'context'
        : scroll?.classList.contains('review-scroll') ||
            (origin instanceof Element && !!origin.closest('.review-pane'))
          ? 'review'
          : scroll?.classList.contains('record-table-scroll')
            ? 'table'
            : source || scroll?.closest('.source-reader')
              ? 'source'
              : 'document';
      const scrollTop =
        scroll?.scrollTop ??
        document.querySelector('.review-scroll')?.scrollTop ??
        document.querySelector('.document-scroll')?.scrollTop ??
        0;
      const root = document.scrollingElement;
      const outerDocument =
        region === 'context' && origin instanceof Element && origin.closest('.details-pane') && root
          ? {
              scrollTop: root.scrollTop,
              width: visualViewport?.width ?? innerWidth,
              height: visualViewport?.height ?? innerHeight,
              dpr: devicePixelRatio,
            }
          : undefined;
      if (!readers.length || readerEditing) {
        if (readerEditing) setActivityReturn(null);
        const state = activeEditor?.getSnapshot();
        readerOrigin.current = {
          editorId: state?.editorId ?? null,
          objectId: state?.objectId ?? null,
          draftId: null,
          destination,
          selectedProposal,
          reviewCollection: proposalState.collection,
          aux,
          tableOpen,
          edited: false,
          projectWriting:
            document.querySelector('.document-pane')?.getAttribute('data-project-view') === 'write',
          materialCount: document.querySelectorAll(
            '[data-testid="project-material"] .linked-material-row',
          ).length,
          referenceCounts: {
            continuation: document.querySelectorAll(
              '[data-testid="project-continuation"] .project-reference-row',
            ).length,
            assets: document.querySelectorAll(
              '[data-testid="project-assets"] .project-reference-row',
            ).length,
          },
        };
      }
      const fallback =
        origin instanceof Element
          ? (origin.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby') ??
            (origin.closest('[data-testid="project-material"]')
              ? 'project-material-heading'
              : undefined))
          : undefined;
      setReaders((old) => [
        ...(readerEditing ? [] : old),
        {
          entryId: crypto.randomUUID(),
          reference,
          trigger,
          scrollTop,
          region,
          fallback,
          outerDocument,
        },
      ]);
      readerRouteEpoch.current++;
      setReaderEditing(false);
      setSourceAction(null);
      setListOpen(false);
      onOpened?.();
    })().finally(() => {
      openingReference.current = false;
    });
  }
  function restoreReaderLocation(
    current: ReaderEntry | undefined,
    expectedEditor?: EditorSession | null,
  ) {
    const route = readerRouteEpoch.current,
      capturedEditor = expectedEditor ?? editorRef.current,
      generation = capturedEditor?.getSnapshot().generation,
      focusOwner = document.activeElement,
      historyReturn = current?.region === 'context' && current.trigger?.startsWith('history-r'),
      detailsReturn = current?.region === 'context' && !!current.outerDocument;
    let attempts = 0;
    let projectView: string | null | undefined;
    let viewCaptured = false;
    const restore = () => {
      if (
        !alive.current ||
        readerRouteEpoch.current !== route ||
        capturedEditor !== editorRef.current ||
        capturedEditor?.getSnapshot().generation !== generation ||
        navigation.pending
      )
        return;
      const pane = document.querySelector('.document-pane');
      if (
        capturedEditor &&
        (current?.region === 'document' || current?.region === 'context') &&
        pane?.getAttribute('data-editor-id') !== capturedEditor.getSnapshot().editorId
      ) {
        if (++attempts < 90) requestAnimationFrame(restore);
        return;
      }
      const view = pane?.getAttribute('data-project-view');
      if (!viewCaptured) {
        projectView = view;
        viewCaptured = true;
      } else if (projectView !== view) return;
      const selector =
        current?.region === 'context'
          ? '.context-scroll'
          : current?.region === 'review'
            ? '.review-scroll'
            : current?.region === 'table'
              ? '.record-table-scroll'
              : current?.region === 'source'
                ? '.source-reader:not([hidden]) .document-scroll'
                : '.document-pane .document-scroll';
      const trigger = current?.trigger
        ? (document.getElementById(current.trigger) ??
          (current.trigger.startsWith('relation-')
            ? document.querySelector<HTMLElement>(
                `${selector} [id$="-${current.trigger.slice(-36)}"]`,
              )
            : null))
        : document.getElementById('proposal-heading');
      if (
        (!trigger || ((historyReturn || detailsReturn) && !trigger.getClientRects().length)) &&
        ++attempts < 90
      ) {
        requestAnimationFrame(restore);
        return;
      }
      const scroll = historyReturn
        ? trigger?.closest<HTMLElement>('[data-testid="history-pane"] .context-scroll')
        : detailsReturn
          ? trigger?.closest<HTMLElement>('.details-pane > .context-scroll')
          : document.querySelector(selector);
      if (historyReturn || detailsReturn) {
        const active = document.activeElement;
        if (
          document.querySelector('dialog[open]') ||
          (active instanceof HTMLElement &&
            active !== focusOwner &&
            active !== document.body &&
            active !== trigger &&
            active.getClientRects().length)
        )
          return;
      }
      if (detailsReturn && scroll && current?.outerDocument) {
        const checkpoint = current.outerDocument,
          root = document.scrollingElement;
        if (
          root &&
          checkpoint.width === (visualViewport?.width ?? innerWidth) &&
          checkpoint.height === (visualViewport?.height ?? innerHeight) &&
          checkpoint.dpr === devicePixelRatio &&
          checkpoint.scrollTop >= 0 &&
          checkpoint.scrollTop <= root.scrollHeight - root.clientHeight
        ) {
          const previous = root.scrollTop;
          root.scrollTop = checkpoint.scrollTop;
          // A fractional endpoint can still clamp despite the integer range above.
          if (root.scrollTop !== checkpoint.scrollTop) root.scrollTop = previous;
        }
      }
      if (scroll && current) scroll.scrollTop = current.scrollTop;
      const focus =
        trigger ??
        (current?.fallback ? document.getElementById(current.fallback) : null) ??
        document.querySelector<HTMLElement>('.document-pane .document-title, .document-pane h1');
      focus?.focus({ preventScroll: true });
      if (historyReturn && scroll && trigger && document.activeElement === trigger) {
        // Preserve the exact checkpoint when it fits; changed history can move its trigger.
        const viewport = document.querySelector('.desktop-app')?.getBoundingClientRect();
        let top = viewport?.top ?? 0,
          bottom = viewport?.bottom ?? innerHeight;
        for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!/auto|scroll|hidden|clip/.test(style.overflowY)) continue;
          const box = parent.getBoundingClientRect(),
            borderTop = parseFloat(style.borderTopWidth) || 0,
            borderBottom = parseFloat(style.borderBottomWidth) || 0,
            scrollbar =
              parent.scrollWidth > parent.clientWidth
                ? Math.max(0, parent.offsetHeight - parent.clientHeight - borderTop - borderBottom)
                : 0;
          top = Math.max(top, box.top + borderTop);
          bottom = Math.min(bottom, box.bottom - borderBottom - scrollbar);
        }
        const rect = trigger.getBoundingClientRect(),
          style = getComputedStyle(trigger),
          outset = Math.max(
            0,
            (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
          );
        if (rect.top - outset < top) scroll.scrollTop += Math.floor(rect.top - outset - top);
        else if (rect.bottom + outset > bottom)
          scroll.scrollTop += Math.ceil(rect.bottom + outset - bottom);
      }
    };
    requestAnimationFrame(restore);
  }
  function restoreReaderEditFocus(trigger: string | null, requestControl?: HTMLElement) {
    if (!trigger || navigation.pending || navigation.locked) return;
    const target = document.getElementById(trigger),
      focused = document.activeElement,
      route = readerRouteEpoch.current;
    if (!target || (focused !== document.body && focused !== (requestControl ?? target))) return;
    requestAnimationFrame(() => {
      const active = document.activeElement,
        requestToBody =
          focused === requestControl && !focused?.isConnected && active === document.body;
      if (
        !alive.current ||
        navigation.pending ||
        navigation.locked ||
        route !== readerRouteEpoch.current ||
        (active !== focused && !requestToBody) ||
        document.querySelector('dialog[open]') ||
        !target.getClientRects().length ||
        target.matches(':disabled')
      )
        return;
      target.focus({ preventScroll: true });
    });
  }
  function editCurrentFromReader(entry: ReaderEntry, trigger: string) {
    if (
      navigation.pending ||
      navigation.locked ||
      readerEditing ||
      readers.at(-1)?.entryId !== entry.entryId
    )
      return;
    const route = readerRouteEpoch.current;
    readerEditTrigger.current = trigger;
    void protect(async (ticket) => {
      const original = editorRef.current;
      const origin = readerOrigin.current;
      if (original && origin?.editorId === original.getSnapshot().editorId) {
        const state = original.getSnapshot();
        origin.objectId = state.objectId;
        origin.draftId = original.dirty && state.draft?.retained ? state.draft.draftId : null;
      }
      const own = await readEditor(entry.reference.objectId, ticket, {
        preserveReaders: true,
        reuseExisting: true,
        sourceEntryId: entry.entryId,
        requireWritable: true,
      });
      if (!own) return;
      if (origin) origin.edited = true;
      readerRouteEpoch.current++;
      setReaderEditing(true);
      setExistingReaderDraft(own.dirty);
      setWritingRequest((value) => value + 1);
    }).then(() => {
      if (route === readerRouteEpoch.current) restoreReaderEditFocus(trigger);
    });
  }
  function returnToReading() {
    if (navigation.pending || navigation.locked) return;
    const current = editorRef.current;
    const route = readerRouteEpoch.current;
    const requestControl =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    void (current?.afterComposition() ?? Promise.resolve()).then(() => {
      if (
        !alive.current ||
        route !== readerRouteEpoch.current ||
        current !== editorRef.current ||
        navigation.pending ||
        navigation.locked
      )
        return;
      setReaderEditing(false);
      readerRouteEpoch.current++;
      restoreReaderEditFocus(readerEditTrigger.current, requestControl);
    });
  }
  function backFromReference() {
    if (navigation.pending || navigation.locked) return;
    const current = readers.at(-1);
    const origin = readerOrigin.current;
    const activityOrigin = activityReturn;
    if (readers.length === 1 && origin?.edited) {
      void protect(async (ticket) => {
        let own = editorRef.current;
        if (
          !(origin.destination === 'review' && origin.selectedProposal) &&
          !origin.tableOpen &&
          own?.getSnapshot().editorId !== origin.editorId
        ) {
          if (origin.draftId)
            own = await readDraftEditor(origin.draftId, ticket, {
              preserveReaders: true,
              sourceEntryId: current?.entryId,
              returning: true,
              readingCheckpoint: origin,
            });
          else if (origin.objectId && own?.getSnapshot().objectId !== origin.objectId)
            own = await readEditor(origin.objectId, ticket, {
              preserveReaders: true,
              sourceEntryId: current?.entryId,
              returning: true,
              readingCheckpoint: origin,
            });
          if (!own) return;
        }
        if (!alive.current || !navigation.isCurrent(ticket)) return;
        setDestination(origin.destination);
        setSelectedProposal(origin.selectedProposal);
        if (proposalState.collection !== origin.reviewCollection)
          void proposalLists.select(origin.reviewCollection);
        setAux(origin.aux);
        setTableOpen(origin.tableOpen);
        setListOpen(false);
        if (origin.projectWriting) setWritingRequest((value) => value + 1);
        setRestoreMaterialCount(origin.materialCount);
        setRestoreReferenceCounts(origin.referenceCounts);
        clearReaders();
        if (activityOrigin === 'reader') returnActivity();
        else {
          setActivityReturn(activityOrigin);
          restoreReaderLocation(current, own);
        }
      });
      return;
    }
    setReaders((old) => old.slice(0, -1));
    readerRouteEpoch.current++;
    if (readers.length === 1) {
      readerOrigin.current = null;
      if (origin?.destination === 'review' && origin.selectedProposal) {
        setDestination('review');
        setSelectedProposal(origin.selectedProposal);
        if (proposalState.collection !== origin.reviewCollection)
          void proposalLists.select(origin.reviewCollection);
      }
      if (activityOrigin === 'reader') {
        returnActivity();
        return;
      }
    }
    restoreReaderLocation(current);
  }
  function chooseDestination(value: Destination) {
    void protect(async () => {
      invalidateKnowledgeReads();
      setDestination(value);
      setText('');
      setKind(undefined);
      setProjectId(null);
      setReviewFilter('');
      clearReaders();
      setAux(null);
      setTableOpen(false);
      setListOpen(true);
      if (value !== 'review') setSelectedProposal(null);
      if (value === destination) {
        if (value === 'continue') {
          void recentWork.refresh();
          void loadDrafts();
        } else if (!kind && !text && !projectId && !reviewFilter) void loadObjects();
      }
    });
  }
  function openMetadata(mode: 'fields' | 'relations' | 'lifecycle' | 'relink') {
    const active = editorRef.current;
    if (!active) return;
    void active.afterComposition().then(() => {
      if (
        alive.current &&
        active === editorRef.current &&
        !active.getSnapshot().locked &&
        (mode === 'lifecycle' || active.getSnapshot().object?.lifecycle !== 'archived')
      )
        setMetadataDialog(mode);
    });
  }
  function reuseFields(properties: ObjectContent['properties']) {
    void protect(
      (ticket) => createNote(recordFromFields(properties), 'record', ticket),
      'creating',
    );
  }
  async function executeObjectAction(
    perform: (state: EditorSnapshot) => Promise<Result<WriteResult>>,
  ) {
    let result: Result<WriteResult> | null = null;
    await protect(async (ticket) => {
      const current = editorRef.current;
      if (!current) return;
      invalidateKnowledgeReads();
      result = await perform(current.getSnapshot());
      if (!result.ok) {
        currentActions.current.refreshAll();
        return;
      }
      const object = result.value.object;
      const view = await api.readObject(bound(session, { objectId: object.id })).catch(() => null);
      if (!navigation.isCurrent(ticket)) return;
      installEditor(
        view?.ok ? view.value : { object, currentRevision: object.revision, relationTargets: [] },
        { ticket, headVerified: !!view?.ok },
      );
      setMetadataDialog(null);
      currentActions.current.refreshAll();
      setRefresh((value) => value + 1);
    });
    return result;
  }
  async function chooseRelink() {
    let result: Result<RelinkSession | null> | null = null;
    await protect(async () => {
      const current = editorRef.current?.getSnapshot();
      if (current?.objectId && current.revision)
        result = await api.chooseRelink(
          bound(session, { objectId: current.objectId, expectedRevision: current.revision }),
        );
    });
    return result;
  }
  const nav = [
    { id: 'continue', key: 'nav.continue', icon: BookOpen },
    { id: 'projects', key: 'nav.projects', icon: Folder },
    { id: 'library', key: 'nav.library', icon: FileText },
    { id: 'review', key: 'nav.review', icon: ListChecks },
  ] as const;
  const moreProposals =
    !!proposalState.groups.pending.nextAfterId || !!proposalState.groups.conflicted.nextAfterId;
  const countLabel = t(locale, 'review.loadedPending', { count: proposals.length });
  const activeObject = editor?.getSnapshot().objectId;
  const recordItems = useMemo(() => objects.filter((item) => item.kind === 'record'), [objects]);
  const lastPrepared = activity.find((entry) => entry.stage === 'prepared');
  const reader = readerEditing ? undefined : readers.at(-1);
  return (
    <TaskContext.Provider value={operations.current}>
      <ReferenceRefreshContext.Provider value={refresh}>
        <div
          className="workbench"
          data-compact={compact}
          data-list-open={listOpen}
          data-transitioning={!!transitionStage}
          data-aux={reader || tableOpen ? '' : (aux ?? '')}
          data-testid="workbench"
          onBeforeInputCapture={(event) => {
            if (navigation.locked) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onKeyDownCapture={(event) => {
            if (
              !navigation.locked ||
              !(event.target instanceof Element) ||
              !event.target.closest('.document-pane')
            )
              return;
            const key = event.key.toLowerCase();
            if (
              key === 'tab' ||
              key === 'escape' ||
              key.startsWith('arrow') ||
              ((event.metaKey || event.ctrlKey) && (key === 'c' || key === 'a'))
            )
              return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <nav
            className="workspace-nav"
            aria-label={t(locale, 'app.name')}
            inert={!!transitionStage}
          >
            {nav.map(({ id, key, icon: Icon }) => (
              <button
                key={id}
                data-testid={`nav-${id}`}
                aria-current={destination === id ? 'page' : undefined}
                onClick={() => chooseDestination(id)}
              >
                <Icon size={18} />
                <span>{t(locale, key)}</span>
                {id === 'review' && proposals.length > 0 && (
                  <span className="nav-count" aria-label={countLabel}>
                    {formatNumber(locale, proposals.length)}
                    {moreProposals ? '+' : ''}
                  </span>
                )}
              </button>
            ))}
            <div className="nav-bottom">
              <button
                onClick={() => {
                  setActivityError(null);
                  setActivityOpen(true);
                }}
                data-testid="open-activity"
              >
                <Activity size={18} />
                {t(locale, 'ui.activity')}
              </button>
              {lastPrepared && (
                <small>
                  {t(locale, 'agent.lastCall', {
                    time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
                      new Date(lastPrepared.recordedAt),
                    ),
                  })}
                </small>
              )}
              <small>{t(locale, 'space.local')}</small>
            </div>
          </nav>
          <aside
            className="material-list"
            inert={!!transitionStage}
            aria-label={t(locale, nav.find((item) => item.id === destination)!.key)}
          >
            <header>
              <h2>{t(locale, nav.find((item) => item.id === destination)!.key)}</h2>
              {compact && (editor || selectedProposal || reader) && (
                <button
                  className="icon-button"
                  aria-label={t(locale, 'ui.sourceReturn')}
                  onClick={() => setListOpen(false)}
                >
                  <ChevronLeft size={18} />
                </button>
              )}
            </header>
            <div className="list-scroll as-scroll-region">
              {destination !== 'review' && (
                <details className="material-create">
                  <summary aria-label={t(locale, 'org.newMaterial')} data-testid="new-material">
                    <Plus size={16} />
                    {t(locale, 'org.newMaterial')}
                  </summary>
                  <div>
                    {(['document', 'project', 'record', 'asset'] as const).map((kind) => (
                      <button
                        key={kind}
                        data-testid={`new-${kind}`}
                        onClick={(event) => {
                          const menu = event.currentTarget.closest('details');
                          if (menu) menu.open = false;
                          void protect((ticket) => createNote(undefined, kind, ticket), 'creating');
                        }}
                      >
                        {t(
                          locale,
                          kind === 'document'
                            ? 'object.newNote'
                            : kind === 'project'
                              ? 'org.newProject'
                              : kind === 'record'
                                ? 'org.newRecord'
                                : 'org.newAsset',
                        )}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {(destination === 'library' || destination === 'projects') && (
                <div className="list-filters">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      ref={searchRef}
                      value={text}
                      maxLength={200}
                      placeholder={t(locale, 'ui.search')}
                      aria-label={t(locale, 'ui.search')}
                      data-testid="space-search"
                      onChange={(event) => {
                        if (event.target.value === text) return;
                        invalidateObjectQuery();
                        setText(event.target.value);
                      }}
                    />
                  </label>
                  {destination !== 'projects' && (
                    <select
                      aria-label={t(locale, 'ui.type')}
                      value={kind ?? ''}
                      onChange={(event) => {
                        if (event.target.value === (kind ?? '')) return;
                        invalidateObjectQuery();
                        setKind((event.target.value || undefined) as QueryInput['filter']['kind']);
                        setTableOpen(false);
                      }}
                    >
                      <option value="">{t(locale, 'ui.allMaterial')}</option>
                      <option value="document">{t(locale, 'ui.notes')}</option>
                      <option value="record">{t(locale, 'object.record')}</option>
                      <option value="asset">{t(locale, 'object.asset')}</option>
                      <option value="project">{t(locale, 'org.project')}</option>
                    </select>
                  )}
                  <select
                    aria-label={t(locale, 'lifecycle.filter')}
                    data-testid="lifecycle-filter"
                    value={lifecycle}
                    onChange={(event) => {
                      if (event.target.value === lifecycle) return;
                      invalidateObjectQuery();
                      setLifecycle(event.target.value as typeof lifecycle);
                      setTableOpen(false);
                    }}
                  >
                    <option value="active">{t(locale, 'lifecycle.active')}</option>
                    <option value="archived">{t(locale, 'ui.archived')}</option>
                    <option value="all">{t(locale, 'lifecycle.all')}</option>
                  </select>
                  {text && <small>{t(locale, 'ui.searchLiteral')}</small>}
                  {kind === 'record' && destination === 'library' && (
                    <button
                      data-testid="show-record-table"
                      onClick={() => {
                        void protect(async () => {
                          setTableOpen(true);
                          clearReaders();
                          setAux(null);
                          setSelectedProposal(null);
                          setListOpen(false);
                        });
                      }}
                    >
                      {t(locale, 'records.table')}
                    </button>
                  )}
                  {projectId && (
                    <button
                      onClick={() => {
                        invalidateObjectQuery();
                        setProjectId(null);
                      }}
                    >
                      {t(locale, 'common.remove')} · {t(locale, 'relation.inProject')}
                    </button>
                  )}
                </div>
              )}
              {destination === 'library' && (
                <div className="review-list-filter">
                  <label htmlFor="knowledge-review-filter">{t(locale, 'knowledge.filter')}</label>
                  <select
                    id="knowledge-review-filter"
                    data-testid="knowledge-review-filter"
                    value={reviewFilter}
                    onChange={(event) => {
                      if (event.target.value === reviewFilter) return;
                      invalidateObjectQuery();
                      setReviewFilter(event.target.value as typeof reviewFilter);
                      setTableOpen(false);
                    }}
                  >
                    <option value="">{t(locale, 'knowledge.all')}</option>
                    <option value="never-reviewed">{t(locale, 'knowledge.notReviewed')}</option>
                    <option value="current-reviewed">{t(locale, 'knowledge.reviewed')}</option>
                    <option value="changed-since-review">
                      {t(locale, 'knowledge.needsReview')}
                    </option>
                  </select>
                </div>
              )}
              {destination === 'continue' && (
                <section className="continue-status">
                  {draftLoading && <p role="status">{t(locale, 'ui.loading')}</p>}
                  <ErrorNotice
                    code={draftError}
                    onRetry={() => {
                      void loadDrafts();
                    }}
                  />
                  {!draftLoading && !draftError && drafts.length === 0 && (
                    <p className="secondary">{t(locale, 'continue.emptyDrafts')}</p>
                  )}
                </section>
              )}
              {destination === 'continue' && drafts.length > 0 && (
                <section className="draft-list">
                  <h3>{t(locale, 'ui.drafts')}</h3>
                  {drafts.map((draft) => (
                    <button
                      key={draft.draftId}
                      onClick={() => {
                        void resumeDraft(draft.draftId);
                      }}
                    >
                      <span>
                        {t(
                          locale,
                          draft.target.state === 'new' ? 'ui.newDraft' : 'editor.resumeDraft',
                        )}
                      </span>
                      <small>
                        <Time value={draft.updatedAt} />
                      </small>
                    </button>
                  ))}
                  {draftNext && (
                    <button
                      onClick={() => {
                        void loadDrafts(draftNext);
                      }}
                    >
                      {t(locale, 'ui.moreResults')}
                    </button>
                  )}
                </section>
              )}
              {destination === 'continue' && (
                <>
                  <button
                    data-testid="open-recoverable-drafts"
                    onClick={() => setRecoveryOpen(true)}
                  >
                    {t(locale, 'recovery.title')}
                  </button>
                  <section className="recent-work" data-testid="recent-work">
                    <h3>{t(locale, 'continue.recent')}</h3>
                    <button
                      onClick={() => {
                        void recentWork.refresh();
                      }}
                      disabled={recent.loading}
                    >
                      {t(locale, 'continue.refresh')}
                    </button>
                    {recent.loading && <p role="status">{t(locale, 'continue.checking')}</p>}
                    {recent.storageUnavailable && (
                      <p className="attention">{t(locale, 'continue.storageUnavailable')}</p>
                    )}
                    {!recent.loading && !recent.storageUnavailable && recent.items.length === 0 && (
                      <p className="secondary">{t(locale, 'continue.noRecent')}</p>
                    )}
                    {recent.items.map((item) => (
                      <div key={item.objectId}>
                        {item.summary ? (
                          <button
                            className="material-row"
                            data-testid={`recent-row-${item.objectId}`}
                            disabled={!item.fresh}
                            onClick={() => openEditor(item.objectId)}
                          >
                            <span className="row-title">
                              {titleText(locale, item.summary.title, item.summary.kind)}
                            </span>
                            <small>
                              {item.summary.lifecycle === 'archived'
                                ? t(locale, 'ui.archived')
                                : t(locale, 'source.version', {
                                    version: item.summary.ref.revision,
                                  })}
                            </small>
                            {item.lastOpenedAt > 0 && (
                              <small>
                                <Time value={new Date(item.lastOpenedAt).toISOString()} />
                              </small>
                            )}
                          </button>
                        ) : item.missing ? (
                          <p>{t(locale, 'continue.unavailable')}</p>
                        ) : (
                          <ErrorNotice
                            code={item.error}
                            onRetry={() => {
                              void recentWork.refresh();
                            }}
                          />
                        )}
                        {(item.error || item.missing) && (
                          <button onClick={() => recentWork.remove(item.objectId)}>
                            {t(locale, 'continue.removeRecent')}
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                  <div className="continue-links">
                    <button
                      data-testid="continue-changes"
                      onClick={() => {
                        setActivityError(null);
                        setActivityChangesRequest((value) => value + 1);
                        setActivityOpen(true);
                      }}
                    >
                      {t(locale, 'continue.changes')}
                    </button>
                    <button
                      data-testid="continue-library"
                      onClick={() => chooseDestination('library')}
                    >
                      {t(locale, 'continue.openLibrary')}
                    </button>
                    <button onClick={() => chooseDestination('projects')}>
                      {t(locale, 'continue.openProjects')}
                    </button>
                    <button data-testid="continue-import" onClick={() => openImports()}>
                      {t(locale, 'contextPrep.import')}
                    </button>
                  </div>
                </>
              )}
              {destination === 'review' ? (
                <>
                  <div
                    className="as-actions discovery-controls"
                    role="group"
                    aria-label={t(locale, 'nav.review')}
                  >
                    {(['unresolved', 'processed'] as const).map((collection) => (
                      <button
                        key={collection}
                        aria-pressed={proposalState.collection === collection}
                        data-testid={`review-${collection}`}
                        onClick={() => {
                          void protect(async () => {
                            invalidateKnowledgeReads();
                            clearReaders();
                            setSelectedProposal(null);
                            setListOpen(true);
                            await proposalLists.select(collection);
                            void refreshKnowledgeDiscovery();
                          });
                        }}
                      >
                        {t(
                          locale,
                          collection === 'unresolved' ? 'review.unresolved' : 'review.processed',
                        )}
                      </button>
                    ))}
                    <button
                      data-testid="review-refresh"
                      onClick={() => {
                        void loadProposals();
                      }}
                    >
                      {t(locale, 'activity.refresh')}
                    </button>
                  </div>
                  {collectionStatuses[proposalState.collection].map((status) => {
                    const group = proposalState.groups[status];
                    return (
                      <section
                        className="proposal-group"
                        key={status}
                        data-testid={`proposal-group-${status}`}
                      >
                        <h3>{t(locale, proposalStatusKey[status])}</h3>
                        <small>{t(locale, 'activity.loaded', { count: group.items.length })}</small>
                        {group.error && group.loaded && (
                          <p className="attention">{t(locale, 'activity.retained')}</p>
                        )}
                        <ErrorNotice
                          code={group.error}
                          onRetry={() => {
                            void proposalLists.load(status, group.retryMore);
                          }}
                        />
                        {group.loading && <p role="status">{t(locale, 'ui.loading')}</p>}
                        {group.items.map((proposal) => (
                          <button
                            className={`material-row ${selectedProposal === proposal.id ? 'selected' : ''}`}
                            key={proposal.id}
                            onClick={() => {
                              void protect(async () => {
                                clearReaders();
                                setSelectedProposal(proposal.id);
                                setAux(null);
                                setListOpen(false);
                              });
                            }}
                            data-testid={`proposal-row-${proposal.id}`}
                          >
                            <span className="row-title">
                              {!proposal.seen && (
                                <span
                                  className="unread-dot"
                                  aria-label={t(locale, 'proposal.unread')}
                                />
                              )}{' '}
                              {proposal.purpose}
                            </span>
                            <small>{t(locale, proposalStatusKey[proposal.status])}</small>
                            <small>
                              {t(
                                locale,
                                proposal.resolvedAt ? 'review.resolvedAt' : 'review.createdAt',
                              )}
                              : <Time value={proposal.resolvedAt ?? proposal.createdAt} />
                            </small>
                          </button>
                        ))}
                        {group.loaded &&
                          !group.loading &&
                          !group.error &&
                          group.items.length === 0 && (
                            <p className="list-empty">{t(locale, 'review.emptyGroup')}</p>
                          )}
                        {group.nextAfterId && (
                          <button
                            disabled={group.loading}
                            onClick={() => {
                              void proposalLists.load(status, true);
                            }}
                            data-testid={`proposal-more-${status}`}
                          >
                            {t(locale, 'ui.moreResults')}
                          </button>
                        )}
                      </section>
                    );
                  })}
                </>
              ) : destination !== 'continue' ? (
                <>
                  <ErrorNotice
                    code={queryError}
                    onRetry={() => {
                      void loadObjects(failedQueryCursor.current);
                    }}
                  />
                  {objects.map((object) => (
                    <button
                      className={`material-row ${activeObject === object.ref.objectId ? 'selected' : ''}`}
                      key={object.ref.objectId}
                      onClick={() => openEditor(object.ref.objectId)}
                      data-testid={`object-row-${object.ref.objectId}`}
                    >
                      <span className="row-title">
                        {titleText(locale, object.title, object.kind)}
                      </span>
                      <small>
                        {t(
                          locale,
                          object.kind === 'document'
                            ? 'object.note'
                            : object.kind === 'project'
                              ? 'nav.projects'
                              : object.kind === 'record'
                                ? 'object.record'
                                : 'object.asset',
                        )}{' '}
                        · {t(locale, 'source.version', { version: object.ref.revision })}
                      </small>
                      <small>
                        {destination === 'library' ? (
                          <span data-testid={`object-review-state-${object.ref.objectId}`}>
                            {t(
                              locale,
                              object.knowledgeReviewState === 'current-reviewed'
                                ? 'knowledge.reviewed'
                                : object.knowledgeReviewState === 'changed-since-review'
                                  ? 'knowledge.needsReview'
                                  : 'knowledge.notReviewed',
                            )}
                          </span>
                        ) : (
                          <Time value={object.updatedAt} />
                        )}
                      </small>
                    </button>
                  ))}
                  {!objects.length && !loading && !queryError && (
                    <div className="list-empty">
                      <p>
                        {t(locale, text || reviewFilter ? 'context.noMatches' : 'ui.emptyMaterial')}
                      </p>
                      {destination === 'library' &&
                        !text &&
                        !kind &&
                        !projectId &&
                        !reviewFilter &&
                        queryChain.current?.key === objectQueryKey &&
                        queryChain.current.cursor === cursor && (
                          <button data-testid="library-empty-import" onClick={() => openImports()}>
                            {t(locale, 'contextPrep.import')}
                          </button>
                        )}
                    </div>
                  )}
                  {cursor && (
                    <button
                      data-testid="library-more"
                      disabled={loading}
                      onClick={() => {
                        void loadObjects(cursor);
                      }}
                    >
                      {t(locale, 'ui.moreResults')}
                    </button>
                  )}
                  {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
                </>
              ) : null}
            </div>
          </aside>
          <main className="working-surface" id="working-surface">
            {transitionStage && (
              <div className="transition-notice" role="status" data-testid="editor-transition">
                <span>
                  {t(
                    locale,
                    transitionStage === 'preparing'
                      ? 'ui.preparingNavigation'
                      : transitionStage === 'creating'
                        ? 'ui.creatingMaterial'
                        : 'ui.openingMaterial',
                  )}
                </span>
                {navigation.cancellable && (
                  <button
                    onClick={(event) => {
                      navigation.cancelOpening();
                      restoreReaderEditFocus(readerEditTrigger.current, event.currentTarget);
                    }}
                  >
                    {t(locale, 'common.cancel')}
                  </button>
                )}
              </div>
            )}
            {(error || feedback) && (
              <div className="surface-notices">
                <ErrorNotice
                  code={error}
                  onRetry={() => {
                    if (commandTask.current && !commandTask.current.installed)
                      void protect(
                        (ticket) => createNote(undefined, 'document', ticket, true),
                        'creating',
                      );
                    else currentActions.current.refreshAll();
                  }}
                />
                {feedback && <p role="status">{t(locale, 'common.copied')}</p>}
              </div>
            )}
            <div hidden={!!reader} className="primary-surface" aria-busy={!!transitionStage}>
              {tableOpen && destination === 'library' && kind === 'record' ? (
                <RecordsTable
                  api={api}
                  session={session}
                  items={recordItems}
                  more={!!cursor}
                  onMore={() => {
                    void loadObjects(cursor ?? undefined);
                  }}
                  onOpen={openEditor}
                  onReuse={reuseFields}
                  onBack={() => {
                    setTableOpen(false);
                    setListOpen(true);
                  }}
                />
              ) : destination === 'review' && selectedProposal ? (
                <ReviewPane
                  key={selectedProposal}
                  api={api}
                  session={session}
                  proposalId={selectedProposal}
                  refresh={refresh}
                  grants={grants}
                  onObserved={(view) => {
                    const { payload, ...receipt } = view.proposal;
                    proposalLists.observe({
                      ...receipt,
                      purpose: payload.purpose,
                      seen: view.seen,
                    });
                  }}
                  onReturnActivity={activityReturn === 'proposal' ? returnActivity : undefined}
                  onOpen={openReference}
                  onEdit={openEditor}
                  onDraft={(view) => {
                    void useProposalDraft(view);
                  }}
                  onChanged={() => {
                    void loadProposals();
                  }}
                  onDecisionStarting={invalidateKnowledgeReads}
                  onDecisionFinished={() => {
                    void refreshKnowledgeDiscovery();
                  }}
                />
              ) : editor ? (
                <DocumentPane
                  key={editor.getSnapshot().editorId}
                  editor={editor}
                  api={api}
                  session={session}
                  refresh={refresh}
                  writingRequest={writingRequest}
                  existingDraft={existingReaderDraft}
                  restoreMaterialCount={restoreMaterialCount}
                  restoreReferenceCounts={restoreReferenceCounts}
                  onReturnReading={readerEditing && readers.length ? returnToReading : undefined}
                  onOpen={openReference}
                  onPrepare={prepareContext}
                  onHistory={() => setAux((old) => (old === 'history' ? null : 'history'))}
                  onDetails={() => {
                    setAux('details');
                    void pollObject();
                  }}
                  onBrowse={() => {
                    void protect(async () => {
                      setAux(null);
                      setTableOpen(false);
                      setListOpen(true);
                    });
                  }}
                  compact={compact}
                  onFields={() => openMetadata('fields')}
                  onReuseFields={reuseFields}
                  onProjectMaterial={(id) => {
                    void protect(async () => {
                      clearReaders();
                      invalidateObjectQuery();
                      setDestination('library');
                      setProjectId(id);
                      setAux(null);
                      setTableOpen(false);
                      setListOpen(true);
                    });
                  }}
                />
              ) : (
                <div className="empty-pane">
                  <FileText size={32} aria-hidden="true" />
                  <h1>{t(locale, 'ui.noSelection')}</h1>
                  <p>{t(locale, 'ui.emptyMaterial')}</p>
                  <button
                    className="primary"
                    onClick={() => {
                      void protect(
                        (ticket) => createNote(undefined, 'document', ticket),
                        'creating',
                      );
                    }}
                  >
                    {t(locale, 'object.newNote')}
                  </button>
                </div>
              )}
            </div>
            {readers.map((entry, index) => (
              <SourceReader
                key={entry.entryId}
                api={api}
                session={session}
                reference={entry.reference}
                hidden={readerEditing || index !== readers.length - 1}
                editingBusy={!!transitionStage || navigation.locked}
                editError={
                  sourceAction?.entryId === entry.entryId && !sourceAction.returning
                    ? sourceAction.error
                    : null
                }
                returnError={
                  sourceAction?.entryId === entry.entryId && sourceAction.returning
                    ? sourceAction.error
                    : null
                }
                currentArchived={sourceAction?.entryId === entry.entryId && sourceAction.archived}
                onEditCurrent={(trigger) => editCurrentFromReader(entry, trigger)}
                onBack={backFromReference}
                onOpen={openReference}
                onPrepare={(object, trigger) => {
                  if (!readerEditing && readers.at(-1)?.entryId === entry.entryId)
                    prepareContext(object, trigger);
                }}
                onCopyVersion={(view) => {
                  void copyVersion(view);
                }}
              />
            ))}
          </main>
          {editor &&
            aux &&
            !tableOpen &&
            destination !== 'review' &&
            (aux === 'details' ? (
              <DetailsPane
                key={`details-${editor.getSnapshot().editorId}`}
                api={api}
                session={session}
                editor={editor}
                hidden={!!reader}
                refresh={refresh}
                onLifecycle={() => openMetadata('lifecycle')}
                onRelink={() => openMetadata('relink')}
                onFields={() => openMetadata('fields')}
                onRelations={() => openMetadata('relations')}
                onClose={() => {
                  setAux(null);
                  document.getElementById('details-button')?.focus();
                }}
                onOpen={openReference}
                onMutationStarting={invalidateKnowledgeReads}
                onRefresh={refreshKnowledgeDiscovery}
              />
            ) : (
              editor.getSnapshot().objectId && (
                <HistoryPane
                  key={`history-${editor.getSnapshot().objectId}`}
                  api={api}
                  session={session}
                  objectId={editor.getSnapshot().objectId!}
                  hidden={!!reader}
                  refresh={refresh}
                  onClose={() => {
                    setAux(null);
                    document.getElementById('history-button')?.focus();
                  }}
                  onOpen={openReference}
                  onCopied={(view) => {
                    void copyVersion(view);
                  }}
                  onChanged={() => {
                    void pollObject();
                    setRefresh((value) => value + 1);
                  }}
                />
              )
            ))}
          {compact && !listOpen && (
            <button
              className="browse-floating"
              onClick={() => {
                void protect(async () => {
                  setAux(null);
                  setTableOpen(false);
                  setListOpen(true);
                });
              }}
            >
              <PanelLeft size={16} />
              {t(locale, 'ui.browse')}
            </button>
          )}
          {editor && metadataDialog === 'fields' && (
            <PropertiesEditor
              key={`fields-${editor.getSnapshot().editorId}`}
              api={api}
              editor={editor}
              onClose={() => setMetadataDialog(null)}
            />
          )}
          {editor && metadataDialog === 'relations' && (
            <RelationsEditor
              key={`relations-${editor.getSnapshot().editorId}`}
              api={api}
              session={session}
              editor={editor}
              onClose={() => setMetadataDialog(null)}
            />
          )}
          {editor && (metadataDialog === 'lifecycle' || metadataDialog === 'relink') && (
            <ObjectActionsDialog
              api={api}
              session={session}
              editor={editor}
              mode={metadataDialog}
              onExecute={executeObjectAction}
              onChoose={chooseRelink}
              onClose={() => setMetadataDialog(null)}
            />
          )}
          {importsOpen && (
            <ImportDialog
              api={api}
              session={session}
              onClose={() => {
                setImportsOpen(false);
                if (contextReturn === 'imports') {
                  setContextReturn(null);
                  setContextOpen(true);
                }
              }}
              onChanged={() => currentActions.current.refreshAll()}
              onOpen={(ref) => {
                contextRouteEpoch.current++;
                setContextReturn(null);
                setContextOpen(false);
                setImportsOpen(false);
                openReference(ref);
              }}
            />
          )}
          {recoveryOpen && (
            <RecoveryDialog
              api={api}
              session={session}
              onClose={() => setRecoveryOpen(false)}
              onResume={(draftId) => {
                setRecoveryOpen(false);
                void resumeDraft(draftId);
              }}
            />
          )}
          <ContextPreparation
            api={api}
            session={session}
            seed={contextSeed}
            open={contextOpen}
            onClose={closeContext}
            onAccess={prepareAccess}
            onImport={() => openImports(true)}
          />
          <AgentAccess
            key={session.bindingId}
            api={api}
            session={session}
            active={settingsOpen}
            draft={accessDraft}
            onCloseBlocked={(blocked) => {
              accessCloseBlocked.current = blocked;
            }}
            onGrants={(entries) => {
              grantEpoch.current++;
              setGrants(entries);
            }}
          >
            {(access) =>
              settingsOpen && (
                <Modal
                  title={t(locale, 'settings.title')}
                  onClose={() => {
                    if (accessCloseBlocked.current) return;
                    setSettingsOpen(false);
                    void loadGrants();
                    if (contextReturn === 'settings') {
                      setContextReturn(null);
                      setContextOpen(true);
                    }
                  }}
                  testId="settings-dialog"
                >
                  <Preferences
                    scale={scale}
                    busy={preferencesBusy}
                    onLocale={onLocale}
                    onScale={onScale}
                  />
                  {access}
                </Modal>
              )
            }
          </AgentAccess>
          <ActivityPane
            api={api}
            session={session}
            open={activityOpen}
            changesRequest={activityChangesRequest}
            error={activityError}
            onClose={() => setActivityOpen(false)}
            onOpen={(reference, trigger) =>
              openReference(reference, trigger, () => {
                setActivityError(null);
                setActivityReturn('reader');
                setActivityOpen(false);
              })
            }
            onProposal={(id) => {
              void openActivityProposal(id);
            }}
          />
          <span className="as-sr-only" aria-live="polite">
            {status.example ? t(locale, 'space.example') : ''}
          </span>
          {leaveAction && (
            <Modal
              title={t(locale, 'ui.leaveFailure')}
              onClose={() => setLeaveAction(null)}
              testId="leave-dialog"
            >
              <ErrorNotice code={editor?.getSnapshot().error ?? 'OPERATION_UNKNOWN'} />
              <div className="as-actions">
                <button
                  onClick={() => {
                    const intent = leaveAction;
                    setLeaveAction(null);
                    void protect(intent.action, intent.stage);
                  }}
                >
                  {t(locale, 'common.retry')}
                </button>
                <button
                  onClick={() => {
                    void copyEdits();
                  }}
                >
                  {t(locale, 'editor.copyEdits')}
                </button>
                <button
                  onClick={() => {
                    const intent = leaveAction;
                    setLeaveAction(null);
                    void protect(intent.action, intent.stage, true);
                  }}
                >
                  {t(locale, 'ui.discardEdits')}
                </button>
                <button onClick={() => setLeaveAction(null)}>{t(locale, 'ui.keepWorking')}</button>
              </div>
            </Modal>
          )}
        </div>
      </ReferenceRefreshContext.Provider>
    </TaskContext.Provider>
  );
});
