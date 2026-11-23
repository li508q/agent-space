import { useEffect, useId, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import { t, titleText } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import {
  accessObjects,
  candidatePage,
  checkedReference,
  codepoints,
  contextBrief,
  contextLimits,
  contextReference,
  directCandidates,
  preparationKey,
  referenceKey,
  selectedReferences,
  summaryReference,
  type AccessObject,
  type ContextCandidate,
  type ContextReference,
} from '../state/collaboration.js';
import { ErrorNotice, Modal, useLocale } from '../ui.js';

/** Only these two context selectors reveal their complete focused label. */
export function revealContextChoice(input: HTMLInputElement) {
  if (!input.matches(':focus-visible')) return;
  const label = input.closest('label'),
    dialog = input.closest('dialog');
  if (!label || !dialog) return;
  const rect = label.getBoundingClientRect(),
    control = input.getBoundingClientRect(),
    style = getComputedStyle(input),
    outset = Math.max(
      0,
      (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
    ),
    port = dialog.getBoundingClientRect(),
    border = getComputedStyle(dialog),
    top = port.top + (parseFloat(border.borderTopWidth) || 0),
    bottom = port.bottom - (parseFloat(border.borderBottomWidth) || 0),
    first = Math.min(rect.top, control.top - outset),
    last = Math.max(rect.bottom, control.bottom + outset);
  // An oversized title needs an explicit readable design, not a fabricated fit.
  if (last - first > bottom - top) return;
  if (first < top) dialog.scrollTop += Math.floor(first - top);
  else if (last > bottom) dialog.scrollTop += Math.ceil(last - bottom);
}

export function ContextPreparation({
  api,
  session,
  seed,
  open,
  onClose,
  onAccess,
  onImport,
}: {
  api: DesktopApi;
  session: SpaceSession;
  seed: ObjectSnapshot | null;
  open: boolean;
  onClose: () => void;
  onAccess: (objects: AccessObject[]) => void;
  onImport: () => void;
}) {
  const locale = useLocale(),
    instance = useId(),
    key = seed ? preparationKey(session, seed) : '';
  const scope = useRef(key),
    visible = useRef(open),
    live = useRef(true),
    seedEpoch = useRef(0),
    memberEpoch = useRef(0),
    actionEpoch = useRef(0);
  scope.current = key;
  visible.current = open;
  const [task, setTask] = useState(''),
    [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<ContextReference[]>([]),
    [referenceErrors, setReferenceErrors] = useState<Record<string, ErrorCode>>({});
  const [direct, setDirect] = useState<ContextCandidate[]>([]),
    [directNext, setDirectNext] = useState<number | null>(null);
  const allDirect = useRef<ContextCandidate[]>([]);
  const [seedLoading, setSeedLoading] = useState(false),
    [seedError, setSeedError] = useState<ErrorCode | null>(null);
  const loadedSeed = useRef<string | null>(null);
  const [members, setMembers] = useState<ContextReference[]>([]),
    [memberNext, setMemberNext] = useState<string | null>(null),
    [memberLoading, setMemberLoading] = useState(false),
    [memberError, setMemberError] = useState<ErrorCode | null>(null);
  const memberChain = useRef<{ authority: number; scope: string; cursor: string | null } | null>(
    null,
  );
  const failedMemberCursor = useRef<string | undefined>(undefined);
  const [checking, setChecking] = useState(false),
    [error, setError] = useState<ErrorCode | null>(null),
    [copied, setCopied] = useState(false),
    [limitReached, setLimitReached] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      seedEpoch.current++;
      memberEpoch.current++;
      actionEpoch.current++;
    };
  }, []);
  useEffect(() => {
    seedEpoch.current++;
    memberEpoch.current++;
    actionEpoch.current++;
    loadedSeed.current = null;
    memberChain.current = null;
    allDirect.current = [];
    setTask('');
    setSelected(seed ? [contextReference(seed)] : []);
    setReferenceErrors({});
    setDirect([]);
    setDirectNext(null);
    setMembers([]);
    setMemberNext(null);
    setMemberError(null);
    setSeedError(null);
    setChecking(false);
    setPreview(null);
    setPreviewOpen(false);
    setCopied(false);
    setError(null);
    setLimitReached(false);
  }, [key]);
  useEffect(() => {
    if (!open) {
      seedEpoch.current++;
      memberEpoch.current++;
      actionEpoch.current++;
      setSeedLoading(false);
      setMemberLoading(false);
      setChecking(false);
    } else if (seed && loadedSeed.current !== key) void loadSeed();
    else if (seed?.kind === 'project' && memberChain.current === null) void loadMembers();
  }, [key, open]);

  async function loadSeed() {
    if (!seed || !open) return;
    const ticket = ++seedEpoch.current,
      expectedKey = key,
      current = () =>
        live.current &&
        visible.current &&
        scope.current === expectedKey &&
        ticket === seedEpoch.current;
    setSeedLoading(true);
    setSeedError(null);
    try {
      const result = await api.readObject(
        bound(session, { objectId: seed.id, revision: seed.revision }),
      );
      if (!current()) return;
      if (!result.ok) {
        setSeedError(result.error.code);
        setReferenceErrors((old) => ({
          ...old,
          [referenceKey(contextReference(seed).ref)]: result.error.code,
        }));
        return;
      }
      const checked = checkedReference(session, contextReference(seed), result.value);
      if (checked.error) {
        setSeedError(checked.error);
        setReferenceErrors((old) => ({
          ...old,
          [referenceKey(contextReference(seed).ref)]: checked.error,
        }));
        return;
      }
      loadedSeed.current = expectedKey;
      invalidateSelection();
      allDirect.current = directCandidates(result.value);
      const first = candidatePage(allDirect.current, 0);
      setDirect(first.items);
      setDirectNext(first.next);
      setReferenceErrors((old) => {
        const next = { ...old };
        delete next[referenceKey(contextReference(seed).ref)];
        return next;
      });
      if (seed.kind === 'project' && memberChain.current === null) void loadMembers();
    } catch {
      if (current()) {
        setSeedError('OPERATION_UNKNOWN');
        setReferenceErrors((old) => ({
          ...old,
          [referenceKey(contextReference(seed).ref)]: 'OPERATION_UNKNOWN',
        }));
      }
    } finally {
      if (current()) setSeedLoading(false);
    }
  }
  async function loadMembers(next?: string) {
    if (!seed || seed.kind !== 'project' || !visible.current) return;
    if (next && memberChain.current?.cursor !== next) return;
    const ticket = ++memberEpoch.current,
      expectedKey = key,
      current = () =>
        live.current &&
        visible.current &&
        scope.current === expectedKey &&
        ticket === memberEpoch.current;
    setMemberLoading(true);
    setMemberError(null);
    failedMemberCursor.current = next;
    if (!next) memberChain.current = null;
    try {
      const result = await api.query(
        bound(session, {
          filter: { projectId: seed.id, lifecycle: 'active' },
          limit: contextLimits.references,
          maxBytes: contextLimits.pageBytes,
          ...(next ? { cursor: next } : {}),
        }),
      );
      if (!current()) return;
      if (!result.ok) {
        setMemberError(result.error.code);
        if (result.error.code === 'CURSOR_STALE') {
          invalidateSelection();
          memberChain.current = null;
          setMembers([]);
          setMemberNext(null);
          void loadMembers();
        }
        return;
      }
      const page = result.value;
      if (
        next &&
        (memberChain.current?.authority !== page.authoritySequence ||
          memberChain.current.scope !== page.scope.digest)
      ) {
        invalidateSelection();
        memberChain.current = null;
        setMembers([]);
        setMemberNext(null);
        void loadMembers();
        return;
      }
      const rows = page.items.map(summaryReference);
      invalidateSelection();
      setMembers((old) =>
        next
          ? [
              ...old,
              ...rows.filter(
                (row) => !old.some((item) => referenceKey(item.ref) === referenceKey(row.ref)),
              ),
            ]
          : rows,
      );
      memberChain.current = {
        authority: page.authoritySequence,
        scope: page.scope.digest,
        cursor: page.nextCursor,
      };
      setMemberNext(page.nextCursor);
    } catch {
      if (current()) setMemberError('OPERATION_UNKNOWN');
    } finally {
      if (current()) setMemberLoading(false);
    }
  }
  function invalidateSelection() {
    actionEpoch.current++;
    setChecking(false);
    setPreview(null);
    setCopied(false);
    setError(null);
  }
  function choose(reference: ContextReference, checked: boolean) {
    const next = selectedReferences(selected, reference, checked);
    if (next === null) {
      setLimitReached(true);
      return;
    }
    invalidateSelection();
    setLimitReached(false);
    setSelected(next);
  }
  function changeTask(value: string, isComposing = composing) {
    invalidateSelection();
    setTask(isComposing ? value : codepoints(value, contextLimits.task));
  }
  async function prepare(action: 'preview' | 'copy' | 'access') {
    if (!seed || composing || selected.length === 0 || !open) return;
    const ticket = ++actionEpoch.current,
      expectedKey = key,
      choices = [...selected],
      candidateSnapshot = { direct: [...allDirect.current], members: [...members] },
      current = () =>
        live.current &&
        visible.current &&
        scope.current === expectedKey &&
        ticket === actionEpoch.current;
    setChecking(true);
    setCopied(false);
    setError(null);
    const failures: Record<string, ErrorCode> = {},
      verified: ContextReference[] = [];
    try {
      for (const choice of choices) {
        const result = await api
          .readObject(
            bound(session, {
              objectId: choice.ref.objectId,
              revision: choice.ref.revision,
            }),
          )
          .catch(() => null);
        if (!current()) return;
        const checked = result?.ok ? checkedReference(session, choice, result.value) : null;
        if (checked?.reference) verified.push(checked.reference);
        else
          failures[referenceKey(choice.ref)] =
            checked?.error ?? (result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      }
      if (!current()) return;
      setReferenceErrors(failures);
      if (Object.keys(failures).length > 0) return;
      const payload = contextBrief(session, task, verified, seed, candidateSnapshot);
      setSelected(verified);
      setPreview(payload);
      if (action === 'access') onAccess(accessObjects(verified));
      else if (action === 'copy') {
        const result = await api.copyText({ text: payload }).catch(() => null);
        if (!current()) return;
        if (result?.ok) setCopied(true);
        else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      }
    } catch {
      if (current()) setError('INTEGRITY_FAILURE');
    } finally {
      if (current()) setChecking(false);
    }
  }
  if (!seed || !open) return null;
  const seedReference = contextReference(seed),
    visibleKeys = new Set([
      referenceKey(seedReference.ref),
      ...direct.flatMap((item) => (item.reference ? [referenceKey(item.reference.ref)] : [])),
      ...members.map((item) => referenceKey(item.ref)),
    ]),
    retained = selected.filter((item) => !visibleKeys.has(referenceKey(item.ref))),
    unavailable = selected.some((item) => referenceErrors[referenceKey(item.ref)]),
    disabled = checking || composing || selected.length === 0 || unavailable;

  function row(
    reference: ContextReference,
    group: string,
    declared?: ContextCandidate['declared'],
  ) {
    const pin = referenceKey(reference.ref),
      id = `${instance}-${group}-${pin}`,
      chosen = selected.some((item) => referenceKey(item.ref) === pin);
    return (
      <div className="context-reference" key={id} data-context-reference={pin}>
        <label className="check-label context-choice">
          <input
            type="checkbox"
            data-testid={`context-${group}-${pin}`}
            checked={chosen}
            aria-describedby={`${id}-version`}
            onFocus={(event) => revealContextChoice(event.currentTarget)}
            onChange={(event) => choose(reference, event.target.checked)}
          />
          <span>{titleText(locale, reference.title, reference.kind)}</span>
        </label>
        <small id={`${id}-version`} className="secondary">
          {t(locale, `contextPrep.kind.${reference.kind}`)} ·{' '}
          {t(locale, 'source.version', { version: reference.ref.revision })}
          {declared?.mode === 'current' && ` · ${t(locale, 'contextPrep.resolvedCurrent')}`}
          {reference.lifecycle === 'archived' && ` · ${t(locale, 'ui.archived')}`}
        </small>
        <details>
          <summary>{t(locale, 'contextPrep.referenceDetails')}</summary>
          <code className="as-wrap">{reference.ref.objectId}</code>
        </details>
        {chosen && (
          <ErrorNotice
            code={referenceErrors[pin] ?? null}
            onRetry={() => void prepare('preview')}
          />
        )}
      </div>
    );
  }
  return (
    <Modal title={t(locale, 'contextPrep.title')} onClose={onClose} testId="context-preparation">
      <p>{t(locale, 'contextPrep.intro')}</p>
      <label>
        {t(locale, 'contextPrep.task')}
        <textarea
          rows={3}
          value={task}
          data-testid="context-task"
          aria-describedby={`${instance}-task-limit`}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            changeTask(event.currentTarget.value, false);
          }}
          onChange={(event) => changeTask(event.target.value)}
        />
      </label>
      <small id={`${instance}-task-limit`} className="secondary">
        {t(locale, 'contextPrep.taskLimit', { count: Array.from(task).length })}
      </small>
      <p role="status">{t(locale, 'contextPrep.selected', { count: selected.length })}</p>
      {limitReached && <p className="attention">{t(locale, 'contextPrep.selectionLimit')}</p>}
      <section>
        <h3>{t(locale, 'contextPrep.seed')}</h3>
        {row(seedReference, 'seed')}
        {seed.kind === 'project' &&
          selected.some((item) => referenceKey(item.ref) === referenceKey(seedReference.ref)) &&
          seed.content.body && (
            <details>
              <summary>{t(locale, 'contextPrep.goalExcerpt')}</summary>
              <p className="as-wrap">{codepoints(seed.content.body, 280)}</p>
            </details>
          )}
        <ErrorNotice code={seedError} onRetry={() => void loadSeed()} />
        {seedLoading && <p role="status">{t(locale, 'ui.loading')}</p>}
      </section>
      <section>
        <h3>{t(locale, 'contextPrep.direct')}</h3>
        <p className="secondary">{t(locale, 'contextPrep.directScope')}</p>
        <p>{t(locale, 'contextPrep.loaded', { count: direct.length })}</p>
        {direct.map((candidate) =>
          candidate.reference ? (
            row(candidate.reference, `direct-${candidate.key}`, candidate.declared)
          ) : (
            <div className="context-reference" key={candidate.key}>
              <p>{t(locale, 'contextPrep.unavailableLink')}</p>
              <button onClick={() => void loadSeed()} disabled={seedLoading}>
                {t(locale, 'common.retry')}
              </button>
            </div>
          ),
        )}
        {directNext !== null && (
          <button
            data-testid="context-direct-more"
            onClick={() => {
              const page = candidatePage(allDirect.current, directNext);
              setDirect((old) => [...old, ...page.items]);
              setDirectNext(page.next);
            }}
          >
            {t(locale, 'ui.moreResults')}
          </button>
        )}
      </section>
      {seed.kind === 'project' && (
        <section>
          <h3>{t(locale, 'contextPrep.members')}</h3>
          <p className="secondary">{t(locale, 'contextPrep.membersScope')}</p>
          <p>{t(locale, 'contextPrep.loaded', { count: members.length })}</p>
          {members.map((reference) => row(reference, 'member'))}
          <ErrorNotice
            code={memberError}
            onRetry={() => void loadMembers(failedMemberCursor.current)}
          />
          {memberNext && (
            <button
              data-testid="context-member-more"
              disabled={memberLoading}
              onClick={() => void loadMembers(memberNext)}
            >
              {t(locale, 'ui.moreResults')}
            </button>
          )}
          {memberLoading && <p role="status">{t(locale, 'ui.loading')}</p>}
        </section>
      )}
      {retained.length > 0 && (
        <section>
          <h3>{t(locale, 'contextPrep.retained')}</h3>
          {retained.map((reference) => row(reference, 'retained'))}
        </section>
      )}
      {unavailable && <p className="attention">{t(locale, 'contextPrep.unavailableSelection')}</p>}
      <p className="secondary">{t(locale, 'contextPrep.scope')}</p>
      <details
        open={previewOpen}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setPreviewOpen(next);
          if (next && preview === null && !checking) void prepare('preview');
        }}
      >
        <summary>{t(locale, 'contextPrep.preview')}</summary>
        {preview === null && !checking && (
          <button
            onClick={() => void prepare('preview')}
            disabled={composing || selected.length === 0}
          >
            {t(locale, 'contextPrep.preview')}
          </button>
        )}
        {preview && (
          <pre className="context-brief-preview" data-testid="context-brief-preview">
            {preview}
          </pre>
        )}
      </details>
      <ErrorNotice code={error} onRetry={() => void prepare('copy')} />
      <div className="as-actions">
        <button
          className="primary"
          data-testid="copy-context-brief"
          disabled={disabled}
          onClick={() => void prepare('copy')}
        >
          {t(locale, 'contextPrep.copy')}
        </button>
        <button
          data-testid="context-agent-access"
          disabled={disabled}
          onClick={() => void prepare('access')}
        >
          {t(locale, 'agent.setup')}
        </button>
        <button data-testid="context-import" disabled={composing} onClick={onImport}>
          {t(locale, 'contextPrep.import')}
        </button>
      </div>
      {checking && <p role="status">{t(locale, 'contextPrep.checking')}</p>}
      {copied && (
        <p role="status" data-testid="context-brief-copied">
          {t(locale, 'contextPrep.copied')}
        </p>
      )}
      <small className="secondary">{t(locale, 'contextPrep.unsavedDraft')}</small>
    </Modal>
  );
}
