import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { Result } from '../contracts/errors.js';
import {
  ChooseImportSchema,
  ReadPreviewHandleSchema,
  ConfirmImportHandleSchema,
  ResumeImportSchema,
  TransferRequestSchema,
  HandleRequestSchema,
  RestoreBackupRequestSchema,
  RelinkChooseSchema,
  RelinkConfirmSchema,
} from '../contracts/local.js';
import type { SpaceSession } from '../contracts/app.js';
import { trustedSender } from './security.js';
import { channel, mutatingMethods } from './channels.js';
import { bound, input } from './validation.js';
import { LocalCoordinator } from './local-coordinator.js';

export function registerLocalHandlers(
  owner: WebContents,
  local: LocalCoordinator,
  openRestored: (
    request: z.infer<typeof HandleRequestSchema>,
  ) => Promise<Result<SpaceSession | null>>,
): () => void {
  const registered: string[] = [];
  const add = <S extends z.ZodType, T>(
    name: string,
    schema: S,
    fn: (p: z.output<S>) => Result<T> | Promise<Result<T>>,
  ) => {
    registered.push(channel(name));
    ipcMain.handle(channel(name), async (event, raw: unknown) => {
      if (!trustedSender(event, owner))
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
      const p = input(schema, raw === undefined ? null : raw);
      if (!p.ok) return p;
      try {
        return await fn(p.value);
      } catch {
        return {
          ok: false,
          error: {
            code: mutatingMethods.has(name) ? 'OPERATION_UNKNOWN' : 'STORAGE_FAILURE',
            retryable: mutatingMethods.has(name),
          },
        };
      }
    });
  };
  add('chooseImport', bound(ChooseImportSchema), (p) => local.chooseImport(p));
  add('readImportPreview', bound(ReadPreviewHandleSchema), (p) => local.readImportPreview(p));
  add('confirmImport', bound(ConfirmImportHandleSchema), (p) => local.confirmImport(p));
  add('resumeImport', bound(ResumeImportSchema), (p) => local.resumeImport(p));
  add('exportCurrent', bound(TransferRequestSchema), (p) => local.transfer(p, 'readable-export'));
  add('backupSpace', bound(TransferRequestSchema), (p) => local.transfer(p, 'sqlite-backup'));
  add('chooseBackup', z.null(), () => local.chooseBackup());
  add('restoreBackup', RestoreBackupRequestSchema, (p) => local.restoreBackup(p));
  add('readLocalTransfer', HandleRequestSchema, (p) => local.readLocalTransfer(p));
  add('openRestoredSpace', HandleRequestSchema, openRestored);
  add('chooseRelink', bound(RelinkChooseSchema), (p) => local.chooseRelink(p));
  add('confirmRelink', bound(RelinkConfirmSchema), (p) => local.confirmRelink(p));
  return () => registered.forEach((name) => ipcMain.removeHandler(name));
}
