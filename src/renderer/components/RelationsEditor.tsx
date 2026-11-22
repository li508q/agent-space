import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { EditorSession } from '../state/editor.js';
import {
  makeRelation,
  relationLabels,
  relationTargetKind,
  type Predicate,
  type Relation,
} from '../state/material.js';
import { bound } from '../state/binding.js';
import { formatCount, t, titleText } from '../i18n/index.js';
import { ErrorNotice, Modal, RefLink, useLocale } from '../ui.js';

export function RelationsEditor({
  editor,
  api,
  session,
  onClose,
}: {
  editor: EditorSession;
  api: DesktopApi;
  session: SpaceSession;
  onClose: () => void;
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const original = useRef(structuredClone(state.content.relations));
  const generation = useRef(state.generation);
  const [rows, setRows] = useState<Relation[]>(() => structuredClone(original.current));
  const [predicate, setPredicate] = useState<Predicate>('belongs_to');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ObjectSummary[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState<ObjectSummary | null>(null);
  const [pinned, setPinned] = useState(false),
    [revision, setRevision] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [invalidVersion, setInvalidVersion] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const ticket = useRef(0),
    alive = useRef(true);
  const needsPin =
    predicate === 'source' || ((predicate === 'uses' || predicate === 'continues_from') && pinned);
  const dirty = JSON.stringify(rows) !== JSON.stringify(original.current) || selected !== null;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ticket.current++;
    };
  }, []);

  async function load(cursor?: string) {
    const own = ++ticket.current;
    setLoading(true);
    const kind = relationTargetKind(predicate);
    const result = await api
      .query(
        bound(session, {
          filter: { ...(kind ? { kind } : {}), ...(search ? { text: search } : {}) },
          limit: 20,
          maxBytes: 32_768,
          ...(cursor ? { cursor } : {}),
        }),
      )
      .catch(() => null);
    if (!alive.current || own !== ticket.current) return;
    setLoading(false);
    if (result?.ok) {
      setItems((old) =>
        cursor
          ? [
              ...old,
              ...result.value.items.filter(
                (item) => !old.some((entry) => entry.ref.objectId === item.ref.objectId),
              ),
            ]
          : result.value.items,
      );
      setNext(result.value.nextCursor);
      setError(null);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  useEffect(() => {
    if (state.composing) return;
    setLoading(true);
    const timer = setTimeout(() => {
      void load();
    }, 150);
    return () => {
      clearTimeout(timer);
      ticket.current++;
    };
  }, [predicate, search, state.composing]);

  async function add() {
    await editor.afterComposition();
    if (!selected || busy || state.locked) return;
    const number = Number(revision);
    if (needsPin && (!/^\d+$/.test(revision) || !Number.isSafeInteger(number) || number < 1)) {
      setInvalidVersion(true);
      return;
    }
    setBusy(true);
    setError(null);
    setInvalidVersion(false);
    const result = await api
      .readObject(
        bound(session, {
          objectId: selected.ref.objectId,
          ...(needsPin ? { revision: number } : {}),
        }),
      )
      .catch(() => null);
    if (!alive.current) return;
    if (result?.ok) {
      const object = result.value.object,
        required = relationTargetKind(predicate);
      if (required && object.kind !== required) setError('INVALID_INPUT');
      else {
        const relation = makeRelation(predicate, object, needsPin);
        setRows((old) => [...old, relation]);
        setSelected(null);
        setRevision('');
      }
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
    setBusy(false);
  }
  async function apply() {
    await editor.afterComposition();
    if (busy || state.locked) return;
    const current = editor.getSnapshot();
    if (current.generation !== generation.current) {
      setError('STALE_REVISION');
      return;
    }
    editor.edit({ ...current.content, relations: structuredClone(rows) });
    onClose();
  }
  async function requestClose() {
    await editor.afterComposition();
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  function reload() {
    const current = editor.getSnapshot();
    generation.current = current.generation;
    original.current = structuredClone(current.content.relations);
    setRows(structuredClone(original.current));
    setSelected(null);
    setError(null);
    setDiscard(false);
  }
  return (
    <Modal
      title={t(locale, 'relations.edit')}
      onClose={() => {
        void requestClose();
      }}
      testId="relations-editor"
    >
      {dirty && (
        <p className="attention" role="status">
          {t(locale, 'fields.unapplied')}
        </p>
      )}
      <ErrorNotice
        code={error}
        onRetry={() => {
          void load();
        }}
      />
      <div
        onCompositionStartCapture={() => editor.setComposing(true)}
        onCompositionEndCapture={() => queueMicrotask(() => editor.setComposing(false))}
      >
        <fieldset className="metadata-form" disabled={busy || state.locked || discard}>
          <legend className="as-sr-only">{t(locale, 'diff.relations')}</legend>
          <div className="relationship-edits">
            {rows.map((relation) => (
              <div
                key={relation.id}
                className="relationship-edit"
                data-testid={`edit-relation-${relation.id}`}
              >
                <div>
                  <strong>{t(locale, relationLabels[relation.predicate])}</strong>
                  <RefLink
                    passive
                    api={api}
                    session={session}
                    reference={relation.target}
                    onOpen={() => {}}
                  />
                </div>
                <button
                  onClick={() => setRows((old) => old.filter((entry) => entry.id !== relation.id))}
                >
                  {t(locale, 'common.remove')}
                </button>
              </div>
            ))}
          </div>
          <h3>{t(locale, 'relations.add')}</h3>
          <label>
            {t(locale, 'relations.meaning')}
            <select
              value={predicate}
              data-testid="relationship-type"
              onChange={(event) => {
                setPredicate(event.target.value as Predicate);
                setSelected(null);
                setRevision('');
                setInvalidVersion(false);
                setError(null);
                setItems([]);
                setNext(null);
              }}
            >
              {(Object.keys(relationLabels) as Predicate[]).map((value) => (
                <option key={value} value={value}>
                  {t(locale, relationLabels[value])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, 'relations.chooseTarget')}
            <input
              value={search}
              maxLength={200}
              data-testid="relationship-search"
              placeholder={t(locale, 'ui.search')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div
            className="target-results as-scroll-region"
            role="group"
            aria-label={t(locale, 'relations.chooseTarget')}
          >
            {items.map((item) => (
              <label className="target-result" key={item.ref.objectId}>
                <input
                  type="radio"
                  name="relationship-target"
                  value={item.ref.objectId}
                  checked={selected?.ref.objectId === item.ref.objectId}
                  data-testid={`relationship-target-${item.ref.objectId}`}
                  onChange={() => {
                    setSelected(item);
                    setRevision(String(item.ref.revision));
                  }}
                />
                <span>
                  {titleText(locale, item.title, item.kind)}
                  <small>
                    {item.kind === 'project'
                      ? t(locale, 'org.project')
                      : item.kind === 'document'
                        ? t(locale, 'object.note')
                        : t(locale, item.kind === 'record' ? 'object.record' : 'object.asset')}{' '}
                    · {t(locale, 'source.version', { version: item.ref.revision })}
                  </small>
                </span>
              </label>
            ))}
            {!loading && !items.length && !error && (
              <p className="secondary">{t(locale, 'context.noMatches')}</p>
            )}
            {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
          </div>
          <p className="secondary">
            {formatCount(locale, 'items', items.length)}
            {next && <> — {t(locale, 'context.limitReached')}</>}
          </p>
          {next && (
            <button
              onClick={() => {
                void load(next);
              }}
              disabled={loading}
            >
              {t(locale, 'context.nextPage')}
            </button>
          )}
          {(predicate === 'uses' || predicate === 'continues_from') && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              {t(locale, 'relation.pinned')}
            </label>
          )}
          {needsPin && (
            <label>
              {t(locale, 'relations.revision')}
              <input
                inputMode="numeric"
                value={revision}
                data-testid="relationship-revision"
                aria-invalid={invalidVersion}
                onChange={(event) => {
                  setRevision(event.target.value);
                  setInvalidVersion(false);
                }}
              />
            </label>
          )}
          {invalidVersion && (
            <p className="field-error" role="alert">
              {t(locale, 'relations.invalidVersion')}
            </p>
          )}
          <p className="secondary">
            {t(locale, needsPin ? 'relations.pinNotice' : 'relations.currentNotice')}
          </p>
          <button
            data-testid="add-relationship"
            disabled={!selected || rows.length >= 100}
            onClick={() => {
              void add();
            }}
          >
            {t(locale, 'relations.add')}
          </button>
          {selected && (
            <button
              onClick={() => {
                setSelected(null);
                setRevision('');
              }}
            >
              {t(locale, 'common.cancel')}
            </button>
          )}
        </fieldset>
      </div>
      <div className="metadata-actions as-actions">
        <button
          className="primary"
          data-testid="apply-relationships"
          disabled={busy || state.locked || discard || !!selected}
          onClick={() => {
            void apply();
          }}
        >
          {t(locale, 'relations.apply')}
        </button>
        <button
          onClick={() => {
            void requestClose();
          }}
        >
          {t(locale, 'common.cancel')}
        </button>
        {error === 'STALE_REVISION' && (
          <button onClick={reload}>{t(locale, 'metadata.reload')}</button>
        )}
      </div>
      {discard && (
        <div className="discard-prompt" role="alert">
          <p>{t(locale, 'metadata.discardQuestion')}</p>
          <div className="as-actions">
            <button
              autoFocus
              onClick={() => {
                setDiscard(false);
                requestAnimationFrame(() =>
                  document.querySelector<HTMLElement>('[data-testid="relationship-type"]')?.focus(),
                );
              }}
            >
              {t(locale, 'metadata.keepEditing')}
            </button>
            <button onClick={onClose}>{t(locale, 'metadata.discard')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
