import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../contracts/app.js';
import type { ErrorCode } from '../contracts/errors.js';
import type { ObjectContent, ObjectRef, PinnedRef } from '../contracts/schema.js';
import type { ObjectSummary, ObjectView } from '../contracts/core.js';
import { useState } from 'react';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  getErrorCopy,
  t,
  titleText,
  type Locale,
} from './i18n/index.js';
import { bound } from './state/binding.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Result } from '../contracts/errors.js';
import type { OperationTask } from './state/operation.js';
import markUrl from './assets/mark.svg';

export const LocaleContext = createContext<Locale>('en');
export const ReferenceRefreshContext = createContext(0);
export type MakeTask = <T>(key: string, send: () => Promise<Result<T>>) => OperationTask<T>;
export const TaskContext = createContext<MakeTask | null>(null);
export function useTaskFactory() {
  const factory = useContext(TaskContext);
  if (!factory) throw new Error('A bound operation provider is required.');
  return factory;
}
export const useLocale = () => useContext(LocaleContext);
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const newKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const pin = (id: string, revision: number): PinnedRef => ({
  mode: 'pinned',
  objectId: id,
  revision,
});

export function Brand() {
  return <img className="brand-mark" src={markUrl} alt="" aria-hidden="true" />;
}

export function Time({ value }: { value: string }) {
  const locale = useLocale();
  return <time dateTime={value}>{formatDateTime(locale, value, localZone())}</time>;
}

