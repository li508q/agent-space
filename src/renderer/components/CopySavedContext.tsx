import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot } from '../../contracts/core.js';
import { savedContext } from '../state/local.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, useLocale } from '../ui.js';
import { useCopyText } from './useCopyText.js';

export function CopySavedContext({
  api,
  session,
  object,
  disabled = false,
  selection,
  stillCurrent,
  testId = 'copy-saved-context',
}: {
  api: DesktopApi;
  session: SpaceSession;
  object: ObjectSnapshot | null;
  disabled?: boolean;
  selection?: () => string | null;
  stillCurrent?: () => boolean;
  testId?: string | false;
}) {
  const locale = useLocale();
  const identity = object
    ? JSON.stringify([
        session.bindingId,
        session.status.spaceId,
        session.status.instanceId,
        object.id,
        object.revision,
        object.digest,
      ])
    : null;
  const receipt = useCopyText(api, identity, !!object && !disabled);
  async function copy() {
    if (!object || disabled || (stillCurrent && !stillCurrent())) return;
    const selectionAtRequest = selection?.() ?? null;
    const requestStillCurrent = () =>
      (!stillCurrent || stillCurrent()) && (selection?.() ?? null) === selectionAtRequest;
    let text: string;
    try {
      text = savedContext(session, object, selectionAtRequest);
    } catch {
      receipt.fail('SPACE_MISMATCH');
      return;
    }
    await receipt.copy(text, requestStillCurrent);
  }
  return (
    <div className="copy-saved-context">
      <details data-testid={testId ? `${testId}-details` : undefined} className="context-details">
        <summary>{t(locale, 'context.details')}</summary>
        <div className="as-actions">
          <button
            disabled={!object || disabled || receipt.busy}
            data-testid={testId || undefined}
            onClick={() => {
              void copy();
            }}
          >
            {t(locale, 'context.copySaved')}
          </button>
          {receipt.copied && <span role="status">{t(locale, 'common.copied')}</span>}
        </div>
        <small className="secondary">
          {t(locale, disabled ? 'context.saveBeforeCopy' : 'context.singleScope')}
        </small>
      </details>
      <ErrorNotice
        code={receipt.error}
        onRetry={() => {
          void copy();
        }}
      />
    </div>
  );
}
