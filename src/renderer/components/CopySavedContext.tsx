import { useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import { savedContext } from '../state/local.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, useLocale } from '../ui.js';

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
  const [error, setError] = useState<ErrorCode | null>(null),
    [copied, setCopied] = useState<string | null>(null);
  const identity = object ? `${object.id}:${object.revision}` : null;
  async function copy() {
    if (!object || disabled || (stillCurrent && !stillCurrent())) return;
    let text: string;
    try {
      text = savedContext(session, object, selection?.() ?? null);
    } catch {
      setError('SPACE_MISMATCH');
      return;
    }
    const result = await api.copyText({ text }).catch(() => null);
    if (result?.ok) {
      setCopied(identity);
      setError(null);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  return (
    <div className="copy-saved-context">
      <div className="as-actions">
        <button
          disabled={!object || disabled}
          data-testid={testId || undefined}
          onClick={() => {
            void copy();
          }}
        >
          {t(locale, 'context.copySaved')}
        </button>
        {copied && copied === identity && !disabled && (
          <span role="status">{t(locale, 'common.copied')}</span>
        )}
      </div>
      <small className="secondary">
        {t(locale, disabled ? 'context.saveBeforeCopy' : 'context.singleScope')}
      </small>
      <ErrorNotice code={error} />
    </div>
  );
}
