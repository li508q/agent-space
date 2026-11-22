import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorCodes } from '../../src/contracts/errors.js';
import {
  I18nError,
  assertDictionaryParity,
  dictionaries,
  formatCount,
  formatDate,
  formatDateTime,
  formatNumber,
  getErrorCopy,
  localeNames,
  messageKeys,
  resolveSystemLocale,
  supportedLocales,
  t,
  titleText,
} from '../../src/renderer/i18n/index.js';

const runtimeT = t as unknown as (locale: unknown, key: unknown, ...args: unknown[]) => string;
const failsWith = (code: I18nError['code']) => (error: unknown) =>
  error instanceof I18nError && error.code === code;

// Compile-time integration examples. Do not execute invalid calls.
function translationTypes(): void {
  t('ja', 'editor.savedAt', { time: '14:32' });
  t('es', 'source.version', { version: 3 });
  // @ts-expect-error Unknown product keys are not accepted.
  t('en', 'nav.missing');
  // @ts-expect-error Required interpolation cannot be omitted.
  t('en', 'editor.savedAt');
  // @ts-expect-error Extra interpolation is not part of the message.
  t('en', 'editor.savedAt', { time: '14:32', target: 'note' });
  // @ts-expect-error Plain messages do not take arbitrary parameters.
  t('en', 'editor.saved', {});
  // @ts-expect-error Interpolation values are text or finite numbers, not booleans.
  t('en', 'source.version', { version: true });
  // @ts-expect-error Unsupported locales require explicit resolution at startup.
  t('fr', 'nav.library');
}
void translationTypes;

test('all five dictionaries have exact keys and interpolation contracts', () => {
  assert.deepEqual(supportedLocales, ['en', 'zh-CN', 'ja', 'ko', 'es']);
  assert.equal(new Set(messageKeys).size, messageKeys.length);
  for (const locale of supportedLocales) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), [...messageKeys].sort());
    assertDictionaryParity(locale, dictionaries[locale]);
    assert.ok(localeNames[locale].length > 0);
    // Exercise every message in every locale with authored, non-recursive values.
    for (const key of messageKeys) {
      const placeholders = [...dictionaries.en[key].matchAll(/\{([^{}]+)\}/g)].map(
        (match) => match[1]!,
      );
      const params = Object.fromEntries(
        placeholders.map((name) => [name, `sample {${name}} <text>`]),
      );
      const result = placeholders.length ? runtimeT(locale, key, params) : runtimeT(locale, key);
      assert.ok(result.trim().length > 0, `${locale}/${key}`);
      for (const name of placeholders) assert.ok(result.includes(`sample {${name}} <text>`));
    }
  }
});

test('parity validation catches omission, extra keys, empty copy, and renamed placeholders', () => {
  const missing: Record<string, string> = { ...dictionaries.ja };
  delete missing['editor.saved'];
  assert.throws(() => assertDictionaryParity('ja', missing), failsWith('INVALID_DICTIONARY'));
  assert.throws(
    () => assertDictionaryParity('ko', { ...dictionaries.ko, invented: 'copy' }),
    failsWith('INVALID_DICTIONARY'),
  );
  assert.throws(
    () => assertDictionaryParity('es', { ...dictionaries.es, 'editor.saved': ' ' }),
    failsWith('INVALID_DICTIONARY'),
  );
  assert.throws(
    () =>
      assertDictionaryParity('zh-CN', {
        ...dictionaries['zh-CN'],
        'editor.savedAt': '保存于 {when}',
      }),
    failsWith('INVALID_DICTIONARY'),
  );
});

test('unknown keys/locales and malformed interpolation fail instead of falling back', () => {
  for (const locale of supportedLocales) {
    assert.throws(() => runtimeT(locale, 'nav.missing'), failsWith('MISSING_MESSAGE'));
    assert.throws(() => runtimeT(locale, 'constructor'), failsWith('MISSING_MESSAGE'));
    assert.throws(() => runtimeT(locale, 'editor.savedAt'), failsWith('INVALID_INTERPOLATION'));
    assert.throws(
      () => runtimeT(locale, 'editor.savedAt', { time: '14:32', extra: 'x' }),
      failsWith('INVALID_INTERPOLATION'),
    );
    assert.throws(() => runtimeT(locale, 'editor.saved', {}), failsWith('INVALID_INTERPOLATION'));
    assert.throws(
      () => runtimeT(locale, 'source.version', { version: Number.NaN }),
      failsWith('INVALID_INTERPOLATION'),
    );
  }
  assert.throws(() => runtimeT('fr', 'nav.library'), failsWith('UNSUPPORTED_LOCALE'));
});