export function ErrorNotice({ code, onRetry }: { code: ErrorCode | null; onRetry?: () => void }) {
  const locale = useLocale();
  if (!code) return null;
  const copy = getErrorCopy(locale, code);
  return (
    <div className="error-notice" role="alert" data-testid="error-notice">
      <p>{copy.message}</p>
      <div className="as-actions">
        {onRetry && <button onClick={onRetry}>{t(locale, 'common.retry')}</button>}
        <details>
          <summary>{copy.detailsLabel}</summary>
          <code>{code}</code>
        </details>
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  testId,
  onComposing,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  onComposing?: (composing: boolean) => void;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const composing = useRef(false),
    closeAfterComposition = useRef(false);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      aria-label={title}
      data-testid={testId}
      onCompositionStartCapture={() => {
        composing.current = true;
        onComposing?.(true);
      }}
      onCompositionEndCapture={() => {
        queueMicrotask(() => {
          composing.current = false;
          onComposing?.(false);
          if (closeAfterComposition.current) {
            closeAfterComposition.current = false;
            closeHandler.current();
          }
        });
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!composing.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={t(locale, 'common.close')}
          onClick={() => {
            if (composing.current) closeAfterComposition.current = true;
            else onClose();
          }}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function SafeMarkdown({ text, api }: { text: string; api: DesktopApi }) {
  const [error, setError] = useState<ErrorCode | null>(null);
  return (
    <>
      <ErrorNotice code={error} />
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => {
          if (key !== 'href') return '';
          try {
            const parsed = new URL(url);
            return ['https:', 'http:'].includes(parsed.protocol) ? url : '';
          } catch {
            return '';
          }
        }}
        components={{
          img: ({ alt }) => (alt ? <span className="media-caption">{alt}</span> : null),
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void api
                    .openExternal({ url: href })
                    .then((result) => {
                      setError(result.ok ? null : result.error.code);
                    })
                    .catch(() => setError('OPERATION_UNKNOWN'));
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </Markdown>
    </>
  );
}

export function fieldText(locale: Locale, field: ObjectContent['properties'][string]): string {
  if (field.value === null) return t(locale, 'record.notSet');
  if (field.type === 'number') return formatNumber(locale, field.value);
  if (field.type === 'boolean') return t(locale, field.value ? 'ui.yes' : 'ui.no');
  if (field.type === 'date') return formatDate(locale, field.value);
  return field.value === '' ? t(locale, 'record.emptyText') : field.value;
}
export function fieldKindText(locale: Locale, type: ObjectContent['properties'][string]['type']) {
  const keys = {
    text: 'record.text',
    number: 'record.number',
    boolean: 'record.boolean',
    date: 'record.date',
    select: 'record.select',
  } as const;
  return t(locale, keys[type]);
}

export function RefLink({
  api,
  session,
  reference,
  onOpen,
  id,
  passive = false,
  summary,
}: {
  api: DesktopApi;
  session: SpaceSession;
  reference: ObjectRef;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
  id?: string;
  passive?: boolean;
  summary?: Pick<ObjectSummary, 'ref' | 'title' | 'kind'>;
}) {
  const locale = useLocale();
  const [view, setView] = useState<ObjectView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const refresh = useContext(ReferenceRefreshContext);
  const referenceIdentity = useRef('');
  const generatedId = useId(),
    domId = id ?? `reference-${generatedId}`;
  const revision = reference.mode === 'pinned' ? reference.revision : undefined;
  const currentRefresh = reference.mode === 'current' ? refresh : 0;
  const known =
    reference.mode === 'pinned' &&
    summary?.ref.objectId === reference.objectId &&
    summary.ref.revision === reference.revision
      ? summary
      : null;
  useEffect(() => {
    if (known) return;
    let active = true;
    const identity = `${session.bindingId}/${reference.objectId}/${revision ?? 'current'}`;
    if (referenceIdentity.current !== identity) {
      referenceIdentity.current = identity;
      setView(null);
      setUnavailable(false);
    }
    setUnavailable(false);
    void api
      .readObject(
        bound(session, { objectId: reference.objectId, ...(revision ? { revision } : {}) }),
      )
      .then((result) => {
        if (active) {
          if (result.ok) {
            setView(result.value);
            setUnavailable(false);
          } else {
            setView(null);
            setUnavailable(true);
          }
        }
      })
      .catch(() => {
        if (active) {
          setView(null);
          setUnavailable(true);
        }
      });
    return () => {
      active = false;
    };
  }, [api, session.bindingId, reference.objectId, revision, currentRefresh, known]);
  const text = known
    ? titleText(locale, known.title, known.kind)
    : view
      ? titleText(locale, view.object.content.title, view.object.kind)
      : t(locale, unavailable ? 'source.unavailable' : 'ui.loading');
  return (
    <span className="reference">
      {passive ? (
        <span>{text}</span>
      ) : (
        <button id={domId} className="text-button" onClick={() => onOpen(reference, domId)}>
          {text}
        </button>
      )}
      <small>
        {reference.mode === 'pinned'
          ? t(locale, 'source.version', { version: reference.revision })
          : t(locale, 'relation.followCurrent')}
      </small>
      {reference.mode === 'pinned' && reference.locator && (
        <small className="as-wrap">{reference.locator}</small>
      )}
    </span>
  );
}

export function ObjectMetadata({
  content,
  api,
  session,
  onOpen,
}: {
  content: ObjectContent;
  api: DesktopApi;
  session: SpaceSession;
  onOpen: (reference: ObjectRef, trigger?: string) => void;
}) {
  const locale = useLocale();
  const relationLabels = {
    belongs_to: 'relation.inProject',
    related: 'relation.related',
    source: 'relation.source',
    uses: 'relation.usesAsset',
    continues_from: 'project.continuation',
  } as const;
  const instance = useId();
  return (
    <div className="metadata">
      <section>
        <h3>{t(locale, 'diff.properties')}</h3>
        {Object.entries(content.properties).map(([key, field]) => (
          <dl className="property-row" key={key}>
            <dt>{field.label}</dt>
            <dd>{fieldText(locale, field)}</dd>
          </dl>
        ))}
      </section>
      <section>
        <h3>{t(locale, 'diff.relations')}</h3>
        {content.relations.map((relation) => (
          <div className="relation-row" key={relation.id}>
            <span>{t(locale, relationLabels[relation.predicate])}</span>
            <RefLink
              api={api}
              session={session}
              reference={relation.target}
              onOpen={onOpen}
              id={`relation-${instance}-${relation.id}`}
            />
          </div>
        ))}
        {!content.relations.some((relation) => relation.predicate === 'source') && (
          <p className="secondary">{t(locale, 'source.none')}</p>
        )}
      </section>
    </div>
  );
}

export function noteFromVersion(view: ObjectView, locale: Locale): ObjectContent {
  const object = view.object;
  let body = object.content.body;
  if (object.kind !== 'document') {
    const fields = Object.values(object.content.properties)
      .map((field) => `- ${field.label}: ${fieldText(locale, field)}`)
      .join('\n');
    const references = object.content.relations
      .map((relation) => {
        const target = view.relationTargets.find((entry) => entry.relationId === relation.id);
        return `- ${target?.title ?? relation.target.objectId}`;
      })
      .join('\n');
    body = [body, fields, references].filter(Boolean).join('\n\n');
  }
  return {
    title: object.content.title,
    body,
    properties: {},
    relations: [
      { id: crypto.randomUUID(), predicate: 'source', target: pin(object.id, object.revision) },
    ],
  };
}
