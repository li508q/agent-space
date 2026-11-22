import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot, ObjectSummary } from '../../contracts/core.js';
import type { ObjectContent } from '../../contracts/schema.js';
import type { ErrorCode } from '../../contracts/errors.js';
import { bound } from '../state/binding.js';
import { t, titleText } from '../i18n/index.js';
import { ErrorNotice, fieldKindText, fieldText, useLocale } from '../ui.js';

const MAX_ROWS = 50;
type Row = { item: ObjectSummary; object: ObjectSnapshot | null; error: ErrorCode | null };
export function RecordsTable({
  api,
  session,
  items,
  more,
  onMore,
  onOpen,
  onReuse,
  onBack,
}: {
  api: DesktopApi;
  session: SpaceSession;
  items: ObjectSummary[];
  more: boolean;
  onMore: () => void;
  onOpen: (id: string) => void;
  onReuse: (properties: ObjectContent['properties']) => void;
  onBack: () => void;
}) {
  const locale = useLocale();
  const [rows, setRows] = useState<Row[]>([]),
    [referenceId, setReferenceId] = useState('');
  const [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const gate = useRef(0);
  useEffect(() => {
    const ticket = ++gate.current;
    setLoading(true);
    void Promise.all(
      items.slice(0, MAX_ROWS).map(async (item): Promise<Row> => {
        const result = await api
          .readObject(bound(session, { objectId: item.ref.objectId, revision: item.ref.revision }))
          .catch(() => null);
        return {
          item,
          object: result?.ok ? result.value.object : null,
          error: result?.ok ? null : result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN',
        };
      }),
    ).then((result) => {
      if (ticket !== gate.current) return;
      setRows(result);
      setLoading(false);
    });
    return () => {
      gate.current++;
    };
  }, [api, session.bindingId, items, retry]);
  const reference =
    rows.find((row) => row.object?.id === referenceId)?.object ??
    rows.find((row) => row.object)?.object ??
    null;
  const columns = Object.entries(reference?.content.properties ?? {});
  return (
    <section className="records-pane" data-testid="records-table">
      <header className="document-header">
        <div className="as-actions">
          <h1>{t(locale, 'records.table')}</h1>
          <button className="push" onClick={onBack}>
            {t(locale, 'records.list')}
          </button>
        </div>
        <p className="secondary">
          {t(locale, 'records.tableScope', {
            count: Math.min(items.length, MAX_ROWS),
            loaded: items.length,
          })}
        </p>
        {(more || items.length > MAX_ROWS) && (
          <p className="attention">{t(locale, 'context.limitReached')}</p>
        )}
        {items.length >= MAX_ROWS && (
          <p className="secondary">{t(locale, 'records.tableLimit', { count: MAX_ROWS })}</p>
        )}
        <label>
          {t(locale, 'records.reference')}
          <select
            value={reference?.id ?? ''}
            data-testid="table-reference"
            onChange={(event) => setReferenceId(event.target.value)}
          >
            {rows
              .filter((row) => row.object)
              .map((row) => (
                <option key={row.item.ref.objectId} value={row.item.ref.objectId}>
                  {titleText(locale, row.item.title, 'record')}
                </option>
              ))}
          </select>
        </label>
        <p className="secondary">{t(locale, 'records.columnNotice')}</p>
        <button
          disabled={!reference}
          data-testid="reuse-record-fields"
          onClick={() => {
            if (reference) onReuse(reference.content.properties);
          }}
        >
          {t(locale, 'records.reuse')}
        </button>
        <small className="secondary reuse-notice">{t(locale, 'records.reuseNotice')}</small>
      </header>
      <div
        className="record-table-scroll as-scroll-region"
        role="region"
        aria-label={t(locale, 'records.table')}
        tabIndex={0}
      >
        <table>
          <caption className="as-sr-only">
            {t(locale, 'records.tableScope', {
              count: Math.min(items.length, MAX_ROWS),
              loaded: items.length,
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, 'object.title')}</th>
              {columns.map(([key, field]) => (
                <th scope="col" key={key}>
                  {field.label}
                  <small>{fieldKindText(locale, field.type)}</small>
                </th>
              ))}
              <th scope="col">{t(locale, 'common.details')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, object, error }) => (
              <tr key={item.ref.objectId} data-testid={`record-row-${item.ref.objectId}`}>
                <th scope="row">
                  <button className="text-button" onClick={() => onOpen(item.ref.objectId)}>
                    {titleText(locale, item.title, 'record')}
                  </button>
                  <small>{t(locale, 'source.version', { version: item.ref.revision })}</small>
                </th>
                {error || !object ? (
                  <td colSpan={columns.length + 1}>
                    <ErrorNotice
                      code={error ?? 'NOT_FOUND'}
                      onRetry={() => setRetry((value) => value + 1)}
                    />
                  </td>
                ) : (
                  <>
                    {columns.map(([key, definition]) => {
                      const field = Object.hasOwn(object.content.properties, key)
                        ? object.content.properties[key]
                        : undefined;
                      const different =
                        field &&
                        (field.type !== definition.type ||
                          field.label !== definition.label ||
                          (field.type === 'select' &&
                            definition.type === 'select' &&
                            JSON.stringify(field.options) !== JSON.stringify(definition.options)));
                      return (
                        <td key={key}>
                          {field ? (
                            <>
                              {different && (
                                <small className="attention">
                                  {t(locale, 'records.otherDefinition')}: {field.label} (
                                  {fieldKindText(locale, field.type)})
                                </small>
                              )}
                              {fieldText(locale, field).length > 300 ? (
                                <>
                                  <span>{fieldText(locale, field).slice(0, 300)}…</span>
                                  <button
                                    className="text-button"
                                    onClick={() => onOpen(item.ref.objectId)}
                                  >
                                    {t(locale, 'common.openNamed', {
                                      title: titleText(locale, item.title, 'record'),
                                    })}
                                  </button>
                                  <small>{t(locale, 'records.valuePreview')}</small>
                                </>
                              ) : (
                                fieldText(locale, field)
                              )}
                            </>
                          ) : (
                            <span className="secondary">{t(locale, 'records.missingField')}</span>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <button
                        aria-label={t(locale, 'common.openNamed', {
                          title: titleText(locale, item.title, 'record'),
                        })}
                        onClick={() => onOpen(item.ref.objectId)}
                      >
                        {t(locale, 'common.details')}
                      </button>
                      {Object.keys(object.content.properties).some(
                        (key) => !Object.hasOwn(reference?.content.properties ?? {}, key),
                      ) && (
                        <small>
                          {t(locale, 'records.extraFields', {
                            count: Object.keys(object.content.properties).filter(
                              (key) => !Object.hasOwn(reference?.content.properties ?? {}, key),
                            ).length,
                          })}
                        </small>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p role="status">{t(locale, 'ui.loading')}</p>}
        {!loading && !rows.length && <p>{t(locale, 'context.noMatches')}</p>}
        {more && items.length < MAX_ROWS && (
          <button disabled={loading} onClick={onMore}>
            {t(locale, 'context.nextPage')}
          </button>
        )}
      </div>
    </section>
  );
}
