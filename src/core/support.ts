import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ErrorCode, Failure, Result } from '../contracts/errors.js';

export const MAX_OBJECT_BYTES = 1_048_576;
export const FORMAT_VERSION = 2;
export const CORE_VERSION = 2;
export class CoreError extends Error {
  constructor(public readonly failure: Failure) {
    super(failure.error.code);
  }
}
export function fail(
  code: ErrorCode,
  params?: Record<string, string | number>,
  field?: string,
): never {
  throw new CoreError({
    ok: false,
    error: {
      code,
      retryable: ['STORAGE_BUSY', 'OPERATION_UNKNOWN'].includes(code),
      ...(params ? { params } : {}),
      ...(field ? { field } : {}),
    },
  });
}
export function asFailure(error: unknown): Failure {
  if (error instanceof CoreError) return error.failure;
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        retryable: false,
        field: error.issues[0]?.path.join('.') ?? '',
      },
    };
  }
  const code =
    error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) & 0xff : 0;
  const name = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return {
    ok: false,
    error: {
      code:
        code === 13
          ? 'LIMIT_EXCEEDED'
          : [5, 6].includes(code)
            ? 'STORAGE_BUSY'
            : ['ENOENT', 'ENOTDIR'].includes(name)
              ? 'NOT_FOUND'
              : [11, 26].includes(code)
                ? 'INTEGRITY_FAILURE'
                : 'STORAGE_FAILURE',
      retryable: [5, 6].includes(code),
    },
  };
}
export function safe<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return asFailure(error);
  }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
      .join(',') +
    '}'
  );
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');
export const normalize = (text: string): string => text.normalize('NFKC').toLowerCase();
export const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? 'null');
export function validateText(input: unknown): void {
  const pending: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let total = 0;
  while (pending.length) {
    const { value, depth, exit } = pending.pop()!;
    if (exit) {
      seen.delete(value as object);
      continue;
    }
    if (++nodes > 20_000 || depth > 32) fail('LIMIT_EXCEEDED');
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
        fail('INVALID_INPUT');
      total += Buffer.byteLength(value);
    } else if (value === null || typeof value === 'boolean') total += 5;
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('INVALID_INPUT');
      total += 24;
    } else if (typeof value === 'object') {
      if (seen.has(value)) fail('INVALID_INPUT');
      seen.add(value);
      pending.push({ value, depth, exit: true });
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        fail('INVALID_INPUT');
      if (Array.isArray(value) && value.length > 20_000) fail('LIMIT_EXCEEDED');
      const keys = Reflect.ownKeys(value);
      if (keys.length + pending.length > 20_000) fail('LIMIT_EXCEEDED');
      for (const key of keys) {
        if (typeof key !== 'string') fail('INVALID_INPUT');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (Array.isArray(value) && key === 'length') continue;
        if (descriptor.get || descriptor.set) fail('INVALID_INPUT');
        total += Buffer.byteLength(key) + 4;
        pending.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else fail('INVALID_INPUT');
    if (total > MAX_OBJECT_BYTES * 2) fail('LIMIT_EXCEEDED');
  }
}
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  validateText(input);
  if (bytes(input) > MAX_OBJECT_BYTES * 2) fail('LIMIT_EXCEEDED');
  return schema.parse(input) as z.output<S>;
}
export function checkedJson<T>(text: unknown): T {
  try {
    return JSON.parse(String(text)) as T;
  } catch {
    return fail('INTEGRITY_FAILURE');
  }
}
export function encodeCursor(secret: string, value: unknown): string {
  const payload = Buffer.from(canonical(value)).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
export function decodeCursor(secret: string, text: string): unknown {
  try {
    const parts = text.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return fail('INVALID_CURSOR');
    const expected = createHmac('sha256', secret).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return fail('INVALID_CURSOR');
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as unknown;
  } catch {
    return fail('INVALID_CURSOR');
  }
}
export function measured<T extends { returnedBytes: number }>(value: T): T {
  for (let i = 0; i < 5; i++) {
    const count = bytes({ ok: true, value });
    if (count === value.returnedBytes) return value;
    value.returnedBytes = count;
  }
  return value;
}
