# Desktop development and packaging

The desktop uses the same `Space` and `HumanServices` authority as the agent adapter. A person can create, open, edit and review local material without a provider account or API key. The packaged application includes its own Node runtime.

## Runtime and development

Use the committed npm lockfile and a supported exact Node version. `.nvmrc` selects `22.22.3`; `package.json` also permits `24.22.3`. Dependency and Electron pins are in `package.json` and `package-lock.json`.

From the repository root:

```sh
npm ci
npm run dev
```

`dev` performs a build and launches Electron. It has no watch server. To build and launch separately:

```sh
npm run build
npm start
```

| Command/output                 | Contract                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                | Compiles Core and standalone adapters, then bundles Main, preload and the real renderer entries.                                                  |
| `npm run build:desktop`        | Compiles Core/adapters and bundles Main/preload; leaves existing renderer output untouched. Use the full build before launching a fresh checkout. |
| `dist/desktop/main.cjs`        | Desktop entry and packaged agent-mode dispatcher.                                                                                                 |
| `dist/desktop/preload.cjs`     | Named renderer business API.                                                                                                                      |
| `dist/renderer/index.html`     | Compiled renderer document served through the application protocol.                                                                               |
| `dist/agent/adapters/entry.js` | Standalone development CLI/MCP process entry.                                                                                                     |

`npm start` requires the compiled Main entry and removes inherited `ELECTRON_RUN_AS_NODE`. If the entry is missing, run the full build and retry. A development build is a launchable application, with packaging and signing handled separately below.

## Desktop boundary and local state

The sandboxed renderer uses context isolation without Node integration. Preload exposes named `window.agentSpace` methods. Main validates the exact WebContents/top frame, application origin, request schema and active binding/space/instance. Reopening the same space creates a new binding. See [ARCHITECTURE.md](ARCHITECTURE.md) for the authority and security contracts.

Only compiled renderer assets are served at `agentspace://app/index.html`. Scripts are local; network connections, remote images, frames, webviews, navigation, new windows and permission requests are denied. Inline styles support CodeMirror and React. Validated HTTP(S) links require a transient human action before opening in the system browser.

Native dialogs select space, import and transfer locations. Canceling preserves the current space. Preferences and a stable human installation namespace live in application-private user data, outside the application bundle. Locale and text zoom persist without changing authored content. Invalid presentation preferences are retained separately and reported; the application does not repair or delete a space in response.

For isolated verification, the trusted launch environment can set `AGENTSPACE_USER_DATA` to an absolute temporary directory. Renderer and MCP requests cannot choose that path. Tests use private profiles and synthetic spaces; see [TESTING.md](TESTING.md).

### Closing with unfinished writing

A close request has a nonce. The renderer must save or durably retain its recovery draft before Main closes the window. If the renderer cannot answer, the window remains open and native recovery offers retry, keep open, copy of text actually received by Main, or confirmed discard. Newer input that never reached Main cannot be reported as copied.

Keep open, retry and error paths end the old nonce through `onCloseCancelled`. Retry starts another request. A late ready reply cannot bypass an already visible native recovery dialog. Save/draft failure retains the buffer and exposes recovery actions; retained input is not labeled Saved.

## Agent process entry

The executable recognizes `--agent-server` and `--agent-cli` before creating a window, loading normal desktop preferences or acquiring the desktop single-instance lock. These modes use Electron's bundled Node runtime. Independent agent processes can share a local space through Core transaction guards.

Generated configuration uses the actual executable and compiled development entry, or the application executable when packaged. `AGENTSPACE_TOKEN` carries the one-time token; tokens are not command-line arguments. Configuration generation rechecks the binding and grant. JSON contains stdio launch parameters; TOML targets Codex's `mcp_servers` format. The application does not write either into host settings. Copying configuration establishes preparation, while actual tool calls establish connection activity.

After moving an application, update its executable path in the host's existing MCP configuration and reconnect. A restored space has a new instance identity and disabled grants; create new access and configuration for that copy. [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) describes tools, grant scope and recovery under the original operation key.

## Checks during development

```sh
npm run check
npm run test:desktop:agent
npm run test:desktop
```

