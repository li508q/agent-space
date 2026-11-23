import { createHash } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  readFileSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { SourceFingerprintSchema, localLimits } from '../../contracts/local.js';
import type { Result } from '../../contracts/errors.js';
import type { z as Zod } from 'zod';
import { asFailure, digest, fail } from '../support.js';

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
export function absolute(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) fail('INVALID_INPUT', undefined, 'path');
  return path;
}
export function regularPath(path: string): string {
  absolute(path);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    fail('INVALID_INPUT', undefined, 'file');
  return realpathSync(path);
}
export function fingerprint(path: string): z.infer<typeof SourceFingerprintSchema> {
  const info = lstatSync(path, { bigint: true });
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    fail('INVALID_INPUT', undefined, 'source');
  const kind = info.isFile() ? 'file' : 'directory';
  return {
    kind,
    identity: digest({
      path: realpathSync(path),
      device: String(info.dev),
      inode: String(info.ino),
      kind,
    }),
    bytes: kind === 'file' ? Number(info.size) : 0,
    modifiedNs: String(info.mtimeNs),
  };
}
export function readSource(path: string): {
  bytes: Buffer;
  text: string;
  rawDigest: string;
  fingerprint: ReturnType<typeof fingerprint>;
} {
  const before = fingerprint(path);
  if (before.kind !== 'file') fail('UNSUPPORTED_IMPORT');
  if (before.bytes > localLimits.objectBytes)
    fail('LIMIT_EXCEEDED', { maxBytes: localLimits.objectBytes });
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initial = fstatSync(fd, { bigint: true });
    if (!initial.isFile() || Number(initial.size) > localLimits.objectBytes)
      fail('IMPORT_SOURCE_CHANGED');
    const buffer = Buffer.alloc(localLimits.objectBytes + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const count = readSync(fd, buffer, length, buffer.byteLength - length, null);
      if (!count) break;
      length += count;
    }
    if (length > localLimits.objectBytes) fail('IMPORT_SOURCE_CHANGED');
    const bytes = buffer.subarray(0, length);
    const final = fstatSync(fd, { bigint: true });
    const after = fingerprint(path);
    if (
      initial.dev !== final.dev ||
      initial.ino !== final.ino ||
      initial.size !== final.size ||
      initial.mtimeNs !== final.mtimeNs ||
      before.identity !== after.identity ||
      bytes.byteLength !== before.bytes
    )
      fail('IMPORT_SOURCE_CHANGED');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return fail('UNSUPPORTED_IMPORT', undefined, 'encoding');
    }
    if (text.includes('\0')) fail('UNSUPPORTED_IMPORT', undefined, 'text');
    return { bytes, text, rawDigest: sha256(bytes), fingerprint: after };
  } finally {
    closeSync(fd);
  }
}
/** Bounded private-artifact parser; never runs imported instructions or revivers. */
export function readJson<S extends Zod.ZodType>(
  path: string,
  schema: S,
  maxBytes = localLimits.planBytes,
): z.output<S> {
  const actual = regularPath(path);
  const info = lstatSync(actual);
  if (info.size > maxBytes) fail('LIMIT_EXCEEDED', { maxBytes });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(actual, 'utf8'));
  } catch {
    return fail('INTEGRITY_FAILURE');
  }
  const pending = [{ value: parsed, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 100_000 || item.depth > 32) fail('LIMIT_EXCEEDED');
    if (item.value && typeof item.value === 'object')
      for (const value of Object.values(item.value)) pending.push({ value, depth: item.depth + 1 });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) fail('INTEGRITY_FAILURE');
  return result.data;
}
export async function resultOf<T>(work: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return asFailure(error);
  }
}
