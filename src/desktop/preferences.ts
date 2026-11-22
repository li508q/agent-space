import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IdSchema, LocaleSchema } from '../contracts/schema.js';
import { TextScaleSchema, type AppPreferences } from '../contracts/app.js';
import type { Failure, Result } from '../contracts/errors.js';

const PreferencesSchema = z.strictObject({
  version: z.literal(1),
  installationNamespace: IdSchema,
  locale: LocaleSchema.nullable(),
  textScale: TextScaleSchema.shape.factor,
  lastSpace: z.string().max(4096).nullable(),
});
type PreferencesFile = z.infer<typeof PreferencesSchema>;
export class Preferences {
  #data: PreferencesFile;
  readonly filename: string;
  readonly startupError: Failure['error'] | null;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.filename = join(directory, 'preferences.json');
    const identityFile = join(directory, 'installation.json');
    let stableIdentity: string | null = null;
    if (existsSync(identityFile)) {
      if (
        !lstatSync(identityFile).isFile() ||
        lstatSync(identityFile).isSymbolicLink() ||
        lstatSync(identityFile).size > 1024
      )
        throw new Error('Invalid installation identity');
      stableIdentity = IdSchema.parse(JSON.parse(readFileSync(identityFile, 'utf8')));
    }
    let initial: PreferencesFile = {
      version: 1,
      installationNamespace: randomUUID(),
      locale: null,
      textScale: 1,
      lastSpace: null,
    };
    let failure: Failure['error'] | null = null;
    if (existsSync(this.filename)) {
      try {
        if (
          !lstatSync(this.filename).isFile() ||
          lstatSync(this.filename).isSymbolicLink() ||
          lstatSync(this.filename).size > 16384
        )
          throw new Error('Invalid preferences');
        initial = PreferencesSchema.parse(JSON.parse(readFileSync(this.filename, 'utf8')));
      } catch {
        failure = { code: 'INTEGRITY_FAILURE', retryable: false };
        // Preserve invalid bytes for inspection. Never delete or repair a user space.
        renameSync(this.filename, join(directory, `preferences.invalid-${randomUUID()}.json`));
      }
    }
    if (stableIdentity) initial.installationNamespace = stableIdentity;
    else {
      stableIdentity = initial.installationNamespace;
      const fd = openSync(
        identityFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, JSON.stringify(stableIdentity));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    this.#data = initial;
    this.startupError = failure;
    if (!existsSync(this.filename)) this.persist(initial);
  }
  get installationNamespace(): string {
    return this.#data.installationNamespace;
  }
  get lastSpace(): string | null {
    return this.#data.lastSpace;
  }
  get public(): AppPreferences {
    return { locale: this.#data.locale, textScale: this.#data.textScale };
  }
  update(
    patch: Partial<Pick<PreferencesFile, 'locale' | 'textScale' | 'lastSpace'>>,
  ): Result<AppPreferences> {
    try {
      const next = PreferencesSchema.parse({ ...this.#data, ...patch });
      this.persist(next);
      this.#data = next;
      return { ok: true, value: this.public };
    } catch {
      return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } };
    }
  }
  private persist(data: PreferencesFile): void {
    const temporary = join(this.directory, `.preferences-${randomUUID()}.tmp`);
    let fd: number | null = null;
    try {
      fd = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(fd, JSON.stringify(data, null, 2) + '\n');
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(temporary, this.filename);
      // A local preferences write is atomic; no power-cut durability claim is made.
    } finally {
      if (fd !== null) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
