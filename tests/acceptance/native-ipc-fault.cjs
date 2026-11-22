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

globalThis.__agentSpaceTestFault = Object.freeze({
  arm(method) {
    if (!['saveObject', 'saveDraft'].includes(method)) throw new Error('Unsupported test fault');
    trackedMethod = method;
    armed = true;
    lost = 0;
    calls = [];
  },
  snapshot() {
    return { method: trackedMethod, lost, calls: [...calls] };
  },
});

ipcMain.handle = (name, handler) =>
  originalHandle(name, async (event, request) => {
    const tracked = name === 'agentspace:method:' + trackedMethod;
    if (tracked) calls.push(request?.input?.operationKey ?? null);
    const result = await handler(event, request);
    if (tracked && armed && result?.ok) {
      armed = false;
      lost++;
      throw new Error('Synthetic IPC reply lost after the real handler committed');
    }
    return result;
  });
