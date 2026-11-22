import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectView } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import { t, titleText } from '../i18n/index.js';
import { bound } from '../state/binding.js';
import { ErrorNotice, ObjectMetadata, SafeMarkdown, useLocale } from '../ui.js';
import { CopySavedContext } from './CopySavedContext.js';
import { AcceptedEvidence } from './AcceptedEvidence.js';

export function SourceReader({
  api,
  session,
  reference,
  onBack,
  onOpen,
  onCopyVersion,
  hidden = false,
}: {
  api: DesktopApi;
  session: SpaceSession;
  reference: ObjectRef;
  onBack: () => void;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  onCopyVersion: (view: ObjectView) => void;
  hidden?: boolean;
}) {
  const locale = useLocale();
  const instance = useId();
  const [view, setView] = useState<ObjectView | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [retry, setRetry] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    focused = useRef(false);
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
    if (view && !hidden && !focused.current) {
      heading.current?.focus();
      focused.current = true;
    }
  }, [view, hidden]);
  return (
    <section
      className="source-reader"
      data-testid={hidden ? undefined : 'source-reader'}
      hidden={hidden}
    >
      <header className="document-header">
        <div className="as-actions">
          <button onClick={onBack} data-testid={hidden ? undefined : 'source-back'}>
            <ChevronLeft size={16} />
            {t(locale, 'ui.sourceReturn')}
          </button>
          <span className="secondary">
            {t(locale, reference.mode === 'pinned' ? 'source.citedVersion' : 'ui.currentVersion')}
          </span>
        </div>
        <h1 ref={heading} tabIndex={-1}>
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
              <button
                id={`source-current-${instance}`}
                onClick={() =>
                  onOpen(
                    { mode: 'current', objectId: reference.objectId },
                    `source-current-${instance}`,
                  )
                }
              >
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
        {view && (
          <CopySavedContext
            api={api}
            session={session}
            object={view.object}
            testId={hidden ? false : 'copy-source-context'}
          />
        )}
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
            <details onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}>
              <summary>{t(locale, 'evidence.title')}</summary>
              {evidenceOpen && (
                <AcceptedEvidence
                  api={api}
                  session={session}
                  objectId={view.object.id}
                  revision={view.object.revision}
                  changeId={view.object.changeId}
                  onOpen={onOpen}
                />
              )}
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
