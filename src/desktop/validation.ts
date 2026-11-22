import { z } from 'zod';
import type { Failure, Result } from '../contracts/errors.js';
import { IdSchema } from '../contracts/schema.js';

function invalid(code: Failure['error']['code']): Failure {
  return { ok: false, error: { code, retryable: false } };
}
/** IPC is structured data; bound depth/width before JSON measurement or schema parsing. */
export function input<S extends z.ZodType>(schema: S, value: unknown): Result<z.output<S>> {
  try {
    const queue: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
    const active = new WeakSet<object>();
    let nodes = 0;
    let size = 0;
    while (queue.length) {
      const item = queue.pop()!;
      const v = item.value;
      if (item.exit) {
        active.delete(v as object);
        continue;
      }
      if (++nodes > 20000 || item.depth > 32) return invalid('LIMIT_EXCEEDED');
      if (typeof v === 'string') size += Buffer.byteLength(v);
      else if (v === null || typeof v === 'boolean') size += 5;
      else if (typeof v === 'number') {
        if (!Number.isFinite(v)) return invalid('INVALID_INPUT');
        size += 24;
      } else if (v && typeof v === 'object') {
        if (active.has(v)) return invalid('INVALID_INPUT');
        active.add(v);
        queue.push({ value: v, depth: item.depth, exit: true });
        if (Array.isArray(v) && v.length > 20000) return invalid('LIMIT_EXCEEDED');
        if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
          return invalid('INVALID_INPUT');
        const keys = Reflect.ownKeys(v);
        if (keys.length + queue.length > 20000) return invalid('LIMIT_EXCEEDED');
        for (const key of keys) {
          if (typeof key !== 'string') return invalid('INVALID_INPUT');
          if (Array.isArray(v) && key === 'length') continue;
          const d = Object.getOwnPropertyDescriptor(v, key)!;
          if (d.get || d.set) return invalid('INVALID_INPUT');
          size += key.length + 4;
          queue.push({ value: d.value, depth: item.depth + 1 });
        }
      } else return invalid('INVALID_INPUT');
      if (size > 8_388_608) return invalid('LIMIT_EXCEEDED');
    }
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            retryable: false,
            field: parsed.error.issues[0]?.path.join('.'),
          },
        };
  } catch {
    return invalid('INVALID_INPUT');
  }
}
export function bound<S extends z.ZodType>(schema: S) {
  return z.strictObject({
    bindingId: IdSchema,
    spaceId: IdSchema,
    instanceId: IdSchema,
    input: schema,
  });
}
