import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  FileText,
  Folder,
  ListChecks,
  Search,
  Activity,
  PanelLeft,
} from 'lucide-react';
import type { AppPreferences, DesktopApi, MenuCommand, SpaceSession } from '../contracts/app.js';
import type {
  ActivityEntry,
  DraftReceipt,
  DraftSnapshot,
  GrantSummary,
  ObjectSnapshot,
  ObjectSummary,
  ObjectView,
  ProposalSummary,
  ProposalView,
  SpaceStatus,
  WriteResult,
} from '../contracts/core.js';
import type { ErrorCode } from '../contracts/errors.js';
import type { ObjectContent, ObjectRef, QueryInput } from '../contracts/schema.js';
import { formatCount, formatNumber, t, titleText, type Locale } from './i18n/index.js';
import { bound, RequestGate } from './state/binding.js';
import { EditorSession } from './state/editor.js';
import { OperationTask } from './state/operation.js';
import {
  ErrorNotice,
  Modal,
  newKey,
  noteFromVersion,
  TaskContext,
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

type Destination = 'continue' | 'projects' | 'library' | 'review';
type ReaderEntry = { reference: ObjectRef; trigger?: string; scrollTop: number };
export type WorkbenchHandle = {
  prepareToLeave: () => Promise<boolean>;
  discardEdits: () => Promise<boolean>;
  copyEdits: () => Promise<void>;
  afterComposition: () => Promise<void>;
  lockInput: (locked: boolean) => boolean;
  command: (command: MenuCommand) => void;
};
type Props = {
  api: DesktopApi;
  session: SpaceSession;
  scale: AppPreferences['textScale'];
  preferencesBusy: boolean;
  onLocale: (locale: Locale) => void;
  onScale: (factor: AppPreferences['textScale']) => void;
};

const summary = (object: ObjectSnapshot): ObjectSummary => ({
  ref: { mode: 'pinned', objectId: object.id, revision: object.revision },
  title: object.content.title,
  kind: object.kind,
  lifecycle: object.lifecycle,
  digest: object.digest,
  updatedAt: object.createdAt,
});
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
  { api, session, scale, preferencesBusy, onLocale, onScale },
  ref,
) {
  const locale = useLocale();
  const [destination, setDestination] = useState<Destination>('continue');
  const [objects, setObjects] = useState<ObjectSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState(''),
    [kind, setKind] = useState<QueryInput['filter']['kind']>(),
    [projectId, setProjectId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [proposalNext, setProposalNext] = useState<{
    pending: string | null;
    conflicted: string | null;
  }>({ pending: null, conflicted: null });
  const [selectedProposal, setSelectedProposal] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const editorRef = useRef<EditorSession | null>(null);
  const [aux, setAux] = useState<'details' | 'history' | null>(null);
  const [readers, setReaders] = useState<ReaderEntry[]>([]);
  const [drafts, setDrafts] = useState<DraftReceipt[]>([]),
    [draftNext, setDraftNext] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]),
    [activityOpen, setActivityOpen] = useState(false);
  const [status, setStatus] = useState<SpaceStatus>(session.status);
  const [grants, setGrants] = useState<GrantSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null),
    [feedback, setFeedback] = useState(false);
  const [proposalLoadError, setProposalLoadError] = useState<ErrorCode | null>(null);
  const [leaveAction, setLeaveAction] = useState<(() => Promise<void>) | null>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1099px)').matches);
  const [listOpen, setListOpen] = useState(true);
  const compact = narrow || scale >= 1.5;
  const alive = useRef(true),
    queryGate = useRef(new RequestGate()),
    objectGate = useRef(new RequestGate());
  const proposalEpoch = useRef(0),
    draftEpoch = useRef(0),
    grantEpoch = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const tasks = useRef(new Map<string, OperationTask<unknown>>());
  const commandTask = useRef<{ task: OperationTask<WriteResult> } | null>(null);
  const protecting = useRef(false);
  const openingReference = useRef(false);
  const operations = useRef<MakeTask>((key, send) => {
    const task = new OperationTask(api, session, key, send);
    tasks.current.set(key, task);
    return task;
  });
  const currentActions = useRef({ refreshAll: () => {}, pollObject: () => {} });

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
  async function prepareToLeave() {
    const activeEditor = editorRef.current;
    if (activeEditor && !(await activeEditor.prepareToLeave())) return false;
    if (activeEditor !== editorRef.current) return false;
    return resolveOperations();
  }
  async function discardEdits() {
    if (!(await resolveOperations())) return false;
    return !editorRef.current || (await editorRef.current.discardEdits());
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
  async function protect(action: () => Promise<void>) {
    if (busy || protecting.current || editorRef.current?.getSnapshot().locked) return;
    protecting.current = true;
    try {
      if (await prepareToLeave()) await action();
      else setLeaveAction(() => action);
    } finally {
      protecting.current = false;
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
  function installEditor(
    view: ObjectView | null,
    draft?: DraftSnapshot,
    content?: ObjectContent,
    proposalId?: string,
  ) {
    const own: EditorSession = new EditorSession(api, session, view, {
      draft,
      content,
      source: proposalId ? { kind: 'proposal', proposalId } : undefined,
      onSaved: (object) => {
        if (!alive.current || editorRef.current !== own) return;
        remember(object.id);
        setObjects((old) => [
          summary(object),
          ...old.filter((entry) => entry.ref.objectId !== object.id),
        ]);
        setRefresh((value) => value + 1);
      },
    });
    editorRef.current?.dispose();
    editorRef.current = own;
    setEditor(own);
    setReaders([]);
    setSelectedProposal(null);
    setListOpen(false);
    setAux(null);
    if (view) remember(view.object.id);
  }
  async function readEditor(id: string) {
    const ticket = objectGate.current.begin(session, id);
    setLoading(true);
    setError(null);
    try {
      const result = await api.readObject(bound(session, { objectId: id }));
      if (!alive.current || !objectGate.current.accepts(ticket, session, id)) return;
      if (result.ok) {
        installEditor(result.value);
        // Review's result/current-object action enters the document workspace.
        // Ordinary project browsing keeps its project destination.
        if (destination === 'review') setDestination('library');
      } else setError(result.error.code);
    } catch {
      if (alive.current && objectGate.current.accepts(ticket, session, id))
        setError('OPERATION_UNKNOWN');
    } finally {
      if (alive.current && objectGate.current.accepts(ticket, session, id)) setLoading(false);
    }
  }
  function openEditor(id: string) {
    void protect(() => readEditor(id));
  }

  async function createNote(
    content: ObjectContent = { title: '', body: '', properties: {}, relations: [] },
  ) {
    if (!commandTask.current || commandTask.current.task.settled) {
      const input = {
        operationKey: newKey('create'),
        id: crypto.randomUUID(),
        kind: 'document' as const,
        content: structuredClone(content),
        generation: 0,
      };
      commandTask.current = {
        task: operations.current(input.operationKey, () => api.createObject(bound(session, input))),
      };
    }
    setBusy(true);
    setError(null);
    try {
      const result = await commandTask.current.task.run();
      if (!alive.current) return;
      if (result.ok) {
        installEditor({
          object: result.value.object,
          currentRevision: result.value.object.revision,
          relationTargets: [],
        });
        setDestination('library');
        setObjects((old) => [
          summary(result.value.object),
          ...old.filter((entry) => entry.ref.objectId !== result.value.object.id),
        ]);
        setRefresh((value) => value + 1);
      } else {
        setError(result.error.code);
        commandTask.current = null;
      }
    } catch {
      if (alive.current) setError('OPERATION_UNKNOWN');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function copyVersion(view: ObjectView) {
    await protect(() => createNote(noteFromVersion(view, locale)));
  }
  async function useProposalDraft(view: ProposalView) {
    await protect(async () => {
      const content = structuredClone(view.proposedContent);
      if (view.proposal.kind !== 'document') {
        const properties = Object.values(content.properties)
          .map((field) => `${field.label}: ${String(field.value ?? '')}`)
          .join('\n');
        content.body = [content.body, properties].filter(Boolean).join('\n\n');
        content.properties = {};
      }
      installEditor(null, undefined, content, view.proposal.id);
      setDestination('library');
      await editorRef.current?.keepDraft();
    });
  }
  async function resumeDraft(draftId: string) {
    await protect(async () => {
      const result = await api.readDraft(bound(session, { draftId })).catch(() => null);
      if (!alive.current) return;
      if (!result?.ok) {
        setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
        return;
      }
      const draft = result.value;
      const current =
        draft.target.state === 'existing'
          ? await api
              .readObject(bound(session, { objectId: draft.target.objectId }))
              .catch(() => null)
          : null;
      if (!alive.current) return;
      if (draft.target.state === 'existing' && !current?.ok) {
        setError(current && !current.ok ? current.error.code : 'OPERATION_UNKNOWN');
        return;
      }
      installEditor(current?.ok ? current.value : null, draft);
      setDestination('library');
    });
  }

  async function loadObjects(next?: string) {
    const ticket = queryGate.current.begin(session);
    const filter: QueryInput['filter'] = {
      ...(destination === 'projects' ? { kind: 'project' as const } : kind ? { kind } : {}),
      ...(text ? { text } : {}),
      ...(projectId ? { projectId } : {}),
    };
    setLoading(true);
    try {
      const result = await api.query(
        bound(session, { filter, limit: 50, maxBytes: 65_536, ...(next ? { cursor: next } : {}) }),
      );
      if (!alive.current || !queryGate.current.accepts(ticket, session)) return;
      if (result.ok) {
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
        setError(null);
      } else {
        setError(result.error.code);
        if (result.error.code === 'CURSOR_STALE') setCursor(null);
      }
    } catch {
      if (alive.current && queryGate.current.accepts(ticket, session))
        setError('OPERATION_UNKNOWN');
    } finally {
      if (alive.current && queryGate.current.accepts(ticket, session)) setLoading(false);
    }
  }
  async function loadProposals(more = false) {
    const ticket = ++proposalEpoch.current;
    const pages = await Promise.all(
      (['pending', 'conflicted'] as const).map((status) =>
        more && !proposalNext[status]
          ? Promise.resolve(null)
          : api
              .listProposals(
                bound(session, {
                  status,
                  limit: 50,
                  ...(more && proposalNext[status] ? { afterId: proposalNext[status]! } : {}),
                }),
              )
              .catch(() => ({
                ok: false as const,
                error: { code: 'OPERATION_UNKNOWN' as const, retryable: true },
              })),
      ),
    );
    if (!alive.current || ticket !== proposalEpoch.current) return;
    const items = pages.flatMap((page) => (page?.ok ? page.value.items : []));
    const bad = pages.find((page) => page && !page.ok);
    setProposalLoadError(bad && !bad.ok ? bad.error.code : null);
    setProposals((old) => {
      const retained = more
        ? old
        : old.filter((entry) => {
            const index = entry.status === 'pending' ? 0 : 1;
            return !pages[index]?.ok;
          });
      const map = new Map(retained.map((entry) => [entry.id, entry]));
      for (const item of items) {
        const existing = map.get(item.id);
        if (!existing || item.statusVersion >= existing.statusVersion) map.set(item.id, item);
      }
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    setProposalNext((old) => ({
      pending: pages[0]?.ok ? pages[0].value.nextAfterId : old.pending,
      conflicted: pages[1]?.ok ? pages[1].value.nextAfterId : old.conflicted,
    }));
  }
  async function loadDrafts(next?: string) {
    const ticket = ++draftEpoch.current;
    const result = await api
      .listDrafts(bound(session, { limit: 20, ...(next ? { beforeId: next } : {}) }))
      .catch(() => null);
    if (!alive.current || ticket !== draftEpoch.current) return;
    if (result?.ok) {
      setDrafts((old) =>
        next
          ? [...old, ...result.value.items.filter((entry) => entry.retained)]
          : result.value.items.filter((entry) => entry.retained),
      );
      setDraftNext(result.value.nextBeforeId);
    }
  }
  async function pollObject() {
    const current = editorRef.current;
    const id = current?.getSnapshot().objectId;
    if (!current || !id) return;
    const result = await api.readObject(bound(session, { objectId: id })).catch(() => null);
    if (alive.current && editorRef.current === current && result?.ok) current.observe(result.value);
  }
  async function loadGrants() {
    const ticket = ++grantEpoch.current;
    const result = await api.listGrants(bound(session, null)).catch(() => null);
    if (alive.current && ticket === grantEpoch.current && result?.ok) setGrants(result.value);
  }
  currentActions.current = {
    refreshAll: () => {
      void loadObjects();
      void loadProposals();
      void loadDrafts();
      void loadGrants();
    },
    pollObject: () => {
      void pollObject();
    },
  };
  useEffect(() => {
    void loadObjects();
  }, [destination, kind, text, projectId]);
  useEffect(() => {
    alive.current = true;
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
        if (now.value.authoritySequence !== authority) {
          authority = now.value.authoritySequence;
          currentActions.current.refreshAll();
          currentActions.current.pollObject();
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
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      queryGate.current.invalidate();
      objectGate.current.invalidate();
      editorRef.current?.dispose();
    };
  }, [session.bindingId]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)');
    const listener = () => setNarrow(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        event.isComposing ||
        editorRef.current?.getSnapshot().composing ||
        document.querySelector('dialog[open]')
      )
        return;
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
    if (value === 'save') {
      void editorRef.current?.saveNow();
      return;
    }
    if (value === 'settings') {
      void editorRef.current?.afterComposition().then(() => setSettingsOpen(true));
      if (!editorRef.current) setSettingsOpen(true);
      return;
    }
    if (value === 'new-note') {
      void protect(() => createNote());
      return;
    }
    void protect(async () => {
      setDestination('library');
      setReaders([]);
      setAux(null);
      setListOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    });
  }
  useImperativeHandle(ref, () => ({
    prepareToLeave,
    discardEdits,
    copyEdits,
    command,
    afterComposition: () => editorRef.current?.afterComposition() ?? Promise.resolve(),
    lockInput: (locked) => editorRef.current?.lockInput(locked) ?? true,
  }));

  function openReference(reference: ObjectRef, trigger?: string) {
    if (openingReference.current || editorRef.current?.getSnapshot().locked) return;
    openingReference.current = true;
    const activeEditor = editorRef.current;
    void (async () => {
      await activeEditor?.afterComposition();
      if (
        !alive.current ||
        activeEditor !== editorRef.current ||
        activeEditor?.getSnapshot().locked
      )
        return;
      const scrollTop =
        document.querySelector('.source-reader .document-scroll')?.scrollTop ??
        document.querySelector('.review-scroll')?.scrollTop ??
        document.querySelector('.document-scroll')?.scrollTop ??
        0;
      setReaders((old) => [...old, { reference, trigger, scrollTop }]);
      setListOpen(false);
    })().finally(() => {
      openingReference.current = false;
    });
  }
  function backFromReference() {
    const current = readers.at(-1);
    setReaders((old) => old.slice(0, -1));
    requestAnimationFrame(() => {
      const scroll =
        document.querySelector('.review-scroll') ?? document.querySelector('.document-scroll');
      if (scroll && current) scroll.scrollTop = current.scrollTop;
      (current?.trigger
        ? document.getElementById(current.trigger)
        : document.getElementById('proposal-heading')
      )?.focus();
    });
  }
  function chooseDestination(value: Destination) {
    void protect(async () => {
      setDestination(value);
      setText('');
      setKind(undefined);
      setProjectId(null);
      setReaders([]);
      setAux(null);
      setListOpen(true);
      if (value !== 'review') setSelectedProposal(null);
    });
  }
  async function earlierActivity() {
    const minimum = Math.min(...activity.map((entry) => entry.id));
    if (!Number.isFinite(minimum) || minimum <= 1) return;
    const result = await api
      .activity(
        bound(session, { after: Math.max(0, minimum - 51), through: minimum - 1, limit: 50 }),
      )
      .catch(() => null);
    if (alive.current && result?.ok)
      setActivity((old) => [
        ...old,
        ...result.value.items.filter((entry) => !old.some((existing) => existing.id === entry.id)),
      ]);
  }
  const nav = [
    { id: 'continue', key: 'nav.continue', icon: BookOpen },
    { id: 'projects', key: 'nav.projects', icon: Folder },
    { id: 'library', key: 'nav.library', icon: FileText },
    { id: 'review', key: 'nav.review', icon: ListChecks },
  ] as const;
  const moreProposals = !!proposalNext.pending || !!proposalNext.conflicted;
  const countLabel = moreProposals
    ? t(locale, 'ui.atLeastPending', { count: proposals.length })
    : formatCount(locale, 'pendingProposals', proposals.length);
  const activeObject = editor?.getSnapshot().objectId;
  const lastPrepared = activity.find((entry) => entry.stage === 'prepared');
  const reader = readers.at(-1);
  return (
    <TaskContext.Provider value={operations.current}>
      <div
        className="workbench"
        data-compact={compact}
        data-list-open={listOpen}
        data-aux={aux ?? ''}
        data-testid="workbench"
      >
        <nav className="workspace-nav" aria-label={t(locale, 'app.name')}>
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
            <button onClick={() => setActivityOpen(true)} data-testid="open-activity">
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
          {destination !== 'review' && (
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
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              {destination !== 'projects' && (
                <select
                  aria-label={t(locale, 'ui.type')}
                  value={kind ?? ''}
                  onChange={(event) =>
                    setKind((event.target.value || undefined) as QueryInput['filter']['kind'])
                  }
                >
                  <option value="">{t(locale, 'ui.allMaterial')}</option>
                  <option value="document">{t(locale, 'ui.notes')}</option>
                  <option value="record">{t(locale, 'object.record')}</option>
                  <option value="asset">{t(locale, 'object.asset')}</option>
                </select>
              )}
              {text && <small>{t(locale, 'ui.searchLiteral')}</small>}
              {projectId && (
                <button onClick={() => setProjectId(null)}>
                  {t(locale, 'common.remove')} · {t(locale, 'relation.inProject')}
                </button>
              )}
            </div>
          )}
          <div className="list-scroll as-scroll-region">
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
            {destination === 'review' ? (
              <>
                {proposals.map((proposal) => (
                  <button
                    className={`material-row ${selectedProposal === proposal.id ? 'selected' : ''}`}
                    key={proposal.id}
                    onClick={() => {
                      void protect(async () => {
                        setSelectedProposal(proposal.id);
                        setReaders([]);
                        setAux(null);
                        setListOpen(false);
                      });
                    }}
                    data-testid={`proposal-row-${proposal.id}`}
                  >
                    <span className="row-title">
                      {!proposal.seen && (
                        <span className="unread-dot" aria-label={t(locale, 'proposal.unread')} />
                      )}{' '}
                      {proposal.purpose}
                    </span>
                    <small>
                      {t(
                        locale,
                        proposal.status === 'conflicted'
                          ? 'proposal.conflicted'
                          : proposal.action === 'create'
                            ? proposal.kind === 'record'
                              ? 'proposal.proposedNewRecord'
                              : 'proposal.proposedNewNote'
                            : 'proposal.pending',
                      )}
                    </small>
                    <small>
                      <Time value={proposal.createdAt} />
                    </small>
                  </button>
                ))}
                {proposals.length === 0 && !moreProposals && !proposalLoadError && (
                  <p className="list-empty">{t(locale, 'proposal.noPending')}</p>
                )}
                {moreProposals && (
                  <button
                    onClick={() => {
                      void loadProposals(true);
                    }}
                  >
                    {t(locale, 'ui.moreResults')}
                  </button>
                )}
              </>
            ) : (
              <>
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
                      <Time value={object.updatedAt} />
                    </small>
                  </button>
                ))}
                {!objects.length && !loading && (
                  <p className="list-empty">
                    {t(locale, text ? 'context.noMatches' : 'ui.emptyMaterial')}
                  </p>
                )}
                {cursor && (
                  <button
                    onClick={() => {
                      void loadObjects(cursor);
                    }}
                  >
                    {t(locale, 'ui.moreResults')}
                  </button>
                )}
                {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
              </>
            )}
          </div>
        </aside>
        <main className="working-surface" id="working-surface">
          {(error || (destination === 'review' && proposalLoadError) || feedback) && (
            <div className="surface-notices">
              <ErrorNotice
                code={error}
                onRetry={() => {
                  if (commandTask.current?.task.unknown) void createNote();
                  else currentActions.current.refreshAll();
                }}
              />
              {destination === 'review' && proposalLoadError && (
                <ErrorNotice
                  code={proposalLoadError}
                  onRetry={() => {
                    void loadProposals();
                  }}
                />
              )}
              {feedback && <p role="status">{t(locale, 'common.copied')}</p>}
            </div>
          )}
          <div hidden={!!reader} className="primary-surface">
            {destination === 'review' && selectedProposal ? (
              <ReviewPane
                key={selectedProposal}
                api={api}
                session={session}
                proposalId={selectedProposal}
                refresh={refresh}
                grants={grants}
                onOpen={openReference}
                onEdit={openEditor}
                onDraft={(view) => {
                  void useProposalDraft(view);
                }}
                onChanged={() => {
                  void loadProposals();
                }}
              />
            ) : editor ? (
              <DocumentPane
                editor={editor}
                api={api}
                session={session}
                onOpen={openReference}
                onHistory={() => setAux((old) => (old === 'history' ? null : 'history'))}
                onDetails={() => setAux('details')}
                onBrowse={() => {
                  void protect(async () => {
                    setAux(null);
                    setListOpen(true);
                  });
                }}
                compact={compact}
                onProjectMaterial={(id) => {
                  void protect(async () => {
                    setDestination('library');
                    setProjectId(id);
                    setAux(null);
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
                    void protect(() => createNote());
                  }}
                >
                  {t(locale, 'object.newNote')}
                </button>
              </div>
            )}
          </div>
          {reader && (
            <SourceReader
              key={`${readers.length}-${reader.reference.objectId}-${reader.reference.mode === 'pinned' ? reader.reference.revision : 'current'}`}
              api={api}
              session={session}
              reference={reader.reference}
              onBack={backFromReference}
              onOpen={openReference}
              onCopyVersion={(view) => {
                void copyVersion(view);
              }}
            />
          )}
        </main>
        {editor &&
          aux &&
          !reader &&
          destination !== 'review' &&
          (aux === 'details' ? (
            <DetailsPane
              key={`details-${editor.getSnapshot().editorId}`}
              api={api}
              session={session}
              editor={editor}
              onClose={() => {
                setAux(null);
                document.getElementById('details-button')?.focus();
              }}
              onOpen={openReference}
              onRefresh={() => {
                void pollObject();
              }}
            />
          ) : (
            editor.getSnapshot().objectId && (
              <HistoryPane
                key={`history-${editor.getSnapshot().objectId}`}
                api={api}
                session={session}
                objectId={editor.getSnapshot().objectId!}
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
                setListOpen(true);
              });
            }}
          >
            <PanelLeft size={16} />
            {t(locale, 'ui.browse')}
          </button>
        )}
        {settingsOpen && (
          <Modal
            title={t(locale, 'settings.title')}
            onClose={() => {
              setSettingsOpen(false);
              void loadGrants();
            }}
            testId="settings-dialog"
          >
            <Preferences
              scale={scale}
              busy={preferencesBusy}
              onLocale={onLocale}
              onScale={onScale}
            />
            <AgentAccess
              api={api}
              session={session}
              onGrants={(entries) => {
                grantEpoch.current++;
                setGrants(entries);
              }}
            />
          </Modal>
        )}
        {activityOpen && (
          <ActivityPane
            api={api}
            session={session}
            entries={activity}
            more={activity.length > 0 && Math.min(...activity.map((entry) => entry.id)) > 1}
            onClose={() => setActivityOpen(false)}
            onOpen={openReference}
            onEarlier={() => {
              void earlierActivity();
            }}
          />
        )}
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
                  const action = leaveAction;
                  void prepareToLeave().then((ready) => {
                    if (ready) {
                      setLeaveAction(null);
                      void action();
                    }
                  });
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
                  const action = leaveAction;
                  void discardEdits().then((ready) => {
                    if (ready) {
                      setLeaveAction(null);
                      void action();
                    }
                  });
                }}
              >
                {t(locale, 'ui.discardEdits')}
              </button>
              <button onClick={() => setLeaveAction(null)}>{t(locale, 'ui.keepWorking')}</button>
            </div>
          </Modal>
        )}
      </div>
    </TaskContext.Provider>
  );
});
