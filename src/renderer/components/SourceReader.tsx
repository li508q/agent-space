import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectView } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { t, titleText } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import { ErrorNotice, ObjectMetadata, SafeMarkdown, useLocale } from '../ui.js';

export function SourceReader({
  api,
  session,
  reference,
  onBack,
  onOpen,
  onCopyVersion,
}: {
  api: DesktopApi;
  session: SpaceSession;
  reference: ObjectRef;
  onBack: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onCopyVersion: (view: ObjectView) => void;
}) {
  const locale = useLocale();
  const [view, setView] = useState<ObjectView | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setView(null);
    setError(null);
    void api
      .readObject(
        bound(session, {
          objectId: reference.objectId,
          ...(reference.mode === 'pinned' ? { revision: reference.revision } : {}),
        }),
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
  }, [api, session.bindingId, reference, retry]);
  useEffect(() => {
    document.getElementById('source-heading')?.focus();
  }, [view]);
  return (
    <section className="source-reader" data-testid="source-reader">
      <header className="document-header">
        <div className="as-actions">
          <button onClick={onBack} data-testid="source-back">
            <ChevronLeft size={16} />
            {t(locale, 'ui.sourceReturn')}
          </button>
          <span className="secondary">
            {t(locale, reference.mode === 'pinned' ? 'source.citedVersion' : 'ui.currentVersion')}
          </span>
        </div>
        <h1 id="source-heading" tabIndex={-1}>
          {view
            ? titleText(locale, view.object.content.title, view.object.kind)
            : t(locale, 'ui.loading')}
        </h1>
        {view && (
          <div className="as-actions">
            <span>{t(locale, 'source.version', { version: view.object.revision })}</span>
            <span className="secondary">
              {t(locale, reference.mode === 'pinned' ? 'history.historical' : 'editor.preview')}
            </span>
            {reference.mode === 'pinned' && (
              <button onClick={() => onOpen({ mode: 'current', objectId: reference.objectId })}>
                {t(locale, 'source.viewCurrent')}
              </button>
            )}
            <button onClick={() => onCopyVersion(view)}>
              {t(locale, 'history.createNoteFromVersion')}
            </button>
          </div>
        )}
        {reference.mode === 'pinned' && reference.locator && (
          <p className="secondary as-wrap">{reference.locator}</p>
        )}
        <ErrorNotice code={error} onRetry={() => setRetry((value) => value + 1)} />
      </header>
      {view && (
        <div className="document-scroll as-scroll-region">
          <div className="document-sheet">
            <article className="as-prose">
              <SafeMarkdown api={api} text={view.object.content.body} />
            </article>
            <ObjectMetadata
              api={api}
              session={session}
              content={view.object.content}
              onOpen={onOpen}
            />
          </div>
        </div>
      )}
    </section>
  );
}