test('authored titles, reasons, labels, braces, and markup-like text remain unchanged', () => {
  const authored = '  状態 / 상태 / razón {time} <img src=x> e\u0301 editor.saving  ';
  for (const locale of supportedLocales) {
    assert.equal(titleText(locale, authored), authored);
    assert.equal(titleText(locale, 'editor.saving'), 'editor.saving');
    assert.equal(titleText(locale, ' '), ' ');
    assert.ok(t(locale, 'common.openNamed', { title: authored }).includes(authored));
    assert.ok(t(locale, 'editor.savedAt', { time: authored }).includes(authored));
    assert.equal(titleText(locale, ''), t(locale, 'object.untitledNote'));
    assert.equal(titleText(locale, '', 'record'), t(locale, 'object.untitledRecord'));
  }
  // The API formats products, not arbitrary author strings as lookup keys.
  assert.throws(() => runtimeT('en', authored), failsWith('MISSING_MESSAGE'));
});

test('quantity messages use locale grammar and locale number formatting, including zero and many', () => {
  const expected = {
    en: ['1 item', '2 items'],
    'zh-CN': ['1 项', '2 项'],
    ja: ['1件', '2件'],
    ko: ['1개 항목', '2개 항목'],
    es: ['1 elemento', '2 elementos'],
  } as const;
  for (const locale of supportedLocales) {
    assert.equal(formatCount(locale, 'items', 1), expected[locale][0]);
    assert.equal(formatCount(locale, 'items', 2), expected[locale][1]);
    for (const unit of ['items', 'pendingProposals', 'changes', 'sources', 'files'] as const) {
      assert.ok(formatCount(locale, unit, 0).includes('0'));
      assert.ok(formatCount(locale, unit, 12_345).includes(formatNumber(locale, 12_345)));
    }
  }
  assert.equal(formatCount('en', 'pendingProposals', 0), '0 proposals need review');
  assert.equal(formatCount('es', 'items', 1_000_000), '1.000.000 elementos');
  assert.equal(formatNumber('es', 12_345.5), '12.345,5');
  assert.equal(formatNumber('en', 12_345.5), '12,345.5');
  assert.equal(t('es', 'source.version', { version: '001' }), 'Versión 001');
  for (const invalid of [-1, 1.5, Infinity, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatCount('en', 'items', invalid), failsWith('INVALID_NUMBER'));
  }
  assert.throws(() => formatNumber('en', Infinity), failsWith('INVALID_NUMBER'));
  assert.throws(() => formatCount('en', 'unknown' as 'items', 1), failsWith('MISSING_MESSAGE'));
});

test('calendar dates and instants retain their distinct meaning in all five locales', () => {
  const expected = {
    en: 'November 23, 2026',
    'zh-CN': '2026年11月23日',
    ja: '2026年11月23日',
    ko: '2026년 11월 23일',
    es: '23 de noviembre de 2026',
  } as const;
  for (const locale of supportedLocales) {
    assert.equal(formatDate(locale, '2026-11-23', 'long'), expected[locale]);
    // The same instant falls on different days in the two explicitly chosen zones.
    assert.equal(
      formatDateTime(locale, '2026-11-22T17:30:00Z', 'Asia/Shanghai', {
        dateStyle: 'long',
        timeStyle: undefined,
      }),
      expected[locale],
    );
    assert.equal(
      formatDateTime(locale, '2026-11-22T17:30:00Z', 'UTC', {
        dateStyle: 'long',
        timeStyle: undefined,
      }),
      formatDate(locale, '2026-11-22', 'long'),
    );
    const instant = new Date('2026-11-22T17:30:00Z');
    assert.equal(
      formatDateTime(locale, instant, 'Asia/Shanghai'),
      formatDateTime(locale, instant.getTime(), 'Asia/Shanghai'),
    );
    assert.ok(formatDate(locale, '2024-02-29').length > 0);
  }
});

