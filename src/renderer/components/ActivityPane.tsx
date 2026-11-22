import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ActivityEntry } from '../../contracts/core.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { formatNumber, t } from '../i18n/index.js';
import { Modal, RefLink, Time, useLocale } from '../ui.js';

export function ActivityPane({
  api,
  session,
  entries,
  onClose,
  onOpen,
  onEarlier,
  more,
}: {
  api: DesktopApi;
  session: SpaceSession;
  entries: ActivityEntry[];
  onClose: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onEarlier: () => void;
  more: boolean;
}) {
  const locale = useLocale();
  const prepared = entries
    .filter((entry) => entry.stage === 'prepared')
    .sort((a, b) => b.id - a.id);
  return (
    <Modal title={t(locale, 'ui.activity')} onClose={onClose} testId="activity-pane">
      <p className="secondary">{t(locale, 'agent.deliveryNotice')}</p>
      {prepared.length === 0 && <p>{t(locale, 'ui.noPrepared')}</p>}
      {prepared.map((entry) => (
        <section className="activity-record" key={entry.id}>
          <h3>{t(locale, 'ui.preparedRecord', { id: entry.id })}</h3>
          <div className="as-actions">
            <code>{entry.tool}</code>
            <small>
              <Time value={entry.recordedAt} />
            </small>
          </div>
          {entry.delivered.map((delivered, index) => (
            <div className="delivered-reference" key={index}>
              <RefLink
                api={api}
                session={session}
                reference={delivered.ref}
                onOpen={(reference, trigger) => {
                  onClose();
                  onOpen(reference, trigger);
                }}
              />
              {delivered.section ? (
                <small>
                  {t(
                    locale,
                    delivered.section === 'body'
                      ? 'diff.body'
                      : delivered.section === 'properties'
                        ? 'diff.properties'
                        : delivered.section === 'relations'
                          ? 'diff.relations'
                          : 'common.details',
                  )}
                </small>
              ) : (
                <p className="secondary">{t(locale, 'ui.referenceOnly')}</p>
              )}
              {delivered.range && (
                <small>
                  {t(locale, 'ui.preparedRange', {
                    start: formatNumber(locale, delivered.range.start),
                    end: formatNumber(locale, delivered.range.endExclusive),
                    total: formatNumber(locale, delivered.range.total),
                    unit: t(
                      locale,
                      delivered.range.unit === 'entries' ? 'ui.entries' : 'ui.codePoints',
                    ),
                  })}
                </small>
              )}
            </div>
          ))}
        </section>
      ))}
      {more && <button onClick={onEarlier}>{t(locale, 'ui.older')}</button>}
    </Modal>
  );
}
