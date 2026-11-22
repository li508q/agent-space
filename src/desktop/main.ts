import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  AgentConfigurationSchema,
  CloseResponseSchema,
  CopyTextSchema,
  CreateSpaceDialogSchema,
  LocalePreferenceSchema,
  OpenExternalSchema,
  TextScaleSchema,
  type AppBootstrap,
  type MenuCommand,
  type SpaceSession,
} from '../contracts/app.js';
import type { Locale, ObjectContent } from '../contracts/schema.js';
import type { Failure, Result } from '../contracts/errors.js';
import { t, resolveSystemLocale } from '../renderer/i18n/index.js';
import { Preferences } from './preferences.js';
import { Workspace } from './workspace.js';
import { RendererAssets, APP_SCHEME, APP_URL, safeExternalUrl, trustedSender } from './security.js';
import { CloseHandshake } from './close.js';
import { registerCoreHandlers } from './ipc.js';
import {
  channel,
  closeChannel,
  closeCancelledChannel,
  menuChannel,
  mutatingMethods,
} from './channels.js';
import { nativeText } from './native-copy.js';
import { bound, input } from './validation.js';
import { agentRuntime, launchConfiguration } from './agent-configuration.js';
import { LocalCoordinator } from './local-coordinator.js';
import { registerLocalHandlers } from './local-ipc.js';
import { CoreError } from '../core/support.js';

