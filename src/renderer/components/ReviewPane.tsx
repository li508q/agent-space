import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { GrantSummary, ProposalView, ReviewResult } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef, ReviewInput } from '../../contracts/schema.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { t, titleText } from '../i18n/index.js';
import {
  ErrorNotice,
  fieldText,
  newKey,
  ObjectMetadata,
  RefLink,
  SafeMarkdown,
  Time,
  useLocale,
  useTaskFactory,
} from '../ui.js';
import { ContentDiff } from './ContentDiff.js';

export function ReviewPane({
  api,
  session,
  proposalId,
  refresh,
  grants,
  onOpen,
  onEdit,
  onDraft,
  onChanged,
  onObserved,
  onReturnActivity,
}: {
  api: DesktopApi;
  session: SpaceSession;
  proposalId: string;
  refresh: number;
  grants: readonly GrantSummary[];
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onEdit: (objectId: string) => void;
  onDraft: (view: ProposalView) => void;
  onChanged: () => void;
  onObserved: (view: ProposalView) => void;
  onReturnActivity?: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const [view, setView] = useState<ProposalView | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<ReviewResult | null>(null);
  const [retry, setRetry] = useState(0);
  const task = useRef<{ task: OperationTask<ReviewResult>; decision: 'accept' | 'reject' } | null>(
    null,
  );
  const readEpoch = useRef(0);
  const identity = useRef(proposalId);
  identity.current = proposalId;
  useEffect(() => {
    let active = true;
    const ticket = ++readEpoch.current;
    const currentRead = () => active && ticket === readEpoch.current;
    setLoading(true);
    void api
      .getProposal(bound(session, { proposalId }))
      .then((result) => {
        if (!currentRead()) return;
        if (result.ok) {
          setView((previous) => {
            const incoming = result.value;
            if (previous?.proposal.id !== incoming.proposal.id) return incoming;
            // A read begun before a real decision cannot revive pending actions.
            if (previous.proposal.statusVersion > incoming.proposal.statusVersion) return previous;
            // Proposal status and the current target advance independently.
            const current =
              previous.current &&
              (!incoming.current || previous.current.revision > incoming.current.revision)
                ? previous.current
                : incoming.current;
            return { ...incoming, current };
          });
          onObserved(result.value);
          setError(null);
          if (!result.value.seen)
            void api.markProposalSeen(bound(session, { proposalId, seen: true })).then((seen) => {
              if (currentRead() && seen.ok) onChanged();
            });
        } else setError(result.error.code);
      })
      .catch(() => {
        if (currentRead()) setError('OPERATION_UNKNOWN');
      })
      .finally(() => {
        if (currentRead()) setLoading(false);
      });
    return () => {
      active = false;
      readEpoch.current++;
    };
  }, [api, session.bindingId, proposalId, refresh, retry]);
  useEffect(() => {
    document.getElementById('proposal-heading')?.focus();
  }, [proposalId]);

  async function decide(decision: 'accept' | 'reject') {
    if (!view) return;
    // Invalidate reads synchronously, before React cleanup or the Core decision.
    readEpoch.current++;
    setLoading(false);
    const selected = proposalId;
    if (!task.current || task.current.task.settled) {
      const shared = {
        operationKey: newKey('review'),
        proposalId: view.proposal.id,
        expectedProposalVersion: view.proposal.statusVersion,
        expectedPayloadHash: view.proposal.payloadHash,
      };
      const input: ReviewInput =
        decision === 'reject'
          ? { ...shared, decision }
          : {
              ...shared,
              decision,
              expectedTarget:
                view.proposal.action === 'create'
                  ? { state: 'absent' }
                  : {
                      state: 'revision',
                      revision: view.current?.revision ?? view.proposal.baseRevision!,
                    },
            };
      task.current = {
        decision,
        task: makeTask(input.operationKey, () => api.reviewProposal(bound(session, input))),
      };
    }
    // An unknown earlier decision is checked before a different decision is allowed.
    if (task.current.decision !== decision) return;
    setBusy(true);
    setError(null);
    try {
      const result = await task.current.task.run();
      if (identity.current !== selected) return;
      readEpoch.current++;
      setLoading(false);
      if (!result.ok) setError(result.error.code);
      else {
        setOutcome(result.value);
        setView((previous) =>
          previous
            ? {
                ...previous,
                proposal:
                  result.value.proposal.statusVersion >= previous.proposal.statusVersion
                    ? result.value.proposal
                    : previous.proposal,
                current:
                  result.value.object &&
                  (!previous.current || result.value.object.revision >= previous.current.revision)
                    ? result.value.object
                    : previous.current,
              }
            : previous,
        );
        onChanged();
      }
    } catch {
      if (identity.current === selected) {
        readEpoch.current++;
        setLoading(false);
        setError('OPERATION_UNKNOWN');
      }
    } finally {
      if (identity.current === selected) setBusy(false);
    }
  }
  if (!view)
    return (
      <section className="empty-pane">
        <ErrorNotice code={error} onRetry={() => setRetry((value) => value + 1)} />
        {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
      </section>
    );
  const proposal = view.proposal;
  const grantLabel = grants.find((grant) => grant.id === proposal.grantId)?.label;
  const unresolved = proposal.status === 'pending' || proposal.status === 'conflicted';
  const stale =
    proposal.action === 'update' &&
    (!view.current || view.current.revision !== proposal.baseRevision);
  const statusKeys = {
    pending: 'proposal.pending',
    conflicted: 'proposal.conflicted',
    applied: 'proposal.applied',
    rejected: 'proposal.rejected',
  } as const;
  const label =
    proposal.action === 'create'
      ? t(
          locale,
          proposal.kind === 'record' ? 'proposal.proposedNewRecord' : 'proposal.proposedNewNote',
        )
      : titleText(
          locale,
          view.current?.content.title ?? view.base?.content.title ?? '',
          proposal.kind,
        );
  async function copy() {
    const content = view!.proposedContent;
    const text = [
      content.title,
      content.body,
      ...Object.values(content.properties).map(
        (field) => `${field.label}: ${fieldText(locale, field)}`,
      ),
      ...content.relations.map(
        (relation) =>
          `${relation.predicate}: ${relation.target.objectId}${relation.target.mode === 'pinned' ? `@${relation.target.revision}` : ''}`,
      ),
    ].join('\n\n');
    try {
      const result = await api.copyText({ text });
      if (result.ok) setCopied(true);
      else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    }
  }
  return (
    <section className="review-pane" data-testid="proposal-review">
      <header className="document-header">
        {onReturnActivity && (
          <button onClick={onReturnActivity} data-testid="return-activity">
            {t(locale, 'activity.return')}
          </button>
        )}
        <div className="as-actions">
          <small>{t(locale, 'review.currentStatus')}</small>
          <span className={`status-tag ${proposal.status}`}>
            {t(locale, statusKeys[proposal.status])}
          </span>
          <span data-testid="proposal-agent-label">{grantLabel ?? t(locale, 'ui.agent')}</span>
          <small>
            <Time value={proposal.createdAt} />
          </small>
        </div>
        <h1 id="proposal-heading" tabIndex={-1}>
          {proposal.payload.purpose}
        </h1>
        <p className="review-target">
          {t(locale, 'proposal.target')}: <strong>{label}</strong>
        </p>
        <p className="secondary">
          {t(
            locale,
            proposal.status === 'applied'
              ? proposal.action === 'create'
                ? proposal.kind === 'record'
                  ? 'proposal.recordCreated'
                  : 'proposal.noteCreated'
                : 'proposal.applied'
              : proposal.status === 'rejected'
                ? 'proposal.rejected'
                : proposal.action === 'create'
                  ? 'proposal.notCreated'
                  : 'proposal.currentUnchanged',
          )}
        </p>
        {stale && unresolved && (
          <p className="attention" role="status">
            {t(locale, 'proposal.originalChanged')}
          </p>
        )}
        <ErrorNotice
          code={error}
          onRetry={() => {
            if (task.current?.task.unknown) void decide(task.current.decision);
            else setRetry((value) => value + 1);
          }}
        />
        {outcome?.outcome === 'conflicted' && (
          <p className="attention">{t(locale, 'proposal.originalChanged')}</p>
        )}
        {proposal.status === 'applied' && proposal.resultRevision !== null && (
          <div className="as-actions">
            <button
              data-testid="open-proposal-saved-version"
              id={`proposal-result-${proposal.id}`}
              onClick={() =>
                onOpen(
                  {
                    mode: 'pinned',
                    objectId: proposal.targetId,
                    revision: proposal.resultRevision!,
                  },
                  `proposal-result-${proposal.id}`,
                )
              }
            >
              {t(locale, 'review.savedResult', { version: proposal.resultRevision })}
            </button>
            {view.current && (
              <button data-testid="open-proposal-result" onClick={() => onEdit(view.current!.id)}>
                {t(locale, 'proposal.editCurrent')}
              </button>
            )}
          </div>
        )}
        {proposal.status === 'rejected' && (
          <p className="secondary">{t(locale, 'review.rejectedNotice')}</p>
        )}
      </header>
      <div className="review-scroll as-scroll-region">
        <section className="proposal-reason">
          <h2>{t(locale, 'review.originalReason')}</h2>
          <p>{proposal.payload.reason}</p>
        </section>
        <section className="proposal-sources">
          <h2>{t(locale, 'source.sources')}</h2>
          {proposal.payload.sources.length ? (
            proposal.payload.sources.map((reference, index) => (
              <RefLink
                key={`${reference.objectId}-${reference.revision}-${index}`}
                api={api}
                session={session}
                reference={reference}
                onOpen={onOpen}
                id={`proposal-source-${proposal.id}-${index}`}
              />
            ))
          ) : (
            <p className="secondary">{t(locale, 'source.none')}</p>
          )}
        </section>
        <ContentDiff
          before={view.base?.content ?? null}
          after={view.proposedContent}
          api={api}
          session={session}
          onOpen={onOpen}
        />
        {view.current && (
          <details className="current-content" open={stale}>
            <summary>
              {t(locale, 'diff.current')} ·{' '}
              {t(locale, 'source.version', { version: view.current.revision })}
            </summary>
            <article className="as-prose">
              <SafeMarkdown text={view.current.content.body} api={api} />
            </article>
            <ObjectMetadata
              content={view.current.content}
              api={api}
              session={session}
              onOpen={onOpen}
            />
          </details>
        )}
        <details className="technical">
          <summary>{t(locale, 'common.technicalDetails')}</summary>
          <dl>
            <dt>{t(locale, 'proposal.title')}</dt>
            <dd className="as-wrap">{proposal.id}</dd>
            <dt>{t(locale, 'source.citedVersion')}</dt>
            <dd>{proposal.baseRevision ?? '—'}</dd>
            <dt>{t(locale, 'ui.status')}</dt>
            <dd>{t(locale, statusKeys[proposal.status])}</dd>
          </dl>
        </details>
      </div>
      <footer className="review-actions as-actions">
        {unresolved && (
          <button
            onClick={() => {
              void decide('reject');
            }}
            disabled={busy || (!!task.current?.task.unknown && task.current.decision !== 'reject')}
            data-testid="reject-proposal"
          >
            <X size={16} />
            {t(locale, 'proposal.reject')}
          </button>
        )}
        <button
          onClick={() => {
            void copy();
          }}
        >
          {t(locale, 'proposal.copyProposed')}
        </button>
        {copied && <span role="status">{t(locale, 'common.copied')}</span>}
        {unresolved &&
          (proposal.action === 'update' && view.current ? (
            <button onClick={() => onEdit(view.current!.id)}>
              {t(locale, 'proposal.editCurrent')}
            </button>
          ) : (
            <button onClick={() => onDraft(view)}>{t(locale, 'ui.newDraft')}</button>
          ))}
        {unresolved && (
          <button
            className="primary push"
            data-testid="accept-proposal"
            disabled={
              busy || stale || (!!task.current?.task.unknown && task.current.decision !== 'accept')
            }
            onClick={() => {
              void decide('accept');
            }}
          >
            <Check size={16} />
            {busy
              ? t(locale, 'proposal.applying')
              : t(
                  locale,
                  proposal.action === 'create'
                    ? proposal.kind === 'record'
                      ? 'proposal.createRecord'
                      : 'proposal.createNote'
                    : 'proposal.apply',
                )}
          </button>
        )}
      </footer>
    </section>
  );
}
