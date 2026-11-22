import { useEffect, useId, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { AcceptedChangeSummary, AcceptedEvidenceItem } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { bound } from '../state/binding.js';
import { readAcceptedSummary } from '../state/local.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, RefLink, Time, useLocale } from '../ui.js';

export function AcceptedEvidence({
  api,
  session,
  changeId,
  objectId,
  revision,
  onOpen,
}: {
  api: DesktopApi;
  session: SpaceSession;
  changeId: string;
  objectId: string;
  revision: number;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
}) {
  const locale = useLocale(),
    gate = useRef(0);
  const instance = useId();
  const [summary, setSummary] = useState<AcceptedChangeSummary | null>(null),
    [items, setItems] = useState<AcceptedEvidenceItem[]>([]);
  const [next, setNext] = useState<string | null>(null),
    [missing, setMissing] = useState(false),
    [gap, setGap] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null),
    [loading, setLoading] = useState(true);
  const evidenceRead = useRef<number | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false),
    [limited, setLimited] = useState(false);
  async function evidence(cursor?: string) {
    const ticket = gate.current;
    if (evidenceRead.current === ticket) return;
    evidenceRead.current = ticket;
    setEvidenceLoading(true);
    const result = await api
      .readAcceptedChange(
        bound(
          session,
          cursor
            ? { cursor, maxBytes: 65_536 }
            : { changeId, section: 'evidence', maxBytes: 65_536 },
        ),
      )
      .catch(() => null);
    if (ticket !== gate.current) return;
    evidenceRead.current = null;
    setEvidenceLoading(false);
    if (result?.ok && result.value.section === 'evidence') {
      const page = result.value;
      setItems((old) => (cursor ? [...old, ...page.items] : page.items));
      setNext(page.nextCursor);
      setLimited(page.truncated);
      setGap((old) => (cursor ? old || page.unavailableReferences : page.unavailableReferences));
      setError(null);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  async function load() {
    const ticket = ++gate.current;
    setLoading(true);
    setMissing(false);
    setSummary(null);
    setItems([]);
    setNext(null);
    setGap(false);
    setLimited(false);
    const result = await readAcceptedSummary(api, session, changeId, objectId, revision);
    if (ticket !== gate.current) return;
    if (result.ok && result.value) {
      setSummary(result.value);
      setError(null);
      await evidence();
    } else if (result.ok) {
      setMissing(true);
      setError(null);
    } else setError(result.error.code);
    if (ticket === gate.current) setLoading(false);
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
    };
  }, [session.bindingId, changeId]);
  return (
    <section className="accepted-evidence" data-testid={`accepted-evidence-r${revision}`}>
      <h3>{t(locale, 'evidence.title')}</h3>
      <ErrorNotice
        code={error}
        onRetry={() => {
          void load();
        }}
      />
      {missing && <p className="secondary">{t(locale, 'evidence.noAgentDeclaration')}</p>}
      {summary && (
        <>
          <h4>{t(locale, 'proposal.purpose')}</h4>
          <p>{summary.declared.purpose}</p>
          <h4>{t(locale, 'proposal.reason')}</h4>
          <p>{summary.declared.reason}</p>
          <small>
            <Time value={summary.acceptedAt} />
          </small>
          <p className="secondary">{t(locale, 'evidence.notice')}</p>
          {summary.evidenceStatus === 'none-declared' && (
            <p className="secondary">{t(locale, 'source.none')}</p>
          )}
          {items.map((item, index) => (
            <RefLink
              key={`${item.ref.objectId}-${item.ref.revision}-${index}`}
              api={api}
              session={session}
              reference={item.ref}
              summary={item}
              onOpen={onOpen}
              id={`evidence-${instance}-${changeId}-${index}`}
            />
          ))}
          {(gap ||
            summary.evidenceStatus === 'partly-unavailable' ||
            summary.evidenceStatus === 'unavailable') && (
            <p className="attention">{t(locale, 'links.unavailable')}</p>
          )}
          {(next || limited) && <p className="secondary">{t(locale, 'context.limitReached')}</p>}
          {next && (
            <>
              <button
                disabled={evidenceLoading}
                onClick={() => {
                  void evidence(next);
                }}
              >
                {t(locale, 'context.nextPage')}
              </button>
            </>
          )}
        </>
      )}
      {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
    </section>
  );
}