declare const __AGENTSPACE_VERSION__: string;
const argv = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);
const mode = argv[0] === '--agent-server' ? 'server' : argv[0] === '--agent-cli' ? 'cli' : null;
const isolate = process.env.AGENTSPACE_USER_DATA;
if (isolate) {
  if (!isAbsolute(isolate)) throw new Error('AGENTSPACE_USER_DATA must be absolute');
  mkdirSync(isolate, { recursive: true, mode: 0o700 });
  app.setPath('userData', isolate);
}
if (mode) {
  if (process.platform === 'darwin')
    void app.whenReady().then(() => app.setActivationPolicy('prohibited'));
  void (async () => {
    let code = 70;
    try {
      code = await (await agentRuntime(__dirname)).runAgentMode(mode, argv.slice(1), process.env);
    } catch {
      (mode === 'cli' ? process.stdout : process.stderr).write(
        JSON.stringify({ ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } }) + '\n',
      );
    }
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
    await new Promise<void>((resolve) => process.stderr.write('', () => resolve()));
    app.exit(code);
  })();
} else {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
  app.setName('AgentSpace');
  const dataPath = isolate ?? join(app.getPath('appData'), 'AgentSpace');
  mkdirSync(dataPath, { recursive: true, mode: 0o700 });
  app.setPath('userData', dataPath);
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    let window: BrowserWindow | null = null;
    app.on('second-instance', () => {
      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    });
    void app
      .whenReady()
      .then(async () => {
        const preferences = new Preferences(dataPath);
        const workspace = new Workspace(preferences);
        const systemLocales = app.getPreferredSystemLanguages();
        const locale = (): Locale =>
          preferences.public.locale ?? resolveSystemLocale(systemLocales);
        let startupError: Failure['error'] | null = preferences.startupError;
        if (preferences.lastSpace) {
          const opened = workspace.open(preferences.lastSpace);
          if (!opened.ok) startupError = opened.error;
        }
        const assets = new RendererAssets(join(__dirname, '../renderer'));
        const sandbox = session.fromPartition('persist:agentspace-desktop');
        sandbox.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        sandbox.setPermissionCheckHandler(() => false);
        sandbox.webRequest.onBeforeRequest((details, callback) => {
          let allowed = false;
          try {
            const u = new URL(details.url);
            allowed = u.protocol === 'agentspace:' && u.hostname === 'app';
          } catch {
            /* Denied. */
          }
          callback({ cancel: !allowed });
        });
        await sandbox.protocol.handle(APP_SCHEME, (request) => assets.respond(request));
        window = new BrowserWindow({
          width: 1380,
          height: 900,
          minWidth: 840,
          minHeight: 600,
          title: 'AgentSpace',
          backgroundColor: '#f3f6f8',
          show: false,
          webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
            session: sandbox,
          },
        });
        const owner = window.webContents;
        owner.setWindowOpenHandler(() => ({ action: 'deny' }));
        owner.on('will-navigate', (event) => event.preventDefault());
        owner.on('will-frame-navigate', (event) => event.preventDefault());
        owner.on('will-attach-webview', (event) => event.preventDefault());
        const close = new CloseHandshake();
        let closingAuthorized = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let fallbackOpen = false;
        let switching = false;
        let receivedText: string | null = null;
        const clearClose = (notify = true) => {
          if (timer) clearTimeout(timer);
          timer = null;
          const canceled = close.cancel();
          if (notify && canceled && !owner.isDestroyed()) {
            try {
              owner.send(closeCancelledChannel, canceled);
            } catch {
              /* A crashed renderer cannot consume the terminal event. */
            }
          }
        };
        const finishClose = () => {
          clearClose(false);
          closingAuthorized = true;
          window?.close();
        };
        const currentBinding = () => workspace.session?.bindingId ?? null;
        const confirmDiscard = async (): Promise<boolean> => {
          const response = await dialog.showMessageBox(window!, {
            type: 'warning',
            title: nativeText(locale(), 'discardTitle'),
            message: nativeText(locale(), 'discardTitle'),
            detail: nativeText(locale(), 'discardExplanation'),
            buttons: [t(locale(), 'common.cancel'), nativeText(locale(), 'discard')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return response.response === 1;
        };
        const requestClose = () => {
          if (!window || window.isDestroyed() || closingAuthorized || close.request || fallbackOpen)
            return;
          const request = close.begin(currentBinding());
          try {
            owner.send(closeChannel, request);
          } catch {
            /* A crashed renderer still gets the native keep-open fallback. */
          }
          timer = setTimeout(() => {
            void fallback(request.requestId).catch(() => {
              clearClose();
              if (window && !window.isDestroyed())
                void dialog
                  .showMessageBox(window, {
                    type: 'error',
                    message: nativeText(locale(), 'actionFailure'),
                    buttons: [t(locale(), 'common.close')],
                  })
                  .catch(() => {});
            });
          }, 8000);
        };
        const fallback = async (requestId: string) => {
          if (!window || fallbackOpen || !close.valid(requestId, currentBinding())) return;
          fallbackOpen = true;
          let retry = false;
          try {
            const buttons = [
              nativeText(locale(), 'keepOpen'),
              t(locale(), 'common.retry'),
              ...(receivedText !== null ? [nativeText(locale(), 'copyReceived')] : []),
              nativeText(locale(), 'discard'),
            ];
            const response = await dialog.showMessageBox(window, {
              type: 'warning',
              message: nativeText(locale(), 'closeWaiting'),
              detail:
                nativeText(locale(), 'closeExplanation') +
                (receivedText !== null ? '\n\n' + nativeText(locale(), 'copyNotice') : ''),
              buttons,
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (!close.valid(requestId, currentBinding())) return;
            if (response.response === 1) {
              clearClose();
              retry = true;
            } else if (receivedText !== null && response.response === 2) {
              await clipboard.writeText(receivedText);
              clearClose();
            } else if (response.response === buttons.length - 1) {
              if ((await confirmDiscard()) && close.valid(requestId, currentBinding()))
                finishClose();
              else clearClose();
            } else clearClose();
          } finally {
            fallbackOpen = false;
          }
          if (retry) requestClose();
        };
        const remember = (content: ObjectContent) => {
          receivedText = content.title + (content.title ? '\n\n' : '') + content.body;
          if (Object.keys(content.properties).length || content.relations.length)
            receivedText +=
              '\n\n' +
              JSON.stringify(
                { properties: content.properties, relations: content.relations },
                null,
                2,
              );
        };
        const platformChannels: string[] = [];
        const platform = <S extends z.ZodType, T>(
          name: string,
          schema: S,
          action: (p: z.output<S>) => Promise<Result<T>> | Result<T>,
        ) => {
          platformChannels.push(channel(name));
          ipcMain.handle(channel(name), async (event, raw: unknown) => {
            if (!trustedSender(event, owner))
              return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
            const checked = input(schema, raw === undefined ? null : raw);
            if (!checked.ok) return checked;
            try {
              return await action(checked.value);
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
        const switchSpace = async (
          fn: () => Promise<Result<SpaceSession | null>>,
        ): Promise<Result<SpaceSession | null>> => {
          if (switching) return { ok: false, error: { code: 'STORAGE_BUSY', retryable: true } };
          switching = true;
          try {
            const result = await fn();
            if (result.ok && result.value) {
              clearClose();
              receivedText = null;
              startupError = null;
            }
            return result;
          } finally {
            switching = false;
          }
        };
        let localDialogOpen = false;
        const nativeChoice = async <T>(choose: () => Promise<T>): Promise<T> => {
          if (localDialogOpen)
            throw new CoreError({ ok: false, error: { code: 'STORAGE_BUSY', retryable: true } });
          localDialogOpen = true;
          try {
            return await choose();
          } finally {
            localDialogOpen = false;
          }
        };
        const local = new LocalCoordinator(workspace, {
          importSources: (mode) =>
            nativeChoice(async () => {
              const selected = await dialog.showOpenDialog(window!, {
                title: t(locale(), 'import.title'),
                buttonLabel: t(
                  locale(),
                  mode === 'files' ? 'import.chooseFiles' : 'import.chooseFolder',
                ),
                properties: mode === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory'],
              });
              return selected.canceled ? null : selected.filePaths;
            }),
          destination: (kind) =>
            nativeChoice(async () => {
              const title = t(
                locale(),
                kind === 'sqlite-backup'
                  ? 'backup.chooseDestination'
                  : kind === 'restored-space'
                    ? 'restore.chooseNewLocation'
                    : 'export.current',
              );
              const selected = await dialog.showSaveDialog(window!, {
                title,
                buttonLabel: title,
                properties: ['createDirectory', 'showOverwriteConfirmation'],
              });
              return selected.canceled || !selected.filePath ? null : selected.filePath;
            }),
          backup: () =>
            nativeChoice(async () => {
              const selected = await dialog.showOpenDialog(window!, {
                title: t(locale(), 'restore.title'),
                buttonLabel: t(locale(), 'restore.title'),
                properties: ['openDirectory'],
              });
              return selected.canceled ? null : (selected.filePaths[0] ?? null);
            }),
          relink: () =>
            nativeChoice(async () => {
              const selected = await dialog.showOpenDialog(window!, {
                title: t(locale(), 'object.asset'),
                buttonLabel: t(locale(), 'common.confirm'),
                properties: ['openFile', 'openDirectory'],
              });
              return selected.canceled ? null : (selected.filePaths[0] ?? null);
            }),
        });
        const unregisterLocal = registerLocalHandlers(owner, local, (request) =>
          switchSpace(async () => local.openRestoredSpace(request)),
        );
        const unregisterCore = registerCoreHandlers(owner, workspace, remember, (binding, run) =>
          local.importCoordinatorError(binding, run),
        );
        platform('bootstrap', z.null(), (): Result<AppBootstrap> => {
          const status = workspace.human?.status();
          return {
            ok: true,
            value: {
              version: __AGENTSPACE_VERSION__,
              preferences: preferences.public,
              systemLocales,
              activeSpace: workspace.session
                ? {
                    ...workspace.session,
                    status: status?.ok ? status.value : workspace.session.status,
                  }
                : null,
              startupError: status && !status.ok ? status.error : startupError,
            },
          };
        });
        platform('createSpace', CreateSpaceDialogSchema, (p) =>
          switchSpace(async () => {
            const selected = await dialog.showSaveDialog(window!, {
              title: t(locale(), 'space.chooseLocation'),
              buttonLabel: t(locale(), 'space.create'),
              defaultPath: p.title,
              properties: ['createDirectory', 'showOverwriteConfirmation'],
            });
            if (owner.isDestroyed())
              return { ok: false, error: { code: 'SPACE_MISMATCH', retryable: false } };
            return selected.canceled || !selected.filePath
              ? { ok: true, value: null }
              : workspace.create(selected.filePath, p.title);
          }),
        );
        platform('openSpace', z.null(), () =>
          switchSpace(async () => {
            const selected = await dialog.showOpenDialog(window!, {
              title: t(locale(), 'space.open'),
              buttonLabel: t(locale(), 'space.open'),
              properties: ['openDirectory'],
            });
            if (owner.isDestroyed())
              return { ok: false, error: { code: 'SPACE_MISMATCH', retryable: false } };
            return selected.canceled || !selected.filePaths[0]
              ? { ok: true, value: null }
              : workspace.open(selected.filePaths[0]);
          }),
        );
        platform('openExample', z.null(), () => switchSpace(async () => workspace.example()));
        platform('setLocale', LocalePreferenceSchema, (p) => {
          const result = preferences.update(p);
          if (result.ok) installMenu();
          return result;
        });
        platform('setTextScale', TextScaleSchema, (p) => {
          const result = preferences.update({ textScale: p.factor });
          if (result.ok) owner.setZoomFactor(p.factor);
          return result;
        });
        platform('copyText', CopyTextSchema, async (p) => {
          await clipboard.writeText(p.text);
          return { ok: true, value: { copied: true as const } };
        });
        platform('openExternal', OpenExternalSchema, async (p) => {
          const url = safeExternalUrl(p.url);
          if (!url) return { ok: false, error: { code: 'UNSAFE_LINK', retryable: false } };
          const gesture: unknown = await owner.executeJavaScript(
            'navigator.userActivation.isActive',
          );
          if (!url || gesture !== true)
            return { ok: false, error: { code: 'UNSAFE_LINK', retryable: false } };
          await shell.openExternal(url);
          return { ok: true, value: { opened: true as const } };
        });
        platform('agentConfiguration', bound(AgentConfigurationSchema), async (p) => {
          const active = workspace.validate(p);
          if (!active.ok) return active;
          const authorized = workspace.validateAgent(p.input.grantId, p.input.token);
          if (!authorized.ok) return authorized;
          const runtime = await agentRuntime(__dirname);
          const stillActive = workspace.validate(p);
          if (!stillActive.ok) return stillActive;
          const stillAuthorized = workspace.validateAgent(p.input.grantId, p.input.token);
          if (!stillAuthorized.ok) return stillAuthorized;
          return {
            ok: true,
            value: launchConfiguration({
              executable: process.execPath,
              mainEntry: join(__dirname, 'main.cjs'),
              packaged: app.isPackaged,
              space: workspace.directory!,
              instanceId: p.instanceId,
              grantId: p.input.grantId,
              token: p.input.token,
              tokenEnv: runtime.AGENT_TOKEN_ENV,
            }),
          };
        });
        platform('respondToClose', CloseResponseSchema, async (p) => {
          if (!close.valid(p.requestId, currentBinding()))
            return { ok: false, error: { code: 'INVALID_INPUT', retryable: false } };
          if (p.decision === 'cancel') {
            clearClose();
            return { ok: true, value: { closed: false } };
          }
          // A late renderer result cannot bypass an already visible native
          // recovery/confirmation dialog. Its old nonce ends with that dialog.
          if (fallbackOpen) return { ok: true, value: { closed: false } };
          if (p.decision === 'discard') {
            fallbackOpen = true;
            if (timer) clearTimeout(timer);
            timer = null;
            let confirmed: boolean;
            try {
              confirmed = await confirmDiscard();
            } catch {
              clearClose();
              return { ok: false, error: { code: 'STORAGE_FAILURE', retryable: false } };
            } finally {
              fallbackOpen = false;
            }
            if (!confirmed) {
              clearClose();
              return { ok: true, value: { closed: false } };
            }
          }
          if (!close.valid(p.requestId, currentBinding()))
            return { ok: false, error: { code: 'SPACE_MISMATCH', retryable: false } };
          finishClose();
          return { ok: true, value: { closed: true } };
        });
        function installMenu() {
          const command = (name: MenuCommand) => () => owner.send(menuChannel, name);
          const n = (key: Parameters<typeof nativeText>[1]) => nativeText(locale(), key);
          const template: MenuItemConstructorOptions[] = [];
          if (process.platform === 'darwin')
            template.push({
              label: 'AgentSpace',
              submenu: [
                { role: 'about', label: n('about') },
                { type: 'separator' },
                { role: 'hide', label: n('hide') },
                { role: 'hideOthers', label: n('hideOthers') },
                { role: 'unhide', label: n('showAll') },
                { type: 'separator' },
                { label: n('quit'), accelerator: 'CmdOrCtrl+Q', click: requestClose },
              ],
            });
          template.push({
            label: n('file'),
            submenu: [
              {
                label: t(locale(), 'object.newNote'),
                accelerator: 'CmdOrCtrl+N',
                click: command('new-note'),
              },
              {
                label: t(locale(), 'editor.saveNow'),
                accelerator: 'CmdOrCtrl+S',
                click: command('save'),
              },
              { label: n('search'), accelerator: 'CmdOrCtrl+K', click: command('search') },
              { type: 'separator' },
              {
                label: t(locale(), 'common.close'),
                accelerator: 'CmdOrCtrl+W',
                click: requestClose,
              },
            ],
          });
          template.push({
            label: n('edit'),
            submenu: [
              { role: 'undo', label: n('undo') },
              { role: 'redo', label: n('redo') },
              { type: 'separator' },
              { role: 'cut', label: n('cut') },
              { role: 'copy', label: t(locale(), 'common.copy') },
              { role: 'paste', label: n('paste') },
              { role: 'selectAll', label: n('selectAll') },
              { type: 'separator' },
              {
                label: t(locale(), 'settings.title'),
                accelerator: 'CmdOrCtrl+,',
                click: command('settings'),
              },
            ],
          });
          template.push(
            { label: n('view'), submenu: [{ role: 'togglefullscreen', label: n('fullScreen') }] },
            {
              label: n('window'),
              submenu: [
                { role: 'minimize', label: n('minimize') },
                { role: 'zoom', label: n('zoom') },
              ],
            },
          );
          Menu.setApplicationMenu(Menu.buildFromTemplate(template));
        }
        installMenu();
        window.on('close', (event) => {
          if (!closingAuthorized) {
            event.preventDefault();
            requestClose();
          }
        });
        app.on('before-quit', (event) => {
          if (window && !window.isDestroyed() && !closingAuthorized) {
            event.preventDefault();
            requestClose();
          }
        });
        window.on('closed', () => {
          clearClose(false);
          unregisterCore();
          unregisterLocal();
          local.dispose();
          platformChannels.forEach((name) => ipcMain.removeHandler(name));
          workspace.close();
          window = null;
        });
        owner.on('did-finish-load', () => owner.setZoomFactor(preferences.public.textScale));
        await window.loadURL(APP_URL);
        window.show();
      })
      .catch(() => {
        dialog.showErrorBox(
          'AgentSpace',
          nativeText(resolveSystemLocale(app.getPreferredSystemLanguages()), 'loadFailure'),
        );
        app.exit(1);
      });
    app.on('window-all-closed', () => app.quit());
  }
}
