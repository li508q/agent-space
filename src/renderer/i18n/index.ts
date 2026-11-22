import { errorCodes, type ErrorCode } from '../../contracts/errors.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { es } from './es.js';
import { formatNumber } from './formatters.js';
import { assertDictionaryParity, assertLocale, I18nError, placeholderNames } from './validation.js';
import {
  countUnits,
  supportedLocales,
  type CountMessageKey,
  type CountUnit,
  type Dictionary,
  type Locale,
  type MessageKey,
  type TitleKind,
  type TranslationArgs,
} from './types.js';

export * from './types.js';
export * from './formatters.js';
export { assertDictionaryParity, I18nError } from './validation.js';

export const dictionaries = Object.freeze({
  en,
  'zh-CN': zhCN,
  ja,
  ko,
  es,
} satisfies Record<Locale, Dictionary>);
for (const locale of supportedLocales) assertDictionaryParity(locale, dictionaries[locale]);
export const messageKeys = Object.freeze(Object.keys(en) as MessageKey[]);

/** Product copy only. The result is plain text: render it as text, never as HTML. */
export function t<K extends MessageKey>(
  locale: Locale,
  key: K,
  ...args: TranslationArgs<K>
): string {
  assertLocale(locale);
  if (!Object.hasOwn(dictionaries[locale], key)) {
    throw new I18nError('MISSING_MESSAGE', 'The requested product message is not defined.');
  }
  const template: string = dictionaries[locale][key];
  const expected = placeholderNames(template);
  const rawParams: unknown = args[0];
  if (expected.length === 0) {
    if (args.length !== 0) {
      throw new I18nError('INVALID_INTERPOLATION', 'This message takes no interpolation values.');
    }
    return template;
  }
  if (
    args.length !== 1 ||
    !rawParams ||
    typeof rawParams !== 'object' ||
    Array.isArray(rawParams)
  ) {
    throw new I18nError('INVALID_INTERPOLATION', 'Provide the complete message arguments.');
  }
  const params = rawParams as Record<string, unknown>;
  const actual = Object.keys(params).sort();
  if (actual.length !== expected.length || expected.some((name, index) => name !== actual[index])) {
    throw new I18nError('INVALID_INTERPOLATION', 'Message arguments differ from its placeholders.');
  }
  for (const name of expected) {
    const value = params[name];
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new I18nError(
        'INVALID_INTERPOLATION',
        'Message values must be strings or finite numbers.',
      );
    }
  }
  // One pass only: braces, markup, and key-like authored text stay untouched.
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = params[name] as string | number;
    return typeof value === 'number' ? formatNumber(locale, value) : value;
  });
}

/** Counts are nonnegative safe integers; these five languages use singular/general copy. */
export function formatCount(locale: Locale, unit: CountUnit, count: number): string {
  assertLocale(locale);
  if (!countUnits.some((candidate) => candidate === unit)) {
    throw new I18nError('MISSING_MESSAGE', 'The requested count unit is not defined.');
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new I18nError('INVALID_NUMBER', 'Counts must be nonnegative safe integers.');
  }
  // Spanish's "many" category uses the same general wording as "other" in these messages.
  const form =
    new Intl.PluralRules(locale, { type: 'cardinal' }).select(count) === 'one' ? 'one' : 'other';
  return t(locale, `count.${unit}.${form}` as CountMessageKey, { count });
}

/** Only stable contract codes enter product copy. Raw backend exceptions are not accepted. */
export function getErrorCopy(
  locale: Locale,
  code: ErrorCode,
): Readonly<{
  code: ErrorCode;
  message: string;
  detailsLabel: string;
}> {
  assertLocale(locale);
  if (!errorCodes.some((candidate) => candidate === code)) {
    throw new I18nError('UNKNOWN_ERROR_CODE', 'The error code is not in the stable contract.');
  }
  return Object.freeze({
    code,
    message: t(locale, `error.${code}`),
    detailsLabel: t(locale, 'common.details'),
  });
}

const titleKeys = {
  document: 'object.untitledNote',
  project: 'object.untitledProject',
  record: 'object.untitledRecord',
  asset: 'object.untitledAsset',
} as const satisfies Record<TitleKind, MessageKey>;

/** Never translate, trim, normalize, or overwrite authored text or labels. */
export function titleText(
  locale: Locale,
  authoredTitle: string,
  kind: TitleKind = 'document',
): string {
  assertLocale(locale);
  if (typeof authoredTitle !== 'string' || !Object.hasOwn(titleKeys, kind)) {
    throw new I18nError(
      'INVALID_ARGUMENT',
      'Provide an authored title and a supported object kind.',
    );
  }
  return authoredTitle === '' ? t(locale, titleKeys[kind]) : authoredTitle;
}

/** Startup preference only; explicit t/format calls reject unsupported locales. */
export function resolveSystemLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    let candidate: Intl.Locale;
    try {
      candidate = new Intl.Locale(preference);
    } catch {
      continue;
    }
    const language = candidate.language;
    if (language === 'zh') {
      if (candidate.script === 'Hant' || ['TW', 'HK', 'MO'].includes(candidate.region ?? ''))
        continue;
      if (!candidate.script || candidate.script === 'Hans') return 'zh-CN';
    }
    if (language === 'en' || language === 'ja' || language === 'ko' || language === 'es')
      return language;
  }
  return 'en';
}
