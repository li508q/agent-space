import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ActivityEntry, ChangeSummary, ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef, PinnedRef } from '../../contracts/schema.js';
import { formatNumber, t } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import { RecentWindow } from '../state/change-discovery.js';
import { ErrorNotice, Modal, RefLink, Time, useLocale } from '../ui.js';

const eventKeys = {
  'object.created': 'activity.objectCreated',
  'object.imported': 'activity.objectImported',
  'object.saved': 'activity.objectSaved',
  'object.archived': 'activity.objectArchived',
  'object.restored': 'activity.objectRestored',
  'object.relinked': 'activity.objectRelinked',
  'object.policy_changed': 'activity.policyChanged',
  'proposal.created': 'activity.proposalCreated',
  'proposal.conflicted': 'activity.proposalConflicted',
  'proposal.applied': 'activity.proposalApplied',
  'proposal.rejected': 'activity.proposalRejected',
  'knowledge.reviewed': 'activity.knowledgeReviewed',
  'grant.created': 'activity.grantCreated',
  'grant.updated': 'activity.grantUpdated',
  'grant.revoked': 'activity.grantRevoked',
  'change.undone': 'activity.changeUndone',
} as const;
function pinKey(reference: Pick<PinnedRef, 'objectId' | 'revision'>) {
  return `${reference.objectId}/${reference.revision}`;
}
export function ActivityPane({
  api,
  session,
  open,
  onClose,
  onOpen,
  onProposal,
  error,
}: {
  api: DesktopApi;
  session: SpaceSession;
  open: boolean;
  onClose: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onProposal: (proposalId: string) => void;
  error: ErrorCode | null;
}) {
  const locale = useLocale();
  const [tab, setTab] = useState<'changes' | 'prepared'>('changes');
  const windows = useMemo(() => {
    const latest = async (field: 'authoritySequence' | 'activitySequence') => {
      const result = await api.status(bound(session, null));
      return result.ok ? { ok: true as const, value: result.value[field] } : result;
    };
    return {
      changes: new RecentWindow<ChangeSummary>(
        () => latest('authoritySequence'),
        (request) => api.changes(bound(session, request)),
        (item) => item.sequence,
      ),
      prepared: new RecentWindow<ActivityEntry>(
        () => latest('activitySequence'),
        (request) => api.activity(bound(session, request)),
        (item) => item.id,
      ),
    };
  }, [api, session.bindingId, session.status.spaceId, session.status.instanceId]);
  const changes = useSyncExternalStore(windows.changes.subscribe, windows.changes.getSnapshot);
  const prepared = useSyncExternalStore(windows.prepared.subscribe, windows.prepared.getSnapshot);
  const pinSummaries = useMemo(
    () => new Map<string, Pick<ObjectSummary, 'ref' | 'title' | 'kind'>>(),
    [api, session.bindingId, session.status.spaceId, session.status.instanceId],
  );
  const retainedPins = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of changes.items)
      if (entry.objectId && entry.afterRevision !== null)
        keys.add(pinKey({ objectId: entry.objectId, revision: entry.afterRevision }));
    for (const entry of prepared.items)
      if (entry.stage === 'prepared')
        for (const delivered of entry.delivered) keys.add(pinKey(delivered.ref));
    return keys;
  }, [changes.items, prepared.items]);
  const summaryOwner = useRef({ summaries: pinSummaries, retainedPins });
  summaryOwner.current = { summaries: pinSummaries, retainedPins };
  const rememberPin = useCallback(
    (summary: Pick<ObjectSummary, 'ref' | 'title' | 'kind'>) => {
      const owner = summaryOwner.current,
        key = pinKey(summary.ref);
      if (owner.summaries === pinSummaries && owner.retainedPins.has(key))
        pinSummaries.set(key, summary);
    },
    [pinSummaries],
  );
  useEffect(() => {
    for (const key of pinSummaries.keys()) if (!retainedPins.has(key)) pinSummaries.delete(key);
  }, [pinSummaries, retainedPins]);
  const page = tab === 'changes' ? changes : prepared;
  const selected = windows[tab];
  const positions = useRef({ changes: { top: 0, trigger: '' }, prepared: { top: 0, trigger: '' } });
  function remember(trigger = '') {
    positions.current[tab] = {
      top: document.querySelector('[data-testid="activity-pane"]')?.scrollTop ?? 0,
      trigger,
    };
  }
  function read(reference: ObjectRef, trigger?: string) {
    remember(trigger);
    onOpen(reference, trigger);
  }
  useEffect(() => {
    windows.changes.activate();
    windows.prepared.activate();
    return () => {
      windows.changes.dispose();
      windows.prepared.dispose();
    };
  }, [windows]);
  useEffect(() => {
    windows.changes.suspend();
    windows.prepared.suspend();
    if (!open) return;
    if (selected.getSnapshot().lower === null) void selected.load();
    const frame = requestAnimationFrame(() => {
      const scroll = document.querySelector('[data-testid="activity-pane"]');
      if (scroll) scroll.scrollTop = positions.current[tab].top;
      if (positions.current[tab].trigger)
        document.getElementById(positions.current[tab].trigger)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      selected.suspend();
    };
  }, [open, tab, windows]);
  if (!open) return null;
  const entries = prepared.items.filter((entry) => entry.stage === 'prepared');
  const count = tab === 'changes' ? changes.items.length : entries.length;
  return (
    <Modal
      title={t(locale, 'ui.activity')}
      onClose={() => {
        remember();
        onClose();
      }}
      testId="activity-pane"
    >
      <div
        className="as-actions discovery-controls"
        role="group"
        aria-label={t(locale, 'ui.activity')}
      >
        {(['changes', 'prepared'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={tab === value}
            data-testid={`activity-${value}`}
            onClick={() => {
              remember();
              setTab(value);
            }}
          >
            {t(locale, value === 'changes' ? 'activity.changes' : 'activity.prepared')}
          </button>
        ))}
        <button
          onClick={() => {
            positions.current[tab] = { top: 0, trigger: '' };
            void selected.refresh();
          }}
          data-testid="activity-refresh"
        >
          {t(locale, 'activity.refresh')}
        </button>
      </div>
      {tab === 'prepared' && <p className="secondary">{t(locale, 'agent.deliveryNotice')}</p>}
      <p className="secondary">{t(locale, 'activity.loaded', { count })}</p>
      <ErrorNotice code={error} />
      {page.error && page.upper !== null && (
        <p className="attention">{t(locale, 'activity.retained')}</p>
      )}
      <ErrorNotice
        code={page.error}
        onRetry={() => {
          void selected.retry();
        }}
      />
      {page.loading && <p role="status">{t(locale, 'ui.loading')}</p>}
      {!page.loading && !page.error && count === 0 && (
        <p>{t(locale, tab === 'changes' ? 'activity.emptyChanges' : 'activity.emptyPrepared')}</p>
      )}
      {tab === 'changes'
        ? changes.items.map((entry) => (
            <section
              className="activity-record"
              key={entry.id}
              data-testid={`change-row-${entry.id}`}
              data-sequence={entry.sequence}
            >
              <h3>
                {Object.hasOwn(eventKeys, entry.action)
                  ? t(locale, eventKeys[entry.action as keyof typeof eventKeys])
                  : entry.action}
              </h3>
              <div className="as-actions secondary">
                <span>
                  {t(locale, entry.actor.kind === 'human' ? 'activity.human' : 'ui.agent')}
                </span>
                <Time value={entry.recordedAt} />
              </div>
              {entry.objectId && entry.afterRevision !== null && (
                <div className="discovery-version">
                  <small>{t(locale, 'activity.savedVersion')}</small>
                  <RefLink
                    api={api}
                    session={session}
                    reference={{
                      mode: 'pinned',
                      objectId: entry.objectId,
                      revision: entry.afterRevision,
                    }}
                    onOpen={read}
                    id={`change-version-${entry.id}`}
                    summary={pinSummaries.get(
                      pinKey({ objectId: entry.objectId, revision: entry.afterRevision }),
                    )}
                    onResolved={rememberPin}
                  />
                  <button
                    onClick={() =>
                      read(
                        { mode: 'current', objectId: entry.objectId! },
                        `change-current-${entry.id}`,
                      )
                    }
                    id={`change-current-${entry.id}`}
                  >
                    {t(locale, 'activity.current')}
                  </button>
                </div>
              )}
              {entry.proposalId && (
                <button
                  id={`change-proposal-${entry.id}`}
                  data-testid={`change-proposal-${entry.id}`}
                  onClick={() => {
                    remember(`change-proposal-${entry.id}`);
                    onProposal(entry.proposalId!);
                  }}
                >
                  {t(locale, 'activity.openProposal')}
                </button>
              )}
              <details className="technical">
                <summary>{t(locale, 'common.technicalDetails')}</summary>
                <p className="as-wrap">
                  {entry.action} · {formatNumber(locale, entry.sequence)}
                  <br />
                  {entry.id}
                  <br />
                  {entry.actor.namespace}
                </p>
              </details>
            </section>
          ))
        : entries.map((entry) => (
            <section className="activity-record" key={entry.id}>
              <h3>{t(locale, 'ui.preparedRecord', { id: entry.id })}</h3>
              <div className="as-actions">
                <code>{entry.tool}</code>
                <span>
                  {t(locale, entry.actor.kind === 'human' ? 'activity.human' : 'ui.agent')}
                </span>
                <small>
                  <Time value={entry.recordedAt} />
                </small>
              </div>
              {entry.delivered.map((delivered, index) => (
                <div className="delivered-reference" key={index}>
                  <RefLink
                    api={api}
                    session={session}
                    reference={delivered.ref}
                    onOpen={read}
                    id={`prepared-${entry.id}-${index}`}
                    summary={pinSummaries.get(pinKey(delivered.ref))}
                    onResolved={rememberPin}
                  />
                  {delivered.section ? (
                    <small>
                      {t(
                        locale,
                        delivered.section === 'body'
                          ? 'diff.body'
                          : delivered.section === 'properties'
                            ? 'diff.properties'
                            : delivered.section === 'relations'
                              ? 'diff.relations'
                              : 'common.details',
                      )}
                    </small>
                  ) : (
                    <p className="secondary">{t(locale, 'ui.referenceOnly')}</p>
                  )}
                  {delivered.range && (
                    <small>
                      {t(locale, 'ui.preparedRange', {
                        start: formatNumber(locale, delivered.range.start),
                        end: formatNumber(locale, delivered.range.endExclusive),
                        total: formatNumber(locale, delivered.range.total),
                        unit: t(
                          locale,
                          delivered.range.unit === 'entries' ? 'ui.entries' : 'ui.codePoints',
                        ),
                      })}
                    </small>
                  )}
                </div>
              ))}
            </section>
          ))}
      {(page.nextAfter !== null || (page.lower !== null && page.lower > 0)) && (
        <button
          disabled={page.loading}
          onClick={() => {
            void selected.earlier();
          }}
          data-testid="activity-earlier"
        >
          {t(locale, 'ui.older')}
        </button>
      )}
    </Modal>
  );
}
