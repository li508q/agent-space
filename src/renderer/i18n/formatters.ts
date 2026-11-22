import { assertLocale, I18nError } from './validation.js';
import type { Locale } from './types.js';

export type DateStyle = 'short' | 'medium' | 'long' | 'full';
export type DateTimeOptions = Pick<
  Intl.DateTimeFormatOptions,
  'dateStyle' | 'timeStyle' | 'hour12' | 'hourCycle'
>;

export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  assertLocale(locale);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new I18nError('INVALID_NUMBER', 'A finite numeric value is required.');
  }
  return new Intl.NumberFormat(locale, options).format(value);
}

function calendarDate(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new I18nError('INVALID_DATE', 'Use a calendar date in YYYY-MM-DD form.');
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new I18nError('INVALID_DATE', 'The calendar date does not exist.');
  }
  return date;
}

/** Calendar dates have no zone: do not let a local midnight shift their day. */
export function formatDate(locale: Locale, value: string, style: DateStyle = 'medium'): string {
  assertLocale(locale);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    calendar: 'gregory',
    timeZone: 'UTC',
  }).format(calendarDate(value));
}

/** Instants require an explicit zone; strings must include Z or an offset. */
export function formatDateTime(
  locale: Locale,
  value: Date | number | string,
  timeZone: string,
  options: DateTimeOptions = {},
): string {
  assertLocale(locale);
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new I18nError('INVALID_TIME_ZONE', 'An explicit time zone is required.');
  }
  try {
    new Intl.DateTimeFormat(locale, { timeZone });
  } catch {
    throw new I18nError('INVALID_TIME_ZONE', 'The time zone is not supported.');
  }
  if (typeof value === 'string') {
    const parts =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (!parts) {
      throw new I18nError('INVALID_DATE', 'An instant string must include an explicit offset.');
    }
    const hours = Number(parts[2]);
    const minutes = Number(parts[3]);
    const seconds = Number(parts[4] ?? 0);
    const offsetHours = Number(parts[5] ?? 0);
    const offsetMinutes = Number(parts[6] ?? 0);
    // Date accepts 24:00 and advances the day. Reject it before normalization.
    if (hours > 23 || minutes > 59 || seconds > 59 || offsetHours > 23 || offsetMinutes > 59) {
      throw new I18nError(
        'INVALID_DATE',
        'Hours must be 00–23 and minutes/seconds 00–59, including the numeric offset.',
      );
    }
    calendarDate(parts[1]!);
  } else if (!(value instanceof Date) && typeof value !== 'number') {
    throw new I18nError(
      'INVALID_DATE',
      'Use a Date, epoch milliseconds, or an offset-bearing instant.',
    );
  }
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime())) {
    throw new I18nError('INVALID_DATE', 'The instant does not exist.');
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
    calendar: 'gregory',
    timeZone,
  }).format(date);
}
