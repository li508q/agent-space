import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Search, Settings } from 'lucide-react';
import type { AppPreferences, DesktopApi, MenuCommand, SpaceSession } from '../contracts/app.js';
import type { ErrorCode } from '../contracts/errors.js';
import { LocaleContext, Brand, ErrorNotice, Modal } from './ui.js';
import { Preferences } from './components/Preferences.js';
import { resolveSystemLocale, t, type Locale } from './i18n/index.js';
import { Workbench, type WorkbenchHandle } from './Workbench.js';
import { CloseCoordinator, type CloseState } from './state/close.js';

export function App({ api }: { api: DesktopApi | null }) {
  if (!api) {
    const locale = resolveSystemLocale(navigator.languages);
    return (
      <LocaleContext.Provider value={locale}>
        <div className="standalone-state">
          <Brand />
          <h1>{t(locale, 'ui.desktopRequired')}</h1>
          <p>{t(locale, 'ui.desktopRequiredBody')}</p>
          <button onClick={() => location.reload()}>{t(locale, 'common.retry')}</button>
        </div>
      </LocaleContext.Provider>
    );
  }
  return <DesktopApp api={api} />;
}

function DesktopApp({ api }: { api: DesktopApi }) {
  const [locale, setLocale] = useState<Locale>(() => resolveSystemLocale(navigator.languages));
  const [preferences, setPreferences] = useState<AppPreferences>({ locale: null, textScale: 1 });
  const [session, setSession] = useState<SpaceSession | null>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [preferencesBusy, setPreferencesBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [createOpen, setCreateOpen] = useState(false),
    [spaceTitle, setSpaceTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leave, setLeave] = useState<{
    next: (ticket: number) => Promise<void>;
    closeId?: string;
  } | null>(null);
  const [closeState, setCloseState] = useState<CloseState>(null);
  const [closingLocked, setClosingLocked] = useState(false);
  const header = useRef<HTMLElement>(null),
    content = useRef<HTMLDivElement>(null);
  const closeLocked = useRef(false),
    closer = useRef<CloseCoordinator | null>(null);
  const movingSpace = useRef(false);
  const workbench = useRef<WorkbenchHandle>(null);
  const actionRef = useRef<{
    command: (command: MenuCommand) => void;
    close: (id: string) => Promise<void>;
  }>({ command: () => {}, close: async () => {} });
  const guarding = useRef(false),
    live = useRef(true);
  const platformEpoch = useRef(0);
  const targetBinding = useRef<string | null>(null);
  const spaceTitleComposing = useRef(false);
  function adoptSession(next: SpaceSession | null) {
    targetBinding.current = next?.bindingId ?? null;
    setSession(next);
  }
  if (!closer.current)
    closer.current = new CloseCoordinator({
      afterComposition: () => workbench.current?.afterComposition() ?? Promise.resolve(),
      lockInput: (locked) => {
        if (workbench.current && !workbench.current.lockInput(locked)) return false;
        closeLocked.current = locked;
        if (header.current) header.current.inert = locked || movingSpace.current;
        if (content.current) content.current.inert = locked || movingSpace.current;
        setClosingLocked(locked);
        return true;
      },
      prepare: () => workbench.current?.prepareToLeave() ?? Promise.resolve(true),
      discard: () => workbench.current?.discardEdits() ?? Promise.resolve(true),
      respond: (requestId, decision) => api.respondToClose({ requestId, decision }),
      changed: setCloseState,
      error: setError,
    });
  async function bootstrap() {
    const ticket = ++platformEpoch.current;
    setError(null);
    try {
      const result = await api.bootstrap();
      if (!live.current || ticket !== platformEpoch.current) return;
      if (result.ok) {
        setPreferences(result.value.preferences);
        setLocale(
          result.value.preferences.locale ?? resolveSystemLocale(result.value.systemLocales),
        );
        adoptSession(result.value.activeSpace);
        setError(result.value.startupError?.code ?? null);
        setReady(true);
      } else setError(result.error.code);
    } catch {
      if (live.current && ticket === platformEpoch.current) setError('OPERATION_UNKNOWN');
    }
  }
  useEffect(() => {
    live.current = true;
    void bootstrap();
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    // Native WebContents owns zoom. Multiplying rem here would apply the preference twice.
    document.documentElement.style.fontSize = '16px';
  }, [locale, preferences.textScale]);
  async function protect(
    next: (ticket: number) => Promise<void>,
    closeId?: string,
    discard = false,
  ) {
    if (guarding.current || closer.current?.pendingId) {
      if (closeId) await api.respondToClose({ requestId: closeId, decision: 'cancel' });
      return;
    }
    guarding.current = true;
    const ticket = ++platformEpoch.current;
    const original = workbench.current;
    let locked = false;
    try {
      await original?.afterComposition();
      if (
        !live.current ||
        original?.bindingId !== workbench.current?.bindingId ||
        closer.current?.pendingId
      )
        return;
      if (original && !original.lockInput(true, 'space')) return;
      locked = true;
      movingSpace.current = true;
      setBusy(true);
      if (header.current) header.current.inert = true;
      if (content.current) content.current.inert = true;
      const safe =
        !original || (await (discard ? original.discardEdits() : original.prepareToLeave()));
      if (!live.current || original?.bindingId !== workbench.current?.bindingId) return;
      if (safe && !closer.current?.pendingId) {
        setLeave(null);
        await next(ticket);
      } else setLeave({ next, closeId });
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
    } finally {
      // Keep the old DOM/editor paused until its binding is actually unmounted.
      // A new binding gets its own independent lock owners on mount.
      if (locked && targetBinding.current === (original?.bindingId ?? null))
        original?.lockInput(false, 'space');
      movingSpace.current = false;
      if (header.current) header.current.inert = closeLocked.current;
      if (content.current) content.current.inert = closeLocked.current;
      if (live.current) setBusy(false);
      guarding.current = false;
    }
  }
  async function selectSpace(mode: 'create' | 'open' | 'example') {
    await protect(async (ticket) => {
      setError(null);
      try {
        const result =
          mode === 'create'
            ? await api.createSpace({ title: spaceTitle })
            : mode === 'open'
              ? await api.openSpace()
              : await api.openExample();
        if (!live.current || ticket !== platformEpoch.current) return;
        if (result.ok) {
          if (result.value) {
            adoptSession(result.value);
            setCreateOpen(false);
            setSpaceTitle('');
          } else await bootstrap();
        } else {
          setError(result.error.code);
          if (result.error.code === 'OPERATION_UNKNOWN') {
            const observed = await api.bootstrap().catch(() => null);
            if (live.current && ticket === platformEpoch.current && observed?.ok)
              adoptSession(observed.value.activeSpace);
          }
        }
      } catch {
        if (!live.current || ticket !== platformEpoch.current) return;
        // A platform reply can be lost after binding. Re-observe bootstrap, never fabricate a space.
        setError('OPERATION_UNKNOWN');
        const observed = await api.bootstrap().catch(() => null);
        if (
          live.current &&
          ticket === platformEpoch.current &&
          observed?.ok &&
          observed.value.activeSpace
        )
          adoptSession(observed.value.activeSpace);
      }
    });
  }
  async function close(requestId: string) {
    if (document.querySelector('dialog[open]:not([data-testid="native-close-dialog"])')) {
      await api.respondToClose({ requestId, decision: 'cancel' });
      return;
    }
    await closer.current!.start(requestId);
  }
  function command(value: MenuCommand) {
    if (
      busy ||
      movingSpace.current ||
      closer.current?.pendingId ||
      document.querySelector('dialog[open]')
    )
      return;
    if (workbench.current) workbench.current.command(value);
    else if (value === 'settings') setSettingsOpen(true);
    else if (value === 'new-note') setCreateOpen(true);
  }
  actionRef.current = { command, close };
  useEffect(() => {
    const menu = api.onMenuCommand((value) => actionRef.current.command(value));
    const closing = api.onCloseRequested(({ requestId }) => {
      void actionRef.current.close(requestId);
    });
    const cancelled = api.onCloseCancelled(({ requestId }) => closer.current?.cancel(requestId));
    const blockLateInput = (event: Event) => {
      if (
        (closeLocked.current || movingSpace.current) &&
        !(event.target instanceof Element && event.target.closest('dialog'))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeinput', blockLateInput, true);
    window.addEventListener('keydown', blockLateInput, true);
    return () => {
      menu();
      closing();
      cancelled();
      window.removeEventListener('beforeinput', blockLateInput, true);
      window.removeEventListener('keydown', blockLateInput, true);
    };
  }, [api]);
  async function changePreference(value: Locale | AppPreferences['textScale']) {
    if (preferencesBusy) return;
    setPreferencesBusy(true);
    setError(null);
    try {
      const result =
        typeof value === 'string'
          ? await api.setLocale({ locale: value })
          : await api.setTextScale({ factor: value });
      if (result.ok) {
        setPreferences(result.value);
        if (result.value.locale) setLocale(result.value.locale);
      } else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setPreferencesBusy(false);
    }
  }
  return (
    <LocaleContext.Provider value={locale}>
      <div className="desktop-app" data-scale={preferences.textScale} data-testid="desktop-app">
        <header className="app-header" ref={header} inert={busy || closingLocked}>
          <div className="app-identity">
            <Brand />
            <span className="app-name">AgentSpace</span>
            <details className="space-menu">
              <summary data-testid="space-menu">
                {session?.status.title ?? t(locale, 'space.open')}
                <ChevronDown size={14} />
              </summary>
              <div>
                <button
                  data-testid="create-space-menu"
                  disabled={busy}
                  onClick={() => setCreateOpen(true)}
                >
                  {t(locale, 'space.create')}
                </button>
                <button
                  data-testid="open-space-menu"
                  disabled={busy}
                  onClick={() => {
                    void selectSpace('open');
                  }}
                >
                  {t(locale, 'space.open')}
                </button>
                <button
                  data-testid="example-space-menu"
                  disabled={busy}
                  onClick={() => {
                    void selectSpace('example');
                  }}
                >
                  {t(locale, 'space.openExample')}
                </button>
                {session && <small className="as-wrap">{session.locationLabel}</small>}
              </div>
            </details>
            {session?.status.example && (
              <span className="example-badge" data-testid="example-badge">
                {t(locale, 'space.example')}
              </span>
            )}
          </div>
          <div className="app-commands as-actions">
            <button
              data-testid="global-search"
              disabled={!session || busy}
              onClick={() => command('search')}
            >
              <Search size={17} />
              <span>{t(locale, 'ui.search')}</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              className="primary"
              data-testid="new-note"
              disabled={!session || busy}
              onClick={() => command('new-note')}
            >
              <Plus size={17} />
              {t(locale, 'object.newNote')}
            </button>
            <button
              data-testid="settings-button"
              className="icon-button"
              aria-label={t(locale, 'settings.title')}
              onClick={() => command('settings')}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        {closingLocked && (
          <div className="closing-notice" role="status" data-testid="preparing-close">
            {t(locale, 'ui.preparingClose')}
          </div>
        )}
        {busy && !closingLocked && (
          <div className="closing-notice" role="status" data-testid="space-transition">
            {t(locale, 'ui.openingSpace')}
          </div>
        )}
        {error && (
          <div className="app-error">
            <ErrorNotice
              code={error}
              onRetry={() => {
                void protect(async () => {
                  await bootstrap();
                });
              }}
            />
          </div>
        )}
        <div
          className="app-content"
          ref={content}
          inert={busy || closingLocked}
          aria-busy={busy || closingLocked}
        >
          {session ? (
            <Workbench
              key={session.bindingId}
              ref={workbench}
              api={api}
              session={session}
              scale={preferences.textScale}
              preferencesBusy={preferencesBusy}
              closingLocked={closingLocked}
              onLocale={(value) => {
                void changePreference(value);
              }}
              onScale={(value) => {
                void changePreference(value);
              }}
            />
          ) : (
            <main className="welcome">
              <div className="welcome-content">
                <Brand />
                <h1>{t(locale, 'ui.startSpace')}</h1>
                <p>{t(locale, 'space.noSpace')}</p>
                <div className="as-actions">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                    data-testid="create-space"
                  >
                    {t(locale, 'space.create')}
                  </button>
                  <button
                    onClick={() => {
                      void selectSpace('open');
                    }}
                    data-testid="open-space"
                  >
                    {t(locale, 'space.open')}
                  </button>
                </div>
                <div className="example-entry">
                  <button
                    className="text-button"
                    onClick={() => {
                      void selectSpace('example');
                    }}
                    data-testid="example-space"
                  >
                    {t(locale, 'space.openExample')}
                  </button>
                  <p className="secondary">{t(locale, 'space.exampleNotice')}</p>
                </div>
                {!ready && <p role="status">{t(locale, 'ui.loading')}</p>}
              </div>
            </main>
          )}
        </div>
        {createOpen && (
          <Modal
            title={t(locale, 'space.create')}
            onClose={() => {
              if (!busy) setCreateOpen(false);
            }}
            testId="create-space-dialog"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!spaceTitleComposing.current) void selectSpace('create');
              }}
            >
              <label>
                {t(locale, 'space.name')}
                <input
                  value={spaceTitle}
                  maxLength={160}
                  required
                  autoFocus
                  data-testid="space-title"
                  disabled={busy}
                  onCompositionStart={() => {
                    spaceTitleComposing.current = true;
                  }}
                  onCompositionEnd={() => {
                    spaceTitleComposing.current = false;
                  }}
                  onChange={(event) => setSpaceTitle(event.target.value)}
                />
              </label>
              <div className="as-actions">
                <button className="primary" type="submit" disabled={busy || !spaceTitle.trim()}>
                  {t(locale, 'space.chooseLocation')}
                </button>
                <button type="button" onClick={() => setCreateOpen(false)} disabled={busy}>
                  {t(locale, 'common.cancel')}
                </button>
              </div>
            </form>
          </Modal>
        )}
        {settingsOpen && (
          <Modal title={t(locale, 'settings.title')} onClose={() => setSettingsOpen(false)}>
            <Preferences
              scale={preferences.textScale}
              busy={preferencesBusy}
              onLocale={(value) => {
                void changePreference(value);
              }}
              onScale={(value) => {
                void changePreference(value);
              }}
            />
          </Modal>
        )}
        {closeState?.stage === 'blocked' && (
          <Modal
            title={t(locale, 'ui.leaveFailure')}
            testId="native-close-dialog"
            onClose={() => {
              void closer.current?.keepOpen(closeState.requestId);
            }}
          >
            <div className="as-actions">
              <button
                onClick={() => {
                  void closer.current?.retry(closeState.requestId);
                }}
              >
                {t(locale, 'common.retry')}
              </button>
              <button
                onClick={() => {
                  void workbench.current?.copyEdits();
                }}
              >
                {t(locale, 'editor.copyEdits')}
              </button>
              <button
                onClick={() => {
                  void closer.current?.discard(closeState.requestId);
                }}
              >
                {t(locale, 'ui.discardEdits')}
              </button>
              <button
                onClick={() => {
                  void closer.current?.keepOpen(closeState.requestId);
                }}
              >
                {t(locale, 'ui.keepWorking')}
              </button>
            </div>
          </Modal>
        )}
        {leave && (
          <Modal
            title={t(locale, 'ui.leaveFailure')}
            testId="native-leave-dialog"
            onClose={() => {
              if (leave.closeId)
                void api.respondToClose({ requestId: leave.closeId, decision: 'cancel' });
              setLeave(null);
            }}
          >
            <div className="as-actions">
              <button
                onClick={() => {
                  const intent = leave;
                  void protect(intent.next, intent.closeId);
                }}
              >
                {t(locale, 'common.retry')}
              </button>
              <button
                onClick={() => {
                  void workbench.current?.copyEdits();
                }}
              >
                {t(locale, 'editor.copyEdits')}
              </button>
              <button
                onClick={() => {
                  const intent = leave;
                  void protect(intent.next, intent.closeId, true);
                }}
              >
                {t(locale, 'ui.discardEdits')}
              </button>
              <button
                onClick={() => {
                  if (leave.closeId)
                    void api.respondToClose({ requestId: leave.closeId, decision: 'cancel' });
                  setLeave(null);
                }}
              >
                {t(locale, 'ui.keepWorking')}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </LocaleContext.Provider>
  );
}
