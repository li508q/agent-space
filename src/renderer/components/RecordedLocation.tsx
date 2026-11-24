import { Copy } from 'lucide-react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot } from '../../contracts/core.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, useLocale } from '../ui.js';
import { useCopyText } from './useCopyText.js';

/** Reveal keyboard focus inside the visible part of the body scrollport. */
function revealLocationCopy(button: HTMLButtonElement) {
  if (document.activeElement !== button || !button.matches(':focus-visible')) return;
  const port = button.closest<HTMLElement>('.as-scroll-region');
  if (!port) return;
  const clip = { top: 0, bottom: innerHeight };
  for (
    let parent: HTMLElement | null = button.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (!/auto|scroll|hidden|clip/.test(style.overflowY)) continue;
    const rect = parent.getBoundingClientRect();
    clip.top = Math.max(clip.top, rect.top + (parseFloat(style.borderTopWidth) || 0));
    clip.bottom = Math.min(clip.bottom, rect.bottom - (parseFloat(style.borderBottomWidth) || 0));
  }
  const rect = button.getBoundingClientRect(),
    style = getComputedStyle(button),
    outset = Math.max(
      0,
      (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0),
    );
  if (rect.height + 2 * outset > clip.bottom - clip.top) return;
  if (rect.top - outset < clip.top) port.scrollTop += Math.floor(rect.top - outset - clip.top);
  else if (rect.bottom + outset > clip.bottom)
    port.scrollTop += Math.ceil(rect.bottom + outset - clip.bottom);
}

export function RecordedLocation({
  api,
  session,
  object,
  disabled = false,
  testId = 'recorded-location',
}: {
  api: DesktopApi;
  session: SpaceSession;
  object: ObjectSnapshot;
  disabled?: boolean;
  testId?: string | false;
}) {
  const locale = useLocale(),
    locator = object.origin.locator ?? '';
  const bound =
    object.spaceId === session.status.spaceId && object.instanceId === session.status.instanceId;
  const identity = JSON.stringify([
    session.bindingId,
    object.spaceId,
    object.instanceId,
    object.id,
    object.revision,
    object.digest,
    object.origin.mode,
    locator,
  ]);
  const copy = useCopyText(api, identity, bound && !!locator && !disabled);
  if (object.origin.mode === 'managed') return null;
  return (
    <section className="recorded-location" data-testid={testId || undefined}>
      <h3>{t(locale, 'location.title')}</h3>
      <p className="secondary">
        {t(
          locale,
          object.origin.mode === 'imported-copy'
            ? 'location.importedNotice'
            : 'location.externalNotice',
        )}
      </p>
      <small>{t(locale, 'location.version', { version: object.revision })}</small>
      {locator ? (
        <code
          className="recorded-location-value as-wrap"
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {locator}
        </code>
      ) : (
        <p className="secondary">{t(locale, 'location.missing')}</p>
      )}
      <div className="as-actions">
        <button
          data-testid={testId ? `${testId}-copy` : undefined}
          disabled={!bound || !locator || disabled || copy.busy}
          onFocus={(event) => {
            const button = event.currentTarget;
            revealLocationCopy(button);
            requestAnimationFrame(() => revealLocationCopy(button));
          }}
          onClick={() => {
            void copy.copy(locator);
          }}
        >
          <Copy size={16} aria-hidden="true" />
          {t(locale, 'location.copy')}
        </button>
        {copy.copied && <span role="status">{t(locale, 'common.copied')}</span>}
      </div>
      <ErrorNotice
        code={bound ? copy.error : 'SPACE_MISMATCH'}
        onRetry={() => {
          void copy.copy(locator);
        }}
      />
    </section>
  );
}
