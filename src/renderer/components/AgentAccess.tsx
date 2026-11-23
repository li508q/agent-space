import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentLaunchConfiguration, DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { GrantSpec, GrantSummary, IssuedGrant, ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import type { AccessDraft, AccessObject } from '../state/collaboration.js';
import { formatCount, t, titleText } from '../i18n/index.js';
import { ErrorNotice, newKey, useLocale, useTaskFactory } from '../ui.js';
import { revealContextChoice } from './ContextPreparation.js';

function specFrom(grant: GrantSummary): GrantSpec {
  return {
    label: grant.label,
    scope: grant.scope,
    capabilities: grant.capabilities,
    creation: grant.creation,
  };
}

export function AgentAccess({
  api,
  session,
  onGrants,
  active = true,
  draft,
  onCloseBlocked,
  children,
}: {
  api: DesktopApi;
  session: SpaceSession;
  onGrants: (grants: GrantSummary[]) => void;
  active?: boolean;
  draft?: AccessDraft | null;
  onCloseBlocked?: (blocked: boolean) => void;
  children?: (content: ReactNode) => ReactNode;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const [grants, setGrants] = useState<GrantSummary[]>([]),
    [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'space' | 'objects'>('objects');
  const [ids, setIds] = useState<string[]>([]);
  const [preparedObjects, setPreparedObjects] = useState<AccessObject[]>([]),
    [pendingDraft, setPendingDraft] = useState<AccessDraft | null>(null);
  const initializedDraft = useRef<string | null>(null),
    touched = useRef(false);
  const [read, setRead] = useState(true),
    [propose, setPropose] = useState(true),
    [creation, setCreation] = useState(false);
  const [createKinds, setCreateKinds] = useState<('document' | 'record')[]>(['document']);
  const [issued, setIssued] = useState<IssuedGrant | null>(null),
    [config, setConfig] = useState<AgentLaunchConfiguration | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const issueTask = useRef<OperationTask<IssuedGrant> | null>(null);
  const issuedIdentity = useRef<IssuedGrant | null>(null),
    configurationEpoch = useRef(0);
  const revokeTasks = useRef(new Map<string, OperationTask<GrantSummary>>());
  const live = useRef(true),
    objectsEpoch = useRef(0),
    copyEpoch = useRef(0),
    visible = useRef(active),
    pendingOperations = useRef(0);
  visible.current = active;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      objectsEpoch.current++;
      copyEpoch.current++;
      configurationEpoch.current++;
    };
  }, [session.bindingId]);
  useEffect(() => {
    if (active) {
      void refresh();
      void loadObjects();
    } else {
      objectsEpoch.current++;
      copyEpoch.current++;
    }
  }, [session.bindingId, active]);
  useEffect(() => {
    if (!active || !draft || initializedDraft.current === draft.id) return;
    if (!touched.current && !issued && !issueTask.current) applyPrepared(draft);
    else setPendingDraft(draft);
  }, [active, draft?.id]);
  function accessUnresolved() {
    return (
      pendingOperations.current > 0 ||
      !!issueTask.current?.unknown ||
      !!issueTask.current?.isPending ||
      [...revokeTasks.current.values()].some((task) => task.unknown || task.isPending)
    );
  }
  const closeBlocked = busy || accessUnresolved();
  useEffect(() => {
    if (live.current) onCloseBlocked?.(accessUnresolved());
  }, [closeBlocked, onCloseBlocked]);
  function beginOperation() {
    pendingOperations.current++;
    configurationEpoch.current++;
    copyEpoch.current++;
    setCopied(false);
    onCloseBlocked?.(true);
    setBusy(true);
  }
  function finishOperation() {
    pendingOperations.current = Math.max(0, pendingOperations.current - 1);
    if (!live.current) return;
    setBusy(pendingOperations.current > 0);
    onCloseBlocked?.(accessUnresolved());
  }
  function applyPrepared(value: AccessDraft) {
    initializedDraft.current = value.id;
    setPreparedObjects(value.objects);
    setIds(value.objects.map((object) => object.id));
    setScope('objects');
    setCreation(false);
    setPendingDraft(null);
  }
  async function refresh() {
    try {
      const result = await api.listGrants(bound(session, null));
      if (!live.current) return;
      if (result.ok) {
        setGrants(result.value);
        onGrants(result.value);
      } else setError(result.error.code);
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
    }
  }
  async function loadObjects(next?: string) {
    const ticket = ++objectsEpoch.current;
    try {
      const result = await api.query(
        bound(session, {
          filter: {},
          limit: 50,
          maxBytes: 65_536,
          ...(next ? { cursor: next } : {}),
        }),
      );
      if (!live.current || !visible.current || ticket !== objectsEpoch.current) return;
      if (result.ok) {
        setObjects((old) => (next ? [...old, ...result.value.items] : result.value.items));
        setCursor(result.value.nextCursor);
      } else {
        setError(result.error.code);
        if (result.error.code === 'CURSOR_STALE') setCursor(null);
      }
    } catch {
      if (live.current && visible.current && ticket === objectsEpoch.current)
        setError('OPERATION_UNKNOWN');
    }
  }
  function currentSpec(): GrantSpec {
    return {
      label,
      scope: scope === 'space' ? { mode: 'space' } : { mode: 'objects', objectIds: [...ids] },
      capabilities: { read, propose },
      creation: { enabled: scope === 'space' && propose && creation, kinds: [...createKinds] },
    };
  }
  async function configuration(value: IssuedGrant) {
    const ticket = ++configurationEpoch.current,
      current = () =>
        live.current && ticket === configurationEpoch.current && issuedIdentity.current === value;
    if (!value.token) {
      if (current()) {
        copyEpoch.current++;
        setCopied(false);
        setConfig(null);
      }
      return;
    }
    try {
      const result = await api.agentConfiguration(
        bound(session, { grantId: value.grant.id, token: value.token }),
      );
      if (!current()) return;
      if (result.ok) {
        copyEpoch.current++;
        setCopied(false);
        setConfig(result.value);
      } else setError(result.error.code);
    } catch {
      if (current()) setError('OPERATION_UNKNOWN');
    }
  }
  async function issue(spec?: GrantSpec) {
    if (!issueTask.current || issueTask.current.settled) {
      const input = { operationKey: newKey('grant'), spec: structuredClone(spec ?? currentSpec()) };
      issueTask.current = makeTask(input.operationKey, () =>
        api.createGrant(bound(session, input)),
      );
    }
    beginOperation();
    setError(null);
    setCopied(false);
    try {
      const result = await issueTask.current.run();
      if (!live.current) return;
      if (!result.ok) setError(result.error.code);
      else {
        issuedIdentity.current = result.value;
        setIssued(result.value);
        setConfig(null);
        await configuration(result.value);
        await refresh();
      }
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
    } finally {
      finishOperation();
    }
  }
  async function revoke(grant: GrantSummary): Promise<boolean> {
    let task = revokeTasks.current.get(grant.id);
    if (!task || (task.settled && !grant.revoked)) {
      const input = {
        operationKey: newKey('revoke'),
        grantId: grant.id,
        expectedGeneration: grant.generation,
        spec: specFrom(grant),
        revoked: true,
      };
      task = makeTask(input.operationKey, () => api.updateGrant(bound(session, input)));
      revokeTasks.current.set(grant.id, task);
    }
    try {
      const result = await task.run();
      if (!result.ok) {
        if (live.current) setError(result.error.code);
        return false;
      }
      if (live.current) {
        if (issuedIdentity.current?.grant.id === grant.id) {
          issuedIdentity.current = null;
          configurationEpoch.current++;
          copyEpoch.current++;
          setCopied(false);
          setIssued(null);
          setConfig(null);
        }
        await refresh();
      }
      return result.value.revoked;
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
      return false;
    }
  }
  async function reissue(grant: GrantSummary) {
    beginOperation();
    setError(null);
    try {
      const previousSpec = specFrom(grant);
      if (grant.revoked || (await revoke(grant))) {
        issueTask.current = null;
        await issue(previousSpec);
      }
    } finally {
      finishOperation();
    }
  }
  async function copy(text: string) {
    const ticket = ++copyEpoch.current,
      identity = issuedIdentity.current;
    const current = () =>
      live.current &&
      visible.current &&
      ticket === copyEpoch.current &&
      identity === issuedIdentity.current;
    try {
      const result = await api.copyText({ text });
      if (!current()) return;
      if (result.ok) setCopied(true);
      else setError(result.error.code);
    } catch {
      if (current()) setError('OPERATION_UNKNOWN');
    }
  }
  const valid =
    label.trim().length > 0 &&
    read &&
    (scope === 'space' || ids.length > 0) &&
    (!creation || createKinds.length > 0);
  const displayObjects: AccessObject[] = [
    ...preparedObjects,
    ...objects
      .filter((object) => !preparedObjects.some((prepared) => prepared.id === object.ref.objectId))
      .map((object) => ({ id: object.ref.objectId, title: object.title, kind: object.kind })),
  ];
  const content = (
    <section className="agent-access" data-testid="agent-access">
      <h3 id="agent-access-heading" tabIndex={-1}>
        {t(locale, 'agent.setup')}
      </h3>
      <p className="secondary">{t(locale, 'agent.proposalOnly')}</p>
      <p className="secondary">{t(locale, 'contextPrep.objectAccess')}</p>
      {closeBlocked && <p role="status">{t(locale, 'contextPrep.finishAccess')}</p>}
      <ErrorNotice
        code={error}
        onRetry={() => {
          if (issueTask.current?.unknown) void issue();
          else if ([...revokeTasks.current.values()].some((task) => task.unknown)) {
            const grant = grants.find((value) => revokeTasks.current.get(value.id)?.unknown);
            if (grant) {
              beginOperation();
              void revoke(grant).finally(() => {
                finishOperation();
              });
            }
          } else if (issued?.token && !config) void configuration(issued);
          else void refresh();
        }}
      />
      {pendingDraft && (
        <div>
          <p>{t(locale, 'contextPrep.pendingAccess')}</p>
          <button
            type="button"
            data-testid="use-prepared-access"
            disabled={closeBlocked}
            onClick={() => {
              touched.current = true;
              applyPrepared(pendingDraft);
            }}
          >
            {t(locale, 'contextPrep.usePrepared')}
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!closeBlocked) void issue();
        }}
      >
        <label>
          {t(locale, 'access.label')}
          <input
            value={label}
            maxLength={120}
            disabled={closeBlocked}
            onChange={(event) => {
              touched.current = true;
              setLabel(event.target.value);
            }}
            required
            data-testid="grant-label"
          />
        </label>
        <fieldset disabled={closeBlocked}>
          <legend>{t(locale, 'access.scope')}</legend>
          <label className="check-label">
            <input
              type="radio"
              name="scope"
              checked={scope === 'objects'}
              onChange={() => {
                touched.current = true;
                setScope('objects');
                setCreation(false);
              }}
            />
            {t(locale, 'access.objects')}
          </label>
          <label className="check-label">
            <input
              type="radio"
              name="scope"
              checked={scope === 'space'}
              onChange={() => {
                touched.current = true;
                setScope('space');
              }}
            />
            {t(locale, 'access.space')}
          </label>
        </fieldset>
        {scope === 'objects' && (
          <fieldset disabled={closeBlocked}>
            <legend>{t(locale, 'access.selectObjects')}</legend>
            <p className="secondary">{t(locale, 'access.objectsNotice')}</p>
            <div className="grant-objects context-object-flow">
              {displayObjects.map((object) => (
                <label className="check-label context-choice" key={object.id}>
                  <input
                    type="checkbox"
                    data-testid={`access-object-${object.id}`}
                    checked={ids.includes(object.id)}
                    onFocus={(event) => revealContextChoice(event.currentTarget)}
                    onChange={(event) => {
                      touched.current = true;
                      setIds((old) =>
                        event.target.checked
                          ? [...old, object.id]
                          : old.filter((id) => id !== object.id),
                      );
                    }}
                  />
                  <span>{titleText(locale, object.title, object.kind)}</span>
                </label>
              ))}
            </div>
            <small>{formatCount(locale, 'items', ids.length)}</small>
            {cursor && (
              <button
                type="button"
                onClick={() => {
                  void loadObjects(cursor);
                }}
              >
                {t(locale, 'ui.moreResults')}
              </button>
            )}
          </fieldset>
        )}
        <fieldset disabled={closeBlocked}>
          <legend>{t(locale, 'agent.readScope')}</legend>
          <label className="check-label">
            <input
              type="checkbox"
              checked={read}
              onChange={(event) => {
                touched.current = true;
                setRead(event.target.checked);
                if (!event.target.checked) {
                  setPropose(false);
                  setCreation(false);
                }
              }}
            />
            {t(locale, 'access.read')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={propose}
              onChange={(event) => {
                touched.current = true;
                setPropose(event.target.checked);
                if (event.target.checked) setRead(true);
                else setCreation(false);
              }}
            />
            {t(locale, 'access.propose')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              data-testid="grant-creation"
              checked={creation}
              disabled={scope !== 'space' || !propose}
              onChange={(event) => {
                touched.current = true;
                setCreation(event.target.checked);
              }}
            />
            {t(locale, 'agent.allowCreation')}
          </label>
          <small>{t(locale, 'agent.creationScope')}</small>
          {creation && (
            <fieldset>
              <legend>{t(locale, 'access.creationKinds')}</legend>
              {(['document', 'record'] as const).map((kind) => (
                <label className="check-label" key={kind}>
                  <input
                    type="checkbox"
                    checked={createKinds.includes(kind)}
                    onChange={(event) => {
                      touched.current = true;
                      setCreateKinds((old) =>
                        event.target.checked
                          ? [...old, kind]
                          : old.filter((entry) => entry !== kind),
                      );
                    }}
                  />
                  {t(locale, kind === 'document' ? 'object.note' : 'object.record')}
                </label>
              ))}
            </fieldset>
          )}
        </fieldset>
        <button
          className="primary"
          type="submit"
          disabled={!valid || closeBlocked}
          data-testid="create-grant"
        >
          {t(locale, 'access.create')}
        </button>
      </form>
      {issued && (
        <section className="issued-configuration" data-testid="issued-configuration">
          <h3>{issued.grant.label}</h3>
          {issued.token === null ? (
            <>
              <p className="attention">{t(locale, 'access.tokenLost')}</p>
              <button
                onClick={() => {
                  void reissue(issued.grant);
                }}
                disabled={closeBlocked}
              >
                {t(locale, 'access.reissue')}
              </button>
            </>
          ) : (
            <>
              <p className="attention">{t(locale, 'access.once')}</p>
              <p>{t(locale, 'contextPrep.hostSteps')}</p>
              {config && (
                <>
                  {config.development && (
                    <p className="secondary">{t(locale, 'access.development')}</p>
                  )}
                  <div className="as-actions">
                    <button
                      onClick={() => {
                        void copy(config.codexToml);
                      }}
                      data-testid="copy-codex-config"
                    >
                      {t(locale, 'access.copyToml')}
                    </button>
                    <button
                      onClick={() => {
                        void copy(config.stdioJson);
                      }}
                    >
                      {t(locale, 'access.copyJson')}
                    </button>
                    {copied && <span role="status">{t(locale, 'common.copied')}</span>}
                  </div>
                  <details>
                    <summary>{t(locale, 'common.details')}</summary>
                    <pre className="configuration-text">{config.codexToml}</pre>
                  </details>
                </>
              )}
            </>
          )}
        </section>
      )}
      <section>
        <h3>{t(locale, 'agent.setup')}</h3>
        {!grants.length && <p>{t(locale, 'access.noGrants')}</p>}
        {grants.map((grant) => (
          <div className="grant-row" key={grant.id}>
            <strong>{grant.label}</strong>
            <span className={grant.revoked ? 'secondary' : 'positive'}>
              {t(locale, grant.revoked ? 'access.revoked' : 'agent.entryEnabled')}
            </span>
            <small>
              {grant.scope.mode === 'space'
                ? t(locale, 'access.space')
                : formatCount(locale, 'items', grant.scope.objectIds.length)}{' '}
              · {grant.capabilities.read ? t(locale, 'access.read') : ''}
              {grant.capabilities.propose ? ` · ${t(locale, 'access.propose')}` : ''}
            </small>
            <div className="as-actions">
              {!grant.revoked && (
                <button
                  disabled={closeBlocked}
                  onClick={() => {
                    beginOperation();
                    void revoke(grant).finally(() => {
                      finishOperation();
                    });
                  }}
                >
                  {t(locale, 'access.revoke')}
                </button>
              )}
              <button
                disabled={closeBlocked}
                onClick={() => {
                  void reissue(grant);
                }}
              >
                {t(locale, 'access.reissue')}
              </button>
            </div>
          </div>
        ))}
      </section>
    </section>
  );
  return children ? children(active ? content : null) : active ? content : null;
}
