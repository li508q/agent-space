import { en } from './en.js';
import { supportedLocales, type Locale } from './types.js';

export type I18nFailureCode =
  | 'UNSUPPORTED_LOCALE'
  | 'MISSING_MESSAGE'
  | 'INVALID_DICTIONARY'
  | 'INVALID_INTERPOLATION'
  | 'INVALID_ARGUMENT'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'INVALID_TIME_ZONE'
  | 'UNKNOWN_ERROR_CODE';

export class I18nError extends Error {
  override readonly name = 'I18nError';
  constructor(
    readonly code: I18nFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export function assertLocale(value: unknown): asserts value is Locale {
  if (typeof value !== 'string' || !supportedLocales.some((locale) => locale === value)) {
    throw new I18nError('UNSUPPORTED_LOCALE', 'Use an explicitly supported locale.');
  }
}

export function placeholderNames(template: string): string[] {
  const names = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!);
  if (/[{}]/.test(template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ''))) {
    throw new I18nError('INVALID_DICTIONARY', 'A message contains malformed placeholders.');
  }
  return [...new Set(names)].sort();
}

/** Fail on missing/extra keys, empty copy, or changed interpolation contracts. Never fall back. */
export function assertDictionaryParity(locale: Locale, dictionary: unknown): void {
  assertLocale(locale);
  if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
    throw new I18nError('INVALID_DICTIONARY', `Invalid dictionary for ${locale}.`);
  }
  const candidate = dictionary as Record<string, unknown>;
  const expected = Object.keys(en).sort();
  const actual = Object.keys(candidate).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new I18nError('INVALID_DICTIONARY', `Dictionary keys differ for ${locale}.`);
  }
  for (const key of expected) {
    const value = candidate[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new I18nError('INVALID_DICTIONARY', `Empty message: ${locale}/${key}.`);
    }
    const reference = en[key as keyof typeof en];
    if (placeholderNames(reference).join('|') !== placeholderNames(value).join('|')) {
      throw new I18nError('INVALID_DICTIONARY', `Placeholder mismatch: ${locale}/${key}.`);
    }
  }
}
