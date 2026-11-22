import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, CloseRequest, MenuCommand } from '../contracts/app.js';
import type { Failure } from '../contracts/errors.js';
import {
  channel,
  closeChannel,
  closeCancelledChannel,
  menuChannel,
  mutatingMethods,
} from './channels.js';

async function call<T>(name: string, input?: unknown): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel(name), input)) as T;
  } catch {
    const failure: Failure = {
      ok: false,
      error: {
        code: mutatingMethods.has(name) ? 'OPERATION_UNKNOWN' : 'STORAGE_FAILURE',
        retryable: mutatingMethods.has(name),
      },
    };
    return failure as T;
  }
}
const menuListeners = new Set<(command: MenuCommand) => void>();
const closeListeners = new Set<(request: CloseRequest) => void>();
const closeCancelledListeners = new Set<(request: CloseRequest) => void>();
const closeCancelledQueue: CloseRequest[] = [];
const menuQueue: MenuCommand[] = [];
let pendingClose: CloseRequest | null = null;
ipcRenderer.on(menuChannel, (_event, command: unknown) => {
  if (!['new-note', 'search', 'save', 'settings'].includes(String(command))) return;
  const value = command as MenuCommand;
  if (!menuListeners.size) {
    if (menuQueue.length < 8) menuQueue.push(value);
  } else menuListeners.forEach((fn) => fn(value));
});
function closeRequest(value: unknown): CloseRequest | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.requestId)
  )
    return null;
  return { requestId: value.requestId };
}
ipcRenderer.on(closeChannel, (_event, value: unknown) => {
  const request = closeRequest(value);
  if (!request) return;
  if (!closeListeners.size) pendingClose = request;
  else closeListeners.forEach((fn) => fn(request));
});
ipcRenderer.on(closeCancelledChannel, (_event, value: unknown) => {
  const request = closeRequest(value);
  if (!request) return;
  if (pendingClose?.requestId === request.requestId) pendingClose = null;
  if (!closeCancelledListeners.size) {
    if (closeCancelledQueue.length < 8) closeCancelledQueue.push(request);
  } else closeCancelledListeners.forEach((fn) => fn(request));
});
const api: DesktopApi = {
  bootstrap: () => call('bootstrap'),
  createSpace: (p) => call('createSpace', p),
  openSpace: () => call('openSpace'),
  openExample: () => call('openExample'),
  setLocale: (p) => call('setLocale', p),
  setTextScale: (p) => call('setTextScale', p),
  copyText: (p) => call('copyText', p),
  openExternal: (p) => call('openExternal', p),
  agentConfiguration: (p) => call('agentConfiguration', p),
  respondToClose: (p) => call('respondToClose', p),
  chooseImport: (p) => call('chooseImport', p),
  readImportPreview: (p) => call('readImportPreview', p),
  confirmImport: (p) => call('confirmImport', p),
  resumeImport: (p) => call('resumeImport', p),
  exportCurrent: (p) => call('exportCurrent', p),
  backupSpace: (p) => call('backupSpace', p),
  chooseBackup: () => call('chooseBackup'),
  restoreBackup: (p) => call('restoreBackup', p),
  readLocalTransfer: (p) => call('readLocalTransfer', p),
  openRestoredSpace: (p) => call('openRestoredSpace', p),
  chooseRelink: (p) => call('chooseRelink', p),
  confirmRelink: (p) => call('confirmRelink', p),
  status: (p) => call('status', p),
  createObject: (p) => call('createObject', p),
  saveObject: (p) => call('saveObject', p),
  readObject: (p) => call('readObject', p),
  query: (p) => call('query', p),
  describe: (p) => call('describe', p),
  search: (p) => call('search', p),
  expandRelations: (p) => call('expandRelations', p),
  readAcceptedChange: (p) => call('readAcceptedChange', p),
  history: (p) => call('history', p),
  saveDraft: (p) => call('saveDraft', p),
  listDrafts: (p) => call('listDrafts', p),
  readDraft: (p) => call('readDraft', p),
  discardDraft: (p) => call('discardDraft', p),
  getProposal: (p) => call('getProposal', p),
  listProposals: (p) => call('listProposals', p),
  markProposalSeen: (p) => call('markProposalSeen', p),
  reviewProposal: (p) => call('reviewProposal', p),
  undoChange: (p) => call('undoChange', p),
  createGrant: (p) => call('createGrant', p),
  updateGrant: (p) => call('updateGrant', p),
  listGrants: (p) => call('listGrants', p),
  setPolicy: (p) => call('setPolicy', p),
  markKnowledgeReviewed: (p) => call('markKnowledgeReviewed', p),
  changes: (p) => call('changes', p),
  activity: (p) => call('activity', p),
  operationStatus: (p) => call('operationStatus', p),
  setLifecycle: (p) => call('setLifecycle', p),
  retryImport: (p) => call('retryImport', p),
  pauseImport: (p) => call('pauseImport', p),
  getImport: (p) => call('getImport', p),
  listImports: (p) => call('listImports', p),
  listRecoverableDrafts: (p) => call('listRecoverableDrafts', p),
  readRecoverableDraft: (p) => call('readRecoverableDraft', p),
  copyRecoverableDraft: (p) => call('copyRecoverableDraft', p),
  onMenuCommand(listener) {
    menuListeners.add(listener);
    for (const command of menuQueue.splice(0)) listener(command);
    return () => {
      menuListeners.delete(listener);
    };
  },
  onCloseRequested(listener) {
    closeListeners.add(listener);
    if (pendingClose) {
      const request = pendingClose;
      pendingClose = null;
      listener(request);
    }
    return () => {
      closeListeners.delete(listener);
    };
  },
  onCloseCancelled(listener) {
    closeCancelledListeners.add(listener);
    for (const request of closeCancelledQueue.splice(0)) listener(request);
    return () => {
      closeCancelledListeners.delete(listener);
    };
  },
};
contextBridge.exposeInMainWorld('agentSpace', Object.freeze(api));
