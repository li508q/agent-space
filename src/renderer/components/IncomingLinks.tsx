import { useEffect, useId, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ExpandedEdge, ObjectSummary, RelationsExpandPage } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { bound } from '../state/binding.js';
import { t } from '../i18n/index.js';
import { relationLabels } from '../state/material.js';
import { ErrorNotice, RefLink, useLocale } from '../ui.js';

export function IncomingLinks({
  api,
  session,
  objectId,
  assetOnly = false,
  refresh,
  onOpen,
}: {
  api: DesktopApi;
  session: SpaceSession;
  objectId: string;
  assetOnly?: boolean;
  refresh: number;
  onOpen: (ref: ObjectRef, trigger?: string) => void;
}) {
  const locale = useLocale(),
    gate = useRef(0);
  const instance = useId();
  const [page, setPage] = useState<RelationsExpandPage | null>(null),
    [edges, setEdges] = useState<ExpandedEdge[]>([]);
  const [nodes, setNodes] = useState<ObjectSummary[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null),
    [loading, setLoading] = useState(true);
  async function load(cursor?: string) {
    const ticket = ++gate.current;
    setLoading(true);
    const result = await api
      .expandRelations(
        bound(
          session,
          cursor
            ? { cursor, maxBytes: 65_536 }
            : {
                seedId: objectId,
                direction: 'incoming',
                predicates: assetOnly
                  ? ['uses']
                  : ['belongs_to', 'related', 'source', 'uses', 'continues_from'],
                maxDepth: 1,
                maxNodes: 30,
                maxEdges: 30,
                maxBytes: 65_536,
              },
        ),
      )
      .catch(() => null);
    if (ticket !== gate.current) return;
    setLoading(false);
    if (result?.ok) {
      setPage(result.value);
      setError(null);
      setEdges((old) => (cursor ? [...old, ...result.value.edges] : result.value.edges));
      setNodes((old) => (cursor ? [...old, ...result.value.nodes] : result.value.nodes));
      setUnavailable((old) =>
        cursor ? old || result.value.unavailableReferences : result.value.unavailableReferences,
      );
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  useEffect(() => {
    void load();
    return () => {
      gate.current++;
    };
  }, [session.bindingId, objectId, assetOnly, refresh]);
  return (
    <section
      className="incoming-links"
      data-testid={assetOnly ? 'asset-material' : 'incoming-links'}
    >
      <h3>{t(locale, assetOnly ? 'org.relatedUses' : 'links.incoming')}</h3>
      <p className="secondary">{t(locale, 'links.scope', { count: edges.length })}</p>
      <ErrorNotice
        code={error}
        onRetry={() => {
          void load();
        }}
      />
      {edges.map((edge, index) => (
        <div
          className="relation-row"
          key={`${edge.owner.objectId}-${edge.owner.revision}-${edge.relation.id}`}
        >
          <span>{t(locale, relationLabels[edge.relation.predicate])}</span>
          <RefLink
            api={api}
            session={session}
            reference={edge.owner}
            summary={nodes.find(
              (node) =>
                node.ref.objectId === edge.owner.objectId &&
                node.ref.revision === edge.owner.revision,
            )}
            onOpen={onOpen}
            id={`incoming-${instance}-${objectId}-${index}`}
          />
          {edge.relation.target.mode === 'pinned' && (
            <small>
              {t(locale, 'links.targetsVersion', { version: edge.relation.target.revision })}
            </small>
          )}
        </div>
      ))}
      {!loading && !error && edges.length === 0 && (
        <p className="secondary">{t(locale, 'links.none')}</p>
      )}
      {page &&
        (page.truncated || !page.traversalCompleteWithinScope || page.stopReasons.length > 0) && (
          <p className="attention">{t(locale, 'links.limited')}</p>
        )}
      {unavailable && <p className="attention">{t(locale, 'links.unavailable')}</p>}
      {page?.nextCursor && (
        <button
          disabled={loading}
          onClick={() => {
            void load(page.nextCursor!);
          }}
        >
          {t(locale, 'context.nextPage')}
        </button>
      )}
      {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
    </section>
  );
}
