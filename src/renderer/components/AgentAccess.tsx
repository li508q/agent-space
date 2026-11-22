import { useEffect, useRef, useState } from 'react';
import type { AgentLaunchConfiguration, DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { GrantSpec, GrantSummary, IssuedGrant, ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { formatCount, t, titleText } from '../i18n/index.js';
import { ErrorNotice, newKey, useLocale, useTaskFactory } from '../ui.js';

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
}: {
  api: DesktopApi;
  session: SpaceSession;
  onGrants: (grants: GrantSummary[]) => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const [grants, setGrants] = useState<GrantSummary[]>([]),
    [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'space' | 'objects'>('objects');
  const [ids, setIds] = useState<string[]>([]);
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
  const revokeTasks = useRef(new Map<string, OperationTask<GrantSummary>>());
  const live = useRef(true),
    objectsEpoch = useRef(0);
  useEffect(() => {
    live.current = true;
    void refresh();
    void loadObjects();
    return () => {
      live.current = false;
      objectsEpoch.current++;
    };
  }, [session.bindingId]);
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
      if (!live.current || ticket !== objectsEpoch.current) return;
      if (result.ok) {
        setObjects((old) => (next ? [...old, ...result.value.items] : result.value.items));
        setCursor(result.value.nextCursor);
      } else {
        setError(result.error.code);
        if (result.error.code === 'CURSOR_STALE') setCursor(null);
      }
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
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
    if (!value.token) {
      setConfig(null);
      return;
    }
    const result = await api.agentConfiguration(
      bound(session, { grantId: value.grant.id, token: value.token }),
    );
    if (!live.current) return;
    if (result.ok) setConfig(result.value);
    else setError(result.error.code);
  }
  async function issue(spec?: GrantSpec) {
    if (!issueTask.current || issueTask.current.settled) {
      const input = { operationKey: newKey('grant'), spec: structuredClone(spec ?? currentSpec()) };
      issueTask.current = makeTask(input.operationKey, () =>
        api.createGrant(bound(session, input)),
      );
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await issueTask.current.run();
      if (!live.current) return;
      if (!result.ok) setError(result.error.code);
      else {
        setIssued(result.value);
        await configuration(result.value);
        await refresh();
      }
    } catch {
      if (live.current) setError('OPERATION_UNKNOWN');
    } finally {
      if (live.current) setBusy(false);
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
        if (issued?.grant.id === grant.id) {
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
    setBusy(true);
    setError(null);
    const previousSpec = specFrom(grant);
    if (grant.revoked || (await revoke(grant))) {
      issueTask.current = null;
      await issue(previousSpec);
    }
    if (live.current) setBusy(false);
  }
  async function copy(text: string) {
    try {
      const result = await api.copyText({ text });
      if (result.ok) setCopied(true);
      else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    }
  }
  const valid =
    label.trim().length > 0 &&
    read &&
    (scope === 'space' || ids.length > 0) &&
    (!creation || createKinds.length > 0);
  return (
    <section className="agent-access" data-testid="agent-access">
      <h3>{t(locale, 'agent.setup')}</h3>
      <p className="secondary">{t(locale, 'agent.proposalOnly')}</p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          if (issueTask.current?.unknown) void issue();
          else if (issued?.token && !config)
            void configuration(issued).catch(() => setError('OPERATION_UNKNOWN'));
          else void refresh();
        }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void issue();
        }}
      >
        <label>
          {t(locale, 'access.label')}
          <input
            value={label}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
            required
            data-testid="grant-label"
          />
        </label>
        <fieldset>
          <legend>{t(locale, 'access.scope')}</legend>
          <label className="check-label">
            <input
              type="radio"
              name="scope"
              checked={scope === 'objects'}
              onChange={() => {
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
              onChange={() => setScope('space')}
            />
            {t(locale, 'access.space')}
          </label>
        </fieldset>
        {scope === 'objects' && (
          <fieldset>
            <legend>{t(locale, 'access.selectObjects')}</legend>
            <p className="secondary">{t(locale, 'access.objectsNotice')}</p>
            <div className="grant-objects">
              {objects.map((object) => (
                <label className="check-label" key={object.ref.objectId}>
                  <input
                    type="checkbox"
                    checked={ids.includes(object.ref.objectId)}
                    onChange={(event) =>
                      setIds((old) =>
                        event.target.checked
                          ? [...old, object.ref.objectId]
                          : old.filter((id) => id !== object.ref.objectId),
                      )
                    }
                  />
                  {titleText(locale, object.title, object.kind)}
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
        <fieldset>
          <legend>{t(locale, 'agent.readScope')}</legend>
          <label className="check-label">
            <input
              type="checkbox"
              checked={read}
              onChange={(event) => {
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
              onChange={(event) => setCreation(event.target.checked)}
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
                    onChange={(event) =>
                      setCreateKinds((old) =>
                        event.target.checked
                          ? [...old, kind]
                          : old.filter((entry) => entry !== kind),
                      )
                    }
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
          disabled={!valid || busy}
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
                disabled={busy}
              >
                {t(locale, 'access.reissue')}
              </button>
            </>
          ) : (
            <>
              <p className="attention">{t(locale, 'access.once')}</p>
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
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void revoke(grant).finally(() => {
                      if (live.current) setBusy(false);
                    });
                  }}
                >
                  {t(locale, 'access.revoke')}
                </button>
              )}
              <button
                disabled={busy}
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
}