`check` runs type/lint, contract, Core, editor-state, localization, desktop-unit and real standalone protocol checks. `test:desktop:agent` builds Main/preload and invokes real Electron CLI/MCP processes without a window. `test:desktop` builds the UI and runs desktop test files serially; acceptance files have separate commands in [TESTING.md](TESTING.md).

Native checks need a visible macOS desktop and exclusive foreground focus. Selected OS dialog, clipboard and external-link devices are substituted while real IPC and Core handlers run. Their exact scope, physical-device boundaries and CI coverage are documented in TESTING.

## Build a macOS arm64 package

Packaging and artifact verification require an Apple Silicon macOS host. The scripts reject other platforms and architectures. Core CI coverage on Linux does not establish a Linux desktop package.

Check installed packaging tools and input boundaries:

```sh
npm run package:check
```

This checks pinned tools, the committed native icon, path/allowlist/hash rules and bundle dependency boundaries using synthetic temporary inputs. It does not build, package or launch the product.

Create the local application and ZIP:

```sh
npm run package:mac
```

The command builds production assets, stages compiled Main/preload, a self-contained agent bundle, renderer resources and license notices, then creates an ASAR application using pinned Electron. Runtime dependencies are bundled; only appropriate Node built-ins and Electron remain external. Source/output hashes reject stale or changed production inputs. Third-party notices come from the bundled dependency graph.

The staged application excludes repository source, tests, private coordination data, spaces, credentials and runtime `node_modules`. The command validates the ASAR allowlist/hashes and ad-hoc signature. ZIP creation preserves macOS framework symlinks. It creates local outputs without installing into `/Applications`, editing host settings or uploading artifacts.

When reusing an already built production input set:

```sh
npm run build:production
npm run package:mac -- --check
npm run package:mac -- --skip-build
```

`--check` validates the existing production manifest without building or packaging. `--skip-build` requires unchanged source/output hashes. If validation fails, rebuild production inputs and repeat the check. Packaging refuses an existing application directory or ZIP for the same version; preserve or move the earlier artifact before rebuilding that version.

The original SVG icon and generated PNG/ICNS live in `assets/packaging/`. Run `npm run icons:mac` only when regenerating the icon; it uses AppKit/Swift, `sips` and `iconutil`. Normal packaging uses the committed ICNS.

### Version-derived outputs

`package.json` is the application-version source. For `<version>`, packaging creates:

- `release/AgentSpace-<version>-macOS-arm64/AgentSpace.app`
- `release/AgentSpace-<version>-macOS-arm64.zip`
- `release/AgentSpace-<version>-macOS-arm64.sha256`
- `release/SHA256SUMS`

The ZIP also includes five-language `START.md`, license material and `BUILDINFO.json`. To launch the application for the current package version:

```sh
package_version=$(node -p "require('./package.json').version")
open "release/AgentSpace-$package_version-macOS-arm64/AgentSpace.app"
```

Direct writing and the packaged `--agent-cli`/`--agent-server` modes need no separate system Node installation. Spaces and preferences stay outside the bundle and need their own backup.

## Verify the exact package

After packaging:

```sh
npm run package:verify
```

The command verifies the current version's ZIP checksum, extracts it into a private directory, moves the application to a path containing spaces, and checks internal symlinks, ASAR hashes and deep/strict codesign. It then invokes the actual moved executable for CLI and simultaneous legacy/modern SDK stdio clients with a restricted PATH that cannot resolve system Node.

Protocol checks exercise the registered tools, exact pinned Unicode pages, scope denial and proposals that remain unapplied until human review. Agent-only modes must create no desktop preferences, installation identity or singleton lock. The generated `release/AgentSpace-<version>-macOS-arm64.verification.json` records hashes and observed runtime checks without tokens or personal paths.

`package:verify` launches no GUI. Run the relevant packaged native checks from [TESTING.md](TESTING.md) after production inputs change. A report for an earlier artifact does not verify a rebuilt application.

The configured signature is **ad-hoc**. Developer ID signing, notarization, hardened runtime and downloaded-copy Gatekeeper acceptance are unverified. Current native/package verification covers macOS arm64; Windows, Linux and other architectures have no desktop acceptance claim.
