import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { bound } from '../state/binding.js';
import { formatCount, t, titleText } from '../i18n/index.js';
import { ErrorNotice, useLocale } from '../ui.js';

type LinkedRow = { item: ObjectSummary; uses: ObjectRef[] };
export function LinkedMaterial({
  api,
  session,
  objectId,
  mode,
  refresh,
  onOpen,
}: {
  api: DesktopApi;
  session: SpaceSession;
  objectId: string;
  mode: 'project' | 'asset';
  refresh: number;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
}) {
  const locale = useLocale();
  const [rows, setRows] = useState<LinkedRow[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [checked, setChecked] = useState(0),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [scanError, setScanError] = useState<ErrorCode | null>(null);
  const gate = useRef(0);
  async function load(cursor?: string) {
    const ticket = ++gate.current;
    setLoading(true);
    const result = await api
      .query(
        bound(session, {
          filter: mode === 'project' ? { projectId: objectId } : {},
          limit: 20,
          maxBytes: 32_768,
          ...(cursor ? { cursor } : {}),
        }),
      )
      .catch(() => null);
    if (ticket !== gate.current) return;
    if (!result?.ok) {
      setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      setLoading(false);
      return;
    }
    let entries: LinkedRow[] = result.value.items.map((item) => ({ item, uses: [] }));
    let inspected = entries.length,
      readError: ErrorCode | null = null;
    if (mode === 'asset') {
      const views = await Promise.all(
        result.value.items.map((item) =>
          api
            .readObject(
              bound(session, {
                objectId: item.ref.objectId,
                revision: item.ref.revision,
              }),
            )
            .catch(() => null),
        ),
      );
      if (ticket !== gate.current) return;
      entries = [];
      inspected = 0;
      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        if (view?.ok) {
          inspected++;
          const uses = view.value.object.content.relations
            .filter(
              (relation) => relation.predicate === 'uses' && relation.target.objectId === objectId,
            )
            .map((relation) => relation.target);
          if (uses.length) entries.push({ item: result.value.items[i]!, uses });
        } else readError = view && !view.ok ? view.error.code : 'OPERATION_UNKNOWN';
      }
    }
    setRows((old) =>
      cursor
        ? [
            ...old,
            ...entries.filter(
              (entry) => !old.some((row) => row.item.ref.objectId === entry.item.ref.objectId),
            ),
          ]
        : entries,
    );
    setChecked((old) => (cursor ? old + inspected : inspected));
    setNext(result.value.nextCursor);
    setError(null);
    setScanError((old) => (cursor ? (old ?? readError) : readError));
    setLoading(false);
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
    };
  }, [session.bindingId, objectId, mode, refresh]);
  return (
    <section className="linked-material" data-testid={`${mode}-material`}>
      <h2>{t(locale, mode === 'project' ? 'project.material' : 'org.relatedUses')}</h2>
      {!loading && (
        <p className="secondary">
          {mode === 'asset'
            ? t(locale, next || error || scanError ? 'org.checkedScope' : 'org.completeScope', {
                count: checked,
              })
            : formatCount(locale, 'items', rows.length)}
        </p>
      )}
      <ErrorNotice
        code={error ?? scanError}
        onRetry={() => {
          void load();
        }}
      />
      {rows.map(({ item, uses }) => (
        <div className="linked-material-row" key={item.ref.objectId}>
          <button
            className="text-button"
            id={`linked-${objectId}-${item.ref.objectId}`}
            onClick={() =>
              onOpen(
                { mode: 'current', objectId: item.ref.objectId },
                `linked-${objectId}-${item.ref.objectId}`,
              )
            }
          >
            {titleText(locale, item.title, item.kind)}
          </button>
          <small>
            {item.kind === 'document'
              ? t(locale, 'object.note')
              : item.kind === 'project'
                ? t(locale, 'org.project')
                : t(locale, item.kind === 'record' ? 'object.record' : 'object.asset')}
          </small>
          {uses.map((ref, index) => (
            <small key={index}>
              {ref.mode === 'pinned'
                ? t(locale, 'source.version', { version: ref.revision })
                : t(locale, 'relation.followCurrent')}
            </small>
          ))}
        </div>
      ))}
      {!rows.length && !loading && !error && !scanError && (
        <p className="secondary">{t(locale, 'org.noneLinked')}</p>
      )}
      {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
      {next && (
        <>
          <p className="secondary">{t(locale, 'context.limitReached')}</p>
          <button
            disabled={loading}
            onClick={() => {
              void load(next);
            }}
          >
            {t(locale, mode === 'asset' ? 'org.moreMaterial' : 'context.nextPage')}
          </button>
        </>
      )}
    </section>
  );
}
