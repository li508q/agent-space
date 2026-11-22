// Trusted Main-inspector instrumentation, never imported by the application.
// This installer must be self-contained: the harness sends its function source
// to Main, with the actual Electron ipcMain as its only argument.
module.exports = function installIpcFault(ipcMain) {
  const faultMethods = [
    'saveObject',
    'saveDraft',
    'confirmImport',
    'resumeImport',
    'backupSpace',
    'exportCurrent',
    'restoreBackup',
  ];
  const holdMethods = ['createObject', 'readObject'];
  const methods = [...faultMethods, ...holdMethods];
  // Electron 45.4.1 was probed directly. This private registry is deliberately
  // checked, rather than assuming an unverified Electron version still has it.
  const registry = ipcMain._invokeHandlers;
  if (!(registry instanceof Map)) throw new Error('Unsupported Electron IPC registry');
  if (globalThis.__agentSpaceTestFault) throw new Error('Main fault fixture already installed');
  const handlers = methods.map((method) => {
    const name = 'agentspace:method:' + method;
    const handler = registry.get(name);
    if (typeof handler !== 'function') throw new Error('Missing real IPC handler: ' + name);
    return [name, handler];
  });
  let trackedMethod = null;
  let armed = false;
  let lost = 0;
  let calls = [];
  let holdNext = false;
  let releaseHeld = null;
  let holdObjectId = null;

  for (const [name, handler] of handlers) {
    ipcMain.removeHandler(name);
    ipcMain.handle(name, async (event, request) => {
      const tracked = name === 'agentspace:method:' + trackedMethod;
      if (tracked)
        calls.push(
          request?.input?.operationKey ??
            request?.input?.operationId ??
            request?.operationId ??
            null,
        );
      // Preserve the actual event, all original validation and the real Core
      // transaction. A failure is returned unchanged and cannot consume a fault.
      const result = await handler(event, request);
      if (
        tracked &&
        holdNext &&
        result?.ok &&
        (holdObjectId === null || request?.input?.objectId === holdObjectId)
      ) {
        holdNext = false;
        await new Promise((resolve) => {
          releaseHeld = resolve;
        });
      }
      if (tracked && armed && result?.ok) {
        armed = false;
        lost++;
        throw new Error('Synthetic IPC reply lost after the real handler committed');
      }
      return result;
    });
  }

  globalThis.__agentSpaceTestFault = Object.freeze({
    arm(method) {
      if (!faultMethods.includes(method)) throw new Error('Unsupported test fault');
      trackedMethod = method;
      armed = true;
      lost = 0;
      calls = [];
      holdNext = false;
      holdObjectId = null;
    },
    hold(method, objectId = null) {
      if (!holdMethods.includes(method)) throw new Error('Unsupported test hold');
      trackedMethod = method;
      holdNext = true;
      armed = false;
      releaseHeld = null;
      holdObjectId = objectId;
      calls = [];
    },
    release() {
      const release = releaseHeld;
      releaseHeld = null;
      release?.();
    },
    snapshot() {
      return { method: trackedMethod, lost, calls: [...calls], held: releaseHeld !== null };
    },
  });
};
