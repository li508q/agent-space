// Trusted test-launch instrumentation, never imported by the application.
// Wrap the actual registered IPC handler; its sender/schema/core checks and
// transaction run normally. Lose one successful response only after it returns.
// Electron's --require preload must install the wrapper synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcMain } = require('electron');
const originalHandle = ipcMain.handle.bind(ipcMain);
let trackedMethod = null;
let armed = false;
let lost = 0;
let calls = [];
let holdNext = false;
let releaseHeld = null;
let holdObjectId = null;

globalThis.__agentSpaceTestFault = Object.freeze({
  arm(method) {
    if (!['saveObject', 'saveDraft'].includes(method)) throw new Error('Unsupported test fault');
    trackedMethod = method;
    armed = true;
    lost = 0;
    calls = [];
    holdObjectId = null;
  },
  hold(method, objectId = null) {
    if (!['createObject', 'readObject'].includes(method)) throw new Error('Unsupported test hold');
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

ipcMain.handle = (name, handler) =>
  originalHandle(name, async (event, request) => {
    const tracked = name === 'agentspace:method:' + trackedMethod;
    if (tracked) calls.push(request?.input?.operationKey ?? null);
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
