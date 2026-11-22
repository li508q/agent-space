# Desktop runtime

The desktop uses the same `Space` and `HumanServices` implementation as the restricted agent adapter. It stores no second copy of accepted content. A person can create, open, edit and review local material without a model provider or API key.

## Build and run

Use the pinned Node version in `package.json` and the committed npm lockfile:

```sh
npm ci
npm run build
npm start
```

`npm run dev` builds and launches the application. It does not run a watch server. `npm run build:desktop` builds the core, adapter, main process and preload without replacing or generating renderer content. The full build requires the real `src/renderer/main.tsx` and `index.html` entries.

Compiled entries are `dist/desktop/main.cjs`, `dist/desktop/preload.cjs`, `dist/renderer/index.html` and `dist/agent/adapters/index.js`. The start script removes inherited `ELECTRON_RUN_AS_NODE` before launching Electron. A development build is not an installer or a signed release.

## Desktop boundary

The sandboxed renderer has context isolation and no Node integration. Its preload exposes named `window.agentSpace` business methods, without raw IPC, filesystem, database, process or shell access. Main checks the exact WebContents, top frame, fixed document origin and strict request schema. Every space-bound call also checks the active binding, space and instance IDs. Reopening the same space generates a fresh binding.

Only compiled renderer assets are served at `agentspace://app/index.html`. Source, core, agent and preload files are outside the resource manifest. Scripts are local; inline scripts, evaluation, network connections, remote images, frames, webviews, navigation, new windows and permission requests are denied. Inline styles are permitted for CodeMirror's dynamic styles and React style attributes. HTTP(S) links require a transient human click before main calls the operating system's external-link handler.

All space locations come from native dialogs. Canceling a dialog preserves the current space. Preferences and a stable human installation namespace live in the application's private user-data directory. Invalid presentation preferences are preserved separately and reported; they do not delete or repair a user space. An explicit language selection and text zoom persist independently of user-authored content.

Window close uses a request nonce. The renderer first saves or durably retains a recovery draft. No response means the window stays open; the fallback offers retry, keeping the window, an accurately labeled copy of text actually received by main, and an explicit discard confirmation. Main cannot claim it has copied newer keystrokes that an unresponsive renderer never sent.

Canceling a close emits `onCloseCancelled` with the old nonce, including native Keep open, Retry and error paths. A late ready response cannot bypass a visible native recovery dialog. Retry first ends the old nonce, then starts a new one. Actual closure does not emit a cancellation.

## Agent entry

The Electron executable recognizes `--agent-server` and `--agent-cli` before creating a window, loading desktop preferences or acquiring the desktop single-instance lock. It loads the restricted adapter in Electron's bundled Node runtime. Multiple agent processes may access the same space through the common transaction guards.

Generated configuration uses the actual executable and compiled development entry, or the application executable when packaged. Tokens are passed only in `AGENTSPACE_TOKEN`; they are not command-line arguments. Configuration generation revalidates the active binding and grant without fabricating a tool-call activity. The JSON is a stdio launch-parameter object; the TOML targets Codex's `mcp_servers` format. Neither is written into a host's settings automatically. Copying configuration does not prove a host is connected.

See [Agent protocol](AGENT_PROTOCOL.md) for tool names, scope and operation recovery. Final packaging and execution after moving an application bundle require separate verification; development-mode integration does not establish those claims.

## Checks

```sh
npm run check
npm run test:desktop:agent
npm run test:desktop
```

The first runs type/lint and contract, core, editor, localization, desktop unit and real standalone protocol checks. `test:desktop:agent` compiles and invokes real Electron CLI/MCP processes without a window. `test:desktop` builds the real UI and runs desktop files serially. Run it without another GUI acceptance process competing for foreground focus. Native tests substitute selected operating-system dialog, clipboard and external-link results; they do not prove OS picker interaction, a model host's behavior, native IME behavior or release signing. Native menu history remains a separate foreground verification gate; keyboard history alone does not establish it.

For isolated native verification, trusted launch environments can set `AGENTSPACE_USER_DATA` to an absolute temporary directory before launch. Renderer and MCP requests cannot choose this path. Tests must not reuse a person's normal profile or modify host configuration.

The boundary follows Electron's [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [custom protocol](https://www.electronjs.org/docs/latest/api/protocol) APIs. The actual pinned runtime, rather than system Node alone, is exercised by the native checks.
