import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { bound } from '../state/binding.js';
import { formatCount, t, titleText } from '../i18n/index.js';
import { ErrorNotice, useLocale } from '../ui.js';
import { IncomingLinks } from './IncomingLinks.js';

type Props = {
  api: DesktopApi;
  session: SpaceSession;
  objectId: string;
  mode: 'project' | 'asset';
  refresh: number;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
};
export function LinkedMaterial(props: Props) {
  return props.mode === 'asset' ? (
    <IncomingLinks {...props} assetOnly />
  ) : (
    <ProjectMaterial {...props} />
  );
}
function ProjectMaterial({ api, session, objectId, refresh, onOpen }: Props) {
  const locale = useLocale(),
    gate = useRef(0);
  const [rows, setRows] = useState<ObjectSummary[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<ErrorCode | null>(null);
  async function load(cursor?: string) {
    const ticket = ++gate.current;
    setLoading(true);
    const result = await api
      .query(
        bound(session, {
          filter: { projectId: objectId },
          limit: 20,
          maxBytes: 32_768,
          ...(cursor ? { cursor } : {}),
        }),
      )
      .catch(() => null);
    if (ticket !== gate.current) return;
    setLoading(false);
    if (result?.ok) {
      setRows((old) => (cursor ? [...old, ...result.value.items] : result.value.items));
      setNext(result.value.nextCursor);
      setError(null);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
    };
  }, [session.bindingId, objectId, refresh]);
  return (
    <section className="linked-material" data-testid="project-material">
      <h2>{t(locale, 'project.material')}</h2>
      <p className="secondary">{formatCount(locale, 'items', rows.length)}</p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          void load();
        }}
      />
      {rows.map((item) => (
        <div className="linked-material-row" key={item.ref.objectId}>
          <button
            className="text-button"
            id={`linked-${objectId}-${item.ref.objectId}`}
            onClick={() => onOpen(item.ref, `linked-${objectId}-${item.ref.objectId}`)}
          >
            {titleText(locale, item.title, item.kind)}
          </button>
          <small>{t(locale, 'source.version', { version: item.ref.revision })}</small>
        </div>
      ))}
      {!loading && !error && rows.length === 0 && (
        <p className="secondary">{t(locale, 'org.noneLinked')}</p>
      )}
      {next && (
        <>
          <p className="secondary">{t(locale, 'context.limitReached')}</p>
          <button
            disabled={loading}
            onClick={() => {
              void load(next);
            }}
          >
            {t(locale, 'context.nextPage')}
          </button>
        </>
      )}
      {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
    </section>
  );
}
