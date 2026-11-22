import { useRef, useState, useSyncExternalStore } from 'react';
import type { DesktopApi } from '../../contracts/app.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { EditorSession } from '../state/editor.js';
import {
  fieldInputs,
  newField,
  parseFields,
  type FieldInput,
  type FieldProblem,
  type FieldType,
} from '../state/material.js';
import { t } from '../i18n/index.js';
import { ErrorNotice, fieldKindText, Modal, useLocale } from '../ui.js';

const types: FieldType[] = ['text', 'number', 'boolean', 'date', 'select'];
const problemKeys = {
  label: 'fields.labelError',
  number: 'record.invalidNumber',
  date: 'fields.dateError',
  select: 'fields.selectError',
  options: 'fields.optionsError',
  limit: 'fields.limitError',
} as const;

export function PropertiesEditor({
  editor,
  api,
  onClose,
}: {
  editor: EditorSession;
  api: DesktopApi;
  onClose: () => void;
}) {
  const locale = useLocale();
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const original = useRef(fieldInputs(state.content.properties));
  const generation = useRef(state.generation);
  const [rows, setRows] = useState<FieldInput[]>(() => structuredClone(original.current));
  const [problems, setProblems] = useState<Record<string, FieldProblem>>({});
  const [error, setError] = useState<ErrorCode | null>(null);
  const [discard, setDiscard] = useState(false),
    [copied, setCopied] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(original.current);
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  const problemFor = (key: string) => (Object.hasOwn(problems, key) ? problems[key] : undefined);

  function change(key: string, patch: Partial<FieldInput>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setProblems((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setCopied(false);
  }
  async function requestClose() {
    await editor.afterComposition();
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function apply() {
    await editor.afterComposition();
    const current = editor.getSnapshot();
    if (current.locked) return;
    if (current.generation !== generation.current) {
      setError('STALE_REVISION');
      return;
    }
    const result = parseFields(rows, separator);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    editor.edit({ ...current.content, properties: result.properties });
    onClose();
  }
  function reload() {
    const current = editor.getSnapshot();
    generation.current = current.generation;
    original.current = fieldInputs(current.content.properties);
    setRows(structuredClone(original.current));
    setProblems({});
    setError(null);
    setDiscard(false);
  }
  async function copy() {
    const text = rows
      .map(
        (row) =>
          `${row.label} (${fieldKindText(locale, row.type)}): ${row.unset ? t(locale, 'record.notSet') : row.text}${row.type === 'select' ? `\n${row.options.join('\n')}` : ''}`,
      )
      .join('\n\n');
    const result = await api.copyText({ text }).catch(() => null);
    if (result?.ok) setCopied(true);
    else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  return (
    <Modal
      title={t(locale, 'fields.edit')}
      onClose={() => {
        void requestClose();
      }}
      testId="properties-editor"
    >
      <p className="secondary">{t(locale, 'fields.identity')}</p>
      <p className="secondary">{t(locale, 'fields.typeReset')}</p>
      {dirty && (
        <p className="attention" role="status">
          {t(locale, 'fields.unapplied')}
        </p>
      )}
      <ErrorNotice code={error} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!state.composing) void apply();
        }}
        onCompositionStartCapture={() => editor.setComposing(true)}
        onCompositionEndCapture={() => queueMicrotask(() => editor.setComposing(false))}
      >
        <fieldset className="metadata-form" disabled={state.locked || discard}>
          <legend className="as-sr-only">{t(locale, 'diff.properties')}</legend>
          {!rows.length && <p className="secondary">{t(locale, 'fields.emptyFields')}</p>}
          {rows.map((row) => (
            <fieldset key={row.key} className="field-editor" data-testid={`field-${row.key}`}>
              <legend>{row.label || t(locale, 'record.fieldLabel')}</legend>
              <div className="field-definition">
                <label>
                  {t(locale, 'record.fieldLabel')}
                  <input
                    value={row.label}
                    maxLength={120}
                    data-testid="field-label"
                    required
                    aria-invalid={problemFor(row.key) === 'label'}
                    aria-describedby={
                      problemFor(row.key) === 'label' ? `field-error-${row.key}` : undefined
                    }
                    onChange={(event) => change(row.key, { label: event.target.value })}
                  />
                </label>
                <label>
                  {t(locale, 'fields.type')}
                  <select
                    value={row.type}
                    data-testid="field-type"
                    onChange={(event) => {
                      const type = event.target.value as FieldType;
                      change(row.key, {
                        type,
                        unset: true,
                        text: '',
                        options: type === 'select' ? [''] : [],
                      });
                    }}
                  >
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {fieldKindText(locale, type)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {row.type === 'select' && (
                <div className="field-options">
                  {row.options.map((option, index) => (
                    <div className="option-row" key={index}>
                      <label>
                        {t(locale, 'fields.option', { count: index + 1 })}
                        <input
                          value={option}
                          maxLength={100}
                          data-testid="field-option"
                          aria-invalid={problemFor(row.key) === 'options'}
                          onChange={(event) =>
                            change(row.key, {
                              options: row.options.map((value, i) =>
                                i === index ? event.target.value : value,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          change(row.key, { options: row.options.filter((_, i) => i !== index) })
                        }
                      >
                        {t(locale, 'common.remove')}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={row.options.length >= 50}
                    onClick={() => change(row.key, { options: [...row.options, ''] })}
                  >
                    {t(locale, 'fields.addOption')}
                  </button>
                </div>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={row.unset}
                  data-testid="field-unset"
                  onChange={(event) => change(row.key, { unset: event.target.checked })}
                />
                {t(locale, 'record.notSet')}
              </label>
              <label>
                {t(locale, 'fields.value')}
                {row.type === 'boolean' || row.type === 'select' ? (
                  <select
                    disabled={row.unset}
                    value={row.unset ? '' : row.text}
                    data-testid="field-value"
                    aria-invalid={problemFor(row.key) === 'select'}
                    aria-describedby={
                      problemFor(row.key) === 'select' ? `field-error-${row.key}` : undefined
                    }
                    onChange={(event) => change(row.key, { text: event.target.value })}
                  >
                    <option value="" disabled>
                      {t(locale, 'record.notSet')}
                    </option>
                    {row.type === 'boolean' ? (
                      <>
                        <option value="true">{t(locale, 'ui.yes')}</option>
                        <option value="false">{t(locale, 'ui.no')}</option>
                      </>
                    ) : (
                      row.options.map((option, index) => (
                        <option key={index} value={option}>
                          {option}
                        </option>
                      ))
                    )}
                  </select>
                ) : row.type === 'text' ? (
                  <textarea
                    disabled={row.unset}
                    value={row.unset ? '' : row.text}
                    rows={3}
                    maxLength={20_000}
                    data-testid="field-value"
                    aria-invalid={!!problemFor(row.key) && problemFor(row.key) !== 'label'}
                    aria-describedby={problemFor(row.key) ? `field-error-${row.key}` : undefined}
                    onChange={(event) => change(row.key, { text: event.target.value })}
                  />
                ) : (
                  <input
                    disabled={row.unset}
                    value={row.unset ? '' : row.text}
                    data-testid="field-value"
                    inputMode={row.type === 'number' ? 'decimal' : 'text'}
                    maxLength={100}
                    placeholder={row.type === 'date' ? 'YYYY-MM-DD' : undefined}
                    aria-invalid={!!problemFor(row.key) && problemFor(row.key) !== 'label'}
                    aria-describedby={problemFor(row.key) ? `field-error-${row.key}` : undefined}
                    onChange={(event) => change(row.key, { text: event.target.value })}
                  />
                )}
              </label>
              {row.type === 'text' && !row.unset && row.text === '' && (
                <small className="secondary">{t(locale, 'record.emptyText')}</small>
              )}
              {row.type === 'number' && (
                <small className="secondary">
                  {t(locale, 'fields.decimalHint', { separator })}
                </small>
              )}
              {problemFor(row.key) && (
                <p className="field-error" role="alert" id={`field-error-${row.key}`}>
                  {t(locale, problemKeys[problemFor(row.key)!])}
                </p>
              )}
              <div className="as-actions">
                <button
                  type="button"
                  disabled={row.unset}
                  onClick={() => change(row.key, { unset: true })}
                >
                  {t(locale, 'record.clearValue')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) => current.filter((field) => field.key !== row.key))
                  }
                >
                  {t(locale, 'common.remove')}
                </button>
                <details className="push">
                  <summary>{t(locale, 'common.technicalDetails')}</summary>
                  <code>{row.key}</code>
                </details>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            data-testid="add-field"
            disabled={rows.length >= 64}
            onClick={() => setRows((current) => [...current, newField()])}
          >
            {t(locale, 'fields.add')}
          </button>
        </fieldset>
        <div className="metadata-actions as-actions">
          <button
            type="submit"
            className="primary"
            data-testid="apply-fields"
            disabled={state.locked || discard}
          >
            {t(locale, 'fields.apply')}
          </button>
          <button
            type="button"
            onClick={() => {
              void requestClose();
            }}
          >
            {t(locale, 'common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              void copy();
            }}
          >
            {t(locale, 'common.copy')}
          </button>
          {copied && <span role="status">{t(locale, 'common.copied')}</span>}
          {error === 'STALE_REVISION' && (
            <button type="button" onClick={reload}>
              {t(locale, 'metadata.reload')}
            </button>
          )}
        </div>
      </form>
      {discard && (
        <div className="discard-prompt" role="alert">
          <p>{t(locale, 'metadata.discardQuestion')}</p>
          <div className="as-actions">
            <button
              autoFocus
              onClick={() => {
                setDiscard(false);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(
                      '[data-testid="properties-editor"] [data-testid="field-label"]',
                    )
                    ?.focus(),
                );
              }}
            >
              {t(locale, 'metadata.keepEditing')}
            </button>
            <button onClick={onClose}>{t(locale, 'metadata.discard')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
