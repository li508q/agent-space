import { backup, DatabaseSync } from 'node:sqlite';
import {
  constants,
  closeSync,
  lstatSync,
  openSync,
  rmSync,
  fstatSync,
  readSync,
  writeSync,
  fsyncSync,
} from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { localLimits } from '../../contracts/local.js';
import { fail } from '../support.js';
import { regularPath } from './files.js';
import { validateDatabase } from './validate.js';

export async function hashFile(filename: string): Promise<string> {
  const path = regularPath(filename);
  if (lstatSync(path).size > localLimits.databaseBytes) fail('LIMIT_EXCEEDED');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { fd, autoClose: true }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}
/** Inspect the acquired private file, never a claim about its source path. */
export async function inspectSnapshot(filename: string) {
  return {
    validation: validateDatabase(filename),
    digest: await hashFile(filename),
    bytes: lstatSync(filename).size,
  };
}
/**
 * Acquire a closed manifest-backed backup byte-for-byte. SQLite's online backup
 * can rewrite physical headers across runtime versions, so it is reserved for
 * live source spaces. Full digest/identity/count binding happens at restore.
 */
export async function captureSnapshot(
  sourceFile: string,
  destinationFile: string,
  progress?: (copied: number, total: number) => void,
) {
  const source = regularPath(sourceFile);
  const input = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: number | undefined;
  try {
    const initial = fstatSync(input);
    if (!initial.isFile() || initial.nlink !== 1) fail('INVALID_INPUT');
    if (initial.size > localLimits.databaseBytes) fail('LIMIT_EXCEEDED');
    try {
      output = openSync(
        destinationFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
        fail('DESTINATION_EXISTS');
      throw error;
    }
    const buffer = Buffer.alloc(1_048_576);
    let copied = 0;
    while (true) {
      const count = readSync(
        input,
        buffer,
        0,
        Math.min(buffer.length, localLimits.databaseBytes - copied + 1),
        null,
      );
      if (!count) break;
      copied += count;
      if (copied > localLimits.databaseBytes) fail('LIMIT_EXCEEDED');
      if (copied > initial.size) fail('IMPORT_SOURCE_CHANGED');
      let written = 0;
      while (written < count) {
        const bytes = writeSync(output, buffer, written, count - written, null);
        if (bytes <= 0) fail('STORAGE_FAILURE');
        written += bytes;
      }
      progress?.(copied, initial.size);
      await setImmediate();
    }
    if (copied !== initial.size || fstatSync(input).size !== initial.size)
      fail('IMPORT_SOURCE_CHANGED');
    fsyncSync(output);
  } catch (error) {
    if (output !== undefined) rmSync(destinationFile, { force: true });
    throw error;
  } finally {
    closeSync(input);
    if (output !== undefined) closeSync(output);
  }
  try {
    return await inspectSnapshot(destinationFile);
  } catch (error) {
    rmSync(destinationFile, { force: true });
    throw error;
  }
}
/** The source never enters Store/Engine.command and is never opened writable. */
export async function copySnapshot(
  sourceFile: string,
  destinationFile: string,
  progress?: (copied: number, total: number) => void,
) {
  const source = regularPath(sourceFile);
  if (lstatSync(source).size > localLimits.databaseBytes) fail('LIMIT_EXCEEDED');
  let fd: number;
  try {
    fd = openSync(
      destinationFile,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
      fail('DESTINATION_EXISTS');
    throw error;
  }
  closeSync(fd);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source, { readOnly: true, allowExtension: false, timeout: 5_000 });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
    await backup(db, destinationFile, {
      rate: 100,
      progress: ({ remainingPages, totalPages }) =>
        progress?.(totalPages - remainingPages, totalPages),
    });
  } catch (error) {
    rmSync(destinationFile, { force: true });
    throw error;
  } finally {
    db?.close();
  }
  return inspectSnapshot(destinationFile);
}
