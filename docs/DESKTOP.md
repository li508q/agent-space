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

See [Agent protocol](AGENT_PROTOCOL.md) for tool names, scope and operation recovery. The application package and its generated executable configuration have also been verified after ZIP extraction and relocation; see the packaging evidence below. Development-mode integration alone would not establish those claims.

## Checks

```sh
npm run check
npm run test:desktop:agent
npm run test:desktop
```

The first runs type/lint and contract, core, editor, localization, desktop unit and real standalone protocol checks. `test:desktop:agent` compiles and invokes real Electron CLI/MCP processes without a window. `test:desktop` builds the real UI and runs desktop files serially. Run it without another GUI acceptance process competing for foreground focus. Native tests substitute selected operating-system dialog, clipboard and external-link results; they do not prove OS picker interaction, a model host's behavior, native IME behavior or release signing. Native menu history remains a separate foreground verification gate; keyboard history alone does not establish it.

For isolated native verification, trusted launch environments can set `AGENTSPACE_USER_DATA` to an absolute temporary directory before launch. Renderer and MCP requests cannot choose this path. Tests must not reuse a person's normal profile or modify host configuration.

The boundary follows Electron's [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [custom protocol](https://www.electronjs.org/docs/latest/api/protocol) APIs. The actual pinned runtime, rather than system Node alone, is exercised by the native checks.

## macOS arm64 package

The packaging scripts target Apple Silicon macOS only. Their input checks are separate from building or launching an application:

```sh
npm run package:check
npm run icons:mac
```

`package:check` verifies pinned packaging tools, the native icon and strict path/hash/dependency-boundary rules using temporary synthetic inputs. `icons:mac` converts the original SVG mark to PNG/ICNS using AppKit, `sips` and `iconutil`, without opening a window. The generated icon is committed, so normal packaging does not require Swift.

Build a local app and ZIP on an Apple Silicon Mac:

```sh
npm run package:mac
```

This runs the production build, stages only compiled main/preload, a bundled agent entry, renderer resources and license notices, then creates an ASAR application with the pinned Electron runtime. It copies no repository source tree, tests, `.coordination`, spaces, credentials or runtime `node_modules`. A separate agent bundle is necessary because Main loads that entry lazily. Bundling permits only Node built-ins and Electron as runtime externals; Electron supplies `node:sqlite` and Node itself. Source/output hashes reject stale or changed production inputs. Third-party notices come from packages actually present in the bundle graph.

For a production build already verified by native tests, use:

```sh
npm run build:production
npm run package:mac -- --check
npm run package:mac -- --skip-build
```

`--check` reads and verifies the production manifest without building or packaging. `--skip-build` requires matching source/output hashes. Packaging refuses to overwrite a previous artifact for the same version. Normal development `build`/`build:desktop` commands retain their existing behavior; production mode adds minification and the self-contained agent bundle.

For version 0.1.1, outputs are:

- `release/AgentSpace-0.1.3-macOS-arm64/AgentSpace.app`
- `release/AgentSpace-0.1.3-macOS-arm64.zip`
- `release/AgentSpace-0.1.3-macOS-arm64.sha256` and `release/SHA256SUMS`

The ZIP contains the app, five-language `START.md`, license material and `BUILDINFO.json`. ZIP creation preserves macOS framework symlinks. ASAR entries are checked against the exact staged allowlist and hashes; signature verification fails the package command if invalid. No installer writes `/Applications`, no host configuration is edited, and nothing is uploaded.

The configured signature is explicitly **ad-hoc**, with no Developer ID, notarization or hardened-runtime claim. No signing certificate or account is selected automatically. This is a local distribution artifact, not a claim that downloaded copies pass Gatekeeper. Electron's [signing documentation](https://www.electronjs.org/docs/latest/tutorial/code-signing) explains the separate Developer ID/notarization requirements. Packaging uses the official [Packager options](https://electron.github.io/packager/main/interfaces/Options.html) and [ASAR APIs](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

Move the app to a chosen local folder and launch it normally. A direct editor session needs no separate Node installation or API key. The executable also provides `--agent-cli`/`--agent-server`; tokens stay in `AGENTSPACE_TOKEN`. Copy a fresh host configuration after moving the app so it references the new executable path. Spaces and preferences remain outside the bundle and require their own backup.

The macOS arm64 production app and ZIP have been built. Actual verification extracts the ZIP into a new private directory, moves the app to a path containing spaces and checks its ASAR, signature and checksum:

```sh
npm run package:verify
```

The moved executable passes real CLI and simultaneous legacy/modern SDK stdio MCP checks with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, where system Node does not resolve. Each protocol invokes the ten tools, reconstructs exact pinned Unicode pages, rejects outside-scope reads and creates a proposal whose content remains unapplied until explicit human review. Agent modes create no desktop preferences/installation/instance lock. The tested built-in runtime is Electron45.4.1, Node24.22.3 and SQLite3.54.1. A supplemental Node-mode query reads those runtime versions; the product CLI/MCP checks use the real app entry without Node mode.

`release/AgentSpace-0.1.3-macOS-arm64.verification.json` records artifact hashes and observed runtime checks without personal paths or tokens. The moved app is retained privately for native acceptance. CI can run `package:verify` after `package:mac`; it requires Apple Silicon macOS and makes no support claim elsewhere. These checks do not launch a GUI. Packaged GUI/five-language/source/import/restore acceptance remains separate, as do Developer ID, notarization and downloaded-copy Gatekeeper acceptance.
