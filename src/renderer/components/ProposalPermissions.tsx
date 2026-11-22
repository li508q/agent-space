import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSnapshot, WriteResult } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import { t } from '../i18n/index.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import { ErrorNotice, newKey, useLocale, useTaskFactory } from '../ui.js';

const parts = ['title', 'body', 'properties', 'relations'] as const;
const labels = {
  title: 'object.title',
  body: 'diff.body',
  properties: 'diff.properties',
  relations: 'diff.relations',
} as const;
type Part = (typeof parts)[number];
const includesPart = (fields: readonly string[], part: Part) =>
  fields.some(
    (field) => field === part || (part === 'properties' && field.startsWith('properties.')),
  );
const equalFields = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const policyDraft = (object: ObjectSnapshot) => ({
  revision: object.revision,
  baseFields: [...object.policy.protectedFields],
  fields: [...object.policy.protectedFields],
});

/** Human-only control over the existing Core field policy, never an automatic grant expansion. */
export function ProposalPermissions({
  api,
  session,
  object,
  disabled,
  onChanged,
}: {
  api: DesktopApi;
  session: SpaceSession;
  object: ObjectSnapshot;
  disabled: boolean;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory();
  const [draft, setDraft] = useState(() => policyDraft(object));
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const task = useRef<OperationTask<WriteResult> | null>(null);
  const dirty = !equalFields(draft.fields, draft.baseFields);
  const partialFields = !draft.fields.includes('properties')
    ? draft.fields.filter((field) => field.startsWith('properties.'))
    : [];
  useEffect(() => {
    // Never rebase unsaved choices or downgrade to the pre-response snapshot.
    if (!busy && !task.current?.unknown)
      setDraft((current) =>
        equalFields(current.fields, current.baseFields) && object.revision > current.revision
          ? policyDraft(object)
          : current,
      );
  }, [object, busy, dirty]);

  function choose(part: Part, allowed: boolean) {
    setSaved(false);
    setError(null);
    setDraft((current) => {
      const fields = current.fields.filter(
        (field) => field !== part && !(part === 'properties' && field.startsWith('properties.')),
      );
      return { ...current, fields: allowed ? fields : [...fields, part] };
    });
  }
  async function save() {
    if (busy) return;
    if (!task.current || task.current.settled) {
      if (disabled || !dirty) return;
      const input = {
        operationKey: newKey('policy'),
        objectId: object.id,
        expectedRevision: draft.revision,
        policy: { protectedFields: [...draft.fields] },
      };
      task.current = makeTask(input.operationKey, () => api.setPolicy(bound(session, input)));
    }
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const result = await task.current.run();
      if (result.ok) {
        setDraft(policyDraft(result.value.object));
        setSaved(true);
        onChanged();
      } else setError(result.error.code);
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="proposal-permissions" data-testid="proposal-permissions">
      <h3>{t(locale, 'policy.title')}</h3>
      <p className="secondary">{t(locale, 'policy.notice')}</p>
      <fieldset disabled={disabled || busy || !!task.current?.unknown}>
        <legend className="as-sr-only">{t(locale, 'policy.allowed')}</legend>
        {parts.map((part) => (
          <label key={part}>
            <input
              type="checkbox"
              data-testid={`policy-${part}`}
              checked={!includesPart(draft.fields, part)}
              ref={(element) => {
                if (element)
                  element.indeterminate = part === 'properties' && partialFields.length > 0;
              }}
              onChange={(event) => choose(part, event.target.checked)}
            />
            {t(locale, labels[part])}
          </label>
        ))}
        {partialFields.length > 0 && (
          <small className="secondary">
            {t(locale, 'policy.protectedFields', {
              fields: new Intl.ListFormat(locale).format(
                partialFields.map((field) => {
                  const key = field.slice('properties.'.length);
                  return object.content.properties[key]?.label ?? key;
                }),
              ),
            })}
          </small>
        )}
      </fieldset>
      <div className="as-actions">
        <button
          data-testid="save-policy"
          onClick={() => {
            void save();
          }}
          disabled={busy || (!task.current?.unknown && (disabled || !dirty))}
        >
          {t(locale, 'policy.save')}
        </button>
        {(dirty || error) && (
          <button
            disabled={busy || !!task.current?.unknown}
            onClick={() => {
              task.current = null;
              setDraft(policyDraft(object));
              setError(null);
              setSaved(false);
            }}
          >
            {t(locale, 'policy.reload')}
          </button>
        )}
        {saved && <span role="status">{t(locale, 'editor.saved')}</span>}
      </div>
      <ErrorNotice
        code={error}
        onRetry={() => {
          void save();
        }}
      />
    </section>
  );
}

/** A readable policy snapshot is needed when an undo also restores field permissions. */
export function PolicySnapshot({ object }: { object: ObjectSnapshot }) {
  const locale = useLocale();
  return (
    <dl className="policy-snapshot">
      {parts.map((part) => (
        <div key={part}>
          <dt>{t(locale, labels[part])}</dt>
          <dd>
            {t(
              locale,
              includesPart(object.policy.protectedFields, part)
                ? 'policy.protected'
                : 'policy.allowed',
            )}
            {part === 'properties' &&
              !object.policy.protectedFields.includes('properties') &&
              object.policy.protectedFields
                .filter((field) => field.startsWith('properties.'))
                .map((field) => {
                  const key = field.slice('properties.'.length);
                  return (
                    <span className="policy-field-label" key={field}>
                      {object.content.properties[key]?.label ?? key}
                    </span>
                  );
                })}
          </dd>
        </div>
      ))}
    </dl>
  );
}
