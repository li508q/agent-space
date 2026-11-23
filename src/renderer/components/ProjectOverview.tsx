import { useEffect, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectView } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectContent, ObjectRef } from '../../contracts/schema.js';
import { formatNumber, t, titleText } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import { ErrorNotice, fieldText, useLocale } from '../ui.js';
import { LinkedMaterial } from './LinkedMaterial.js';

type Props = {
  api: DesktopApi;
  session: SpaceSession;
  objectId: string;
  content: ObjectContent;
  refresh: number;
  writable: boolean;
  locked: boolean;
  onEdit: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onProjectMaterial: () => void;
  restoreMaterialCount?: number;
  restoreReferenceCounts?: { continuation: number; assets: number };
};

export function projectSection(section: 'goal' | 'continuation' | 'assets' | 'material') {
  document.getElementById(`project-${section}-heading`)?.focus();
}

export function ProjectOverview({
  api,
  session,
  objectId,
  content,
  refresh,
  writable,
  locked,
  onEdit,
  onOpen,
  onProjectMaterial,
  restoreMaterialCount,
  restoreReferenceCounts,
}: Props) {
  const locale = useLocale();
  const characters = Array.from(content.body.trim()),
    excerpt = characters.slice(0, 280).join('');
  return (
    <section className="project-overview" data-testid="project-overview">
      <section aria-labelledby="project-goal-heading">
        <h2 id="project-goal-heading" tabIndex={-1}>
          {t(locale, 'project.goal')}
        </h2>
        {excerpt ? (
          <>
            <small className="secondary">{t(locale, 'project.excerpt')}</small>
            <p className="project-goal-excerpt" data-testid="project-goal-excerpt">
              {excerpt}
              {characters.length > 280 ? '…' : ''}
            </p>
          </>
        ) : (
          <p className="secondary">{t(locale, 'project.emptyGoal')}</p>
        )}
        {!excerpt && writable && (
          <button data-testid="project-edit-goal" disabled={locked} onClick={onEdit}>
            {t(locale, 'project.editGoal')}
          </button>
        )}
      </section>
      <div className="project-reference-groups">
        {(['continuation', 'assets'] as const).map((section) => (
          <ProjectReferences
            key={section}
            api={api}
            session={session}
            section={section}
            relations={content.relations.filter(
              (relation) =>
                relation.predicate === (section === 'assets' ? 'uses' : 'continues_from'),
            )}
            refresh={refresh}
            restoreCount={restoreReferenceCounts?.[section]}
            onOpen={onOpen}
          />
        ))}
      </div>
      {!!Object.keys(content.properties).length && (
        <details className="project-fields">
          <summary>{t(locale, 'diff.properties')}</summary>
          {Object.entries(content.properties).map(([key, field]) => (
            <dl className="property-row" key={key}>
              <dt>{field.label}</dt>
              <dd>{fieldText(locale, field)}</dd>
            </dl>
          ))}
        </details>
      )}
      <LinkedMaterial
        api={api}
        session={session}
        objectId={objectId}
        mode="project"
        refresh={refresh}
        onOpen={onOpen}
        restoreCount={restoreMaterialCount}
      />
      <button onClick={onProjectMaterial} disabled={locked}>
        {t(locale, 'ui.projectMaterial')}
      </button>
    </section>
  );
}

function ProjectReferences({
  api,
  session,
  section,
  relations,
  refresh,
  onOpen,
  restoreCount = 3,
}: Pick<Props, 'api' | 'session' | 'refresh' | 'onOpen'> & {
  section: 'continuation' | 'assets';
  relations: ObjectContent['relations'];
  restoreCount?: number;
}) {
  const locale = useLocale();
  const [shown, setShown] = useState(Math.max(3, restoreCount));
  useEffect(() => setShown((value) => Math.max(value, restoreCount)), [restoreCount]);
  return (
    <section data-testid={`project-${section}`} aria-labelledby={`project-${section}-heading`}>
      <h2 id={`project-${section}-heading`} tabIndex={-1}>
        {t(locale, section === 'assets' ? 'project.assets' : 'project.continuation')}
      </h2>
      {relations.length ? (
        <>
          <p className="secondary project-reference-count">
            {t(locale, 'project.referenceCount', {
              shown: formatNumber(locale, Math.min(shown, relations.length)),
              total: formatNumber(locale, relations.length),
            })}
          </p>
          {relations.slice(0, shown).map((relation) => (
            <ProjectReference
              key={relation.id}
              api={api}
              session={session}
              relation={relation}
              refresh={refresh}
              onOpen={onOpen}
            />
          ))}
          {shown < relations.length && (
            <button
              className="text-button"
              onClick={() => setShown((value) => (value === 3 ? 10 : value + 10))}
            >
              {t(locale, 'project.moreReferences')}
            </button>
          )}
        </>
      ) : (
        <p className="secondary">
          {t(locale, section === 'assets' ? 'project.noAssets' : 'project.noContinuation')}
        </p>
      )}
    </section>
  );
}

function ProjectReference({
  api,
  session,
  relation,
  refresh,
  onOpen,
}: Pick<Props, 'api' | 'session' | 'refresh' | 'onOpen'> & {
  relation: ObjectContent['relations'][number];
}) {
  const locale = useLocale();
  const [view, setView] = useState<ObjectView | null>(null),
    [error, setError] = useState<ErrorCode | null>(null),
    [retry, setRetry] = useState(0);
  const reference = relation.target,
    revision = reference.mode === 'pinned' ? reference.revision : undefined;
  const currentRefresh = reference.mode === 'current' ? refresh : 0;
  useEffect(() => {
    let active = true;
    setView(null);
    setError(null);
    void api
      .readObject(
        bound(session, { objectId: reference.objectId, ...(revision ? { revision } : {}) }),
      )
      .then((result) => {
        if (!active) return;
        if (result.ok) setView(result.value);
        else setError(result.error.code);
      })
      .catch(() => {
        if (active) setError('OPERATION_UNKNOWN');
      });
    return () => {
      active = false;
    };
  }, [api, session.bindingId, reference.objectId, revision, currentRefresh, retry]);
  return (
    <div className="project-reference-row">
      <button
        className="text-button"
        id={`project-ref-${relation.id}`}
        data-testid={`project-ref-${relation.id}`}
        onClick={() => onOpen(reference, `project-ref-${relation.id}`)}
      >
        {view
          ? titleText(locale, view.object.content.title, view.object.kind)
          : t(locale, error ? 'source.unavailable' : 'ui.loading')}
      </button>
      <small className="secondary">
        {reference.mode === 'pinned'
          ? t(locale, 'project.pinnedReference', { version: reference.revision })
          : t(locale, 'relation.followCurrent')}
      </small>
      {view?.object.lifecycle === 'archived' && (
        <small className="attention">
          {t(locale, reference.mode === 'pinned' ? 'project.archivedAtVersion' : 'ui.archived')}
        </small>
      )}
      {!view && !error && (
        <span className="as-sr-only" role="status">
          {t(locale, 'ui.loading')}
        </span>
      )}
      <ErrorNotice code={error} onRetry={() => setRetry((value) => value + 1)} />
    </div>
  );
}