test('invalid dates and implicit zones are rejected, not silently normalized', () => {
  for (const invalid of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-11-00', '11/23/2026']) {
    assert.throws(() => formatDate('en', invalid), failsWith('INVALID_DATE'));
  }
  assert.throws(
    () => formatDateTime('en', '2026-11-23T09:00:00', 'UTC'),
    failsWith('INVALID_DATE'),
  );
  assert.throws(
    () => formatDateTime('en', '2026-02-30T09:00:00Z', 'UTC'),
    failsWith('INVALID_DATE'),
  );
  assert.throws(() => formatDateTime('en', new Date(Number.NaN), 'UTC'), failsWith('INVALID_DATE'));
  assert.throws(() => formatDateTime('en', Date.now(), ''), failsWith('INVALID_TIME_ZONE'));
  assert.throws(
    () => formatDateTime('en', Date.now(), 'Not/A_Time_Zone'),
    failsWith('INVALID_TIME_ZONE'),
  );
});

test('instant clock components cannot silently roll into the next day', () => {
  const invalid = [
    '2026-11-23T24:00:00Z',
    '2026-11-23T24:00Z',
    '2026-11-23T25:00:00+08:00',
    '2026-11-23T23:60:00Z',
    '2026-11-23T23:59:60Z',
    '2026-11-23T10:00:00+24:00',
    '2026-11-23T10:00:00+08:60',
  ];
  for (const locale of supportedLocales) {
    for (const value of invalid) {
      assert.throws(() => formatDateTime(locale, value, 'UTC'), failsWith('INVALID_DATE'));
    }
    const dateOnly = { dateStyle: 'long', timeStyle: undefined } as const;
    for (const value of ['2026-11-23T00:00:00Z', '2026-11-23T23:59:59.999Z']) {
      assert.equal(
        formatDateTime(locale, value, 'UTC', dateOnly),
        formatDate(locale, '2026-11-23', 'long'),
      );
    }
    // An explicit offset may legitimately place the same instant on the next UTC day.
    assert.equal(
      formatDateTime(locale, '2026-11-23T23:59:59-01:00', 'UTC', dateOnly),
      formatDate(locale, '2026-11-24', 'long'),
    );
  }
});

test('every stable error code has actionable localized copy and a details entry', () => {
  for (const locale of supportedLocales) {
    for (const code of errorCodes) {
      const rawFailure = { code, message: 'SQLITE_BUSY: /private/example IPC stack trace' };
      const copy = getErrorCopy(locale, rawFailure.code);
      assert.equal(copy.code, code);
      assert.ok(copy.message.length > 0);
      assert.equal(copy.detailsLabel, t(locale, 'common.details'));
      assert.ok(!copy.message.includes('SQLITE'));
      assert.ok(!copy.message.includes(rawFailure.message));
      assert.ok(!copy.message.includes('/private/'));
    }
    assert.notEqual(t(locale, 'editor.saved'), t(locale, 'editor.draftKept'));
    assert.notEqual(t(locale, 'proposal.pending'), t(locale, 'knowledge.needsReview'));
    assert.notEqual(t(locale, 'proposal.applied'), t(locale, 'proposal.noteCreated'));
  }
  assert.throws(
    () => getErrorCopy('en', 'UNRECOGNIZED' as 'INVALID_INPUT'),
    failsWith('UNKNOWN_ERROR_CODE'),
  );
});

test('startup language matching is explicit and does not weaken strict translation lookup', () => {
  assert.equal(resolveSystemLocale(['es-MX', 'en-US']), 'es');
  assert.equal(resolveSystemLocale(['ja-JP']), 'ja');
  assert.equal(resolveSystemLocale(['ko-KR']), 'ko');
  assert.equal(resolveSystemLocale(['zh-Hans-SG']), 'zh-CN');
  assert.equal(resolveSystemLocale(['zh-Hant-TW', 'ja']), 'ja');
  assert.equal(resolveSystemLocale(['fr-FR']), 'en');
  assert.equal(resolveSystemLocale(['not_a_locale', 'es']), 'es');
  assert.equal(resolveSystemLocale([]), 'en');
  assert.throws(() => runtimeT('es-MX', 'nav.library'), failsWith('UNSUPPORTED_LOCALE'));
});
