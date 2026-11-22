import { diffLines } from 'diff';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectContent, ObjectRef } from '../../contracts/schema.js';
import { t } from '../i18n/index.js';
import { fieldText, fieldKindText, RefLink, useLocale } from '../ui.js';

export function ContentDiff({
  before,
  after,
  api,
  session,
  onOpen,
}: {
  before: ObjectContent | null;
  after: ObjectContent;
  api: DesktopApi;
  session: SpaceSession;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
}) {
  const locale = useLocale();
  const fields = [
    ...new Set([...Object.keys(before?.properties ?? {}), ...Object.keys(after.properties)]),
  ];
  const relationIds = [
    ...new Set([
      ...(before?.relations ?? []).map((entry) => entry.id),
      ...after.relations.map((entry) => entry.id),
    ]),
  ];
  const labels = {
    belongs_to: 'relation.inProject',
    related: 'relation.related',
    source: 'relation.source',
    uses: 'relation.usesAsset',
    continues_from: 'project.continuation',
  } as const;
  return (
    <div className="content-diff" data-testid="content-diff">
      <section>
        <h3>{t(locale, 'object.title')}</h3>
        {before?.title !== after.title ? (
          <div className="diff-values">
            {before && (
              <div className="removed">
                <span>− {t(locale, 'diff.removed')}</span>
                <p>{before.title || t(locale, 'ui.emptyTitle')}</p>
              </div>
            )}
            <div className="added">
              <span>+ {t(locale, 'diff.added')}</span>
              <p>{after.title || t(locale, 'ui.emptyTitle')}</p>
            </div>
          </div>
        ) : (
          <p>{after.title || t(locale, 'ui.emptyTitle')}</p>
        )}
      </section>
      <section>
        <h3>{t(locale, 'diff.body')}</h3>
        <div className="diff-body" tabIndex={0} aria-label={t(locale, 'diff.body')}>
          {diffLines(before?.body ?? '', after.body).map((part, index) => (
            <pre
              key={index}
              className={part.added ? 'added' : part.removed ? 'removed' : 'unchanged'}
            >
              <span
                className="diff-marker"
                aria-label={
                  part.added
                    ? t(locale, 'diff.added')
                    : part.removed
                      ? t(locale, 'diff.removed')
                      : undefined
                }
              >
                {part.added ? '+' : part.removed ? '−' : ' '}
              </span>
              {part.value}
            </pre>
          ))}
        </div>
      </section>
      <section>
        <h3>{t(locale, 'diff.properties')}</h3>
        {fields.map((key) => {
          const previous = before?.properties[key],
            next = after.properties[key];
          if (JSON.stringify(previous) === JSON.stringify(next)) return null;
          return (
            <div className="field-diff" key={key}>
              <h4>{next?.label ?? previous?.label}</h4>
              <div className="diff-values">
                {previous && (
                  <div className="removed">
                    <span>− {t(locale, 'diff.removed')}</span>
                    <p>
                      {previous.label}: {fieldText(locale, previous)}
                    </p>
                    <small>
                      {t(locale, 'ui.type')}: {fieldKindText(locale, previous.type)}
                    </small>
                    {previous.type === 'select' && (
                      <ul>
                        {previous.options.map((option) => (
                          <li key={option}>{option}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {next && (
                  <div className="added">
                    <span>+ {t(locale, 'diff.added')}</span>
                    <p>
                      {next.label}: {fieldText(locale, next)}
                    </p>
                    <small>
                      {t(locale, 'ui.type')}: {fieldKindText(locale, next.type)}
                    </small>
                    {next.type === 'select' && (
                      <ul>
                        {next.options.map((option) => (
                          <li key={option}>{option}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <section>
        <h3>{t(locale, 'diff.relations')}</h3>
        {relationIds.map((id) => {
          const previous = before?.relations.find((entry) => entry.id === id),
            next = after.relations.find((entry) => entry.id === id);
          if (JSON.stringify(previous) === JSON.stringify(next)) return null;
          return (
            <div className="diff-values" key={id}>
              {previous && (
                <div className="removed">
                  <span>
                    − {t(locale, 'diff.removed')} · {t(locale, labels[previous.predicate])}
                  </span>
                  <RefLink
                    api={api}
                    session={session}
                    reference={previous.target}
                    onOpen={onOpen}
                  />
                </div>
              )}
              {next && (
                <div className="added">
                  <span>
                    + {t(locale, 'diff.added')} · {t(locale, labels[next.predicate])}
                  </span>
                  <RefLink api={api} session={session} reference={next.target} onOpen={onOpen} />
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
