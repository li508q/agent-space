# Testing

The checks exercise real local SQLite, compiled adapters and Electron. Fixtures use synthetic content and private profiles. This document describes reproducible commands, invariants and verification boundaries; CI results and generated package reports identify the revision and artifact actually tested.

## Source checks

Use a Node version accepted by `package.json` (`.nvmrc` selects the default) and the committed lockfile. From the repository root:

```sh
npm ci
npm run check
npm run format:check
npm run docs:check
```

`check` runs strict TypeScript, ESLint with zero warnings, compiled Core/agent builds, and contract, Core, UI-state, localization, desktop-unit and actual standalone CLI/MCP suites. It does not launch the graphical application.

| Focused command              | Coverage                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:core`          | Builds Core and runs its real-file, proposal, query, draft, concurrency and local-data tests.                                                   |
| `npm run test:local`         | Builds Core and runs import/artifact/cross-process plus no-window local-data adapter checks.                                                    |
| `npm run test:protocol`      | Builds adapters and invokes the actual standalone CLI and MCP processes; MCP calls use SDK clients.                                             |
| `npm run test:desktop:agent` | Builds Main/preload and invokes real Electron agent modes without a window.                                                                     |
| `npm run test:desktop`       | Builds the UI and runs `tests/desktop/*.test.ts` serially. Acceptance files are separate.                                                       |
| `npm run package:check`      | Checks installed packaging tools, icon and strict input/allowlist/hash boundaries using temporary synthetic inputs; no product build or launch. |

A focused pass establishes only that suite's scope. Runtime, driver, schema, protocol and production-input changes require the relevant compatibility and artifact checks again.

## Native desktop checks

Native tests require macOS, an unlocked visible desktop and one foreground GUI owner. Run them serially without another application-acceptance process competing for focus:

```sh
npm run build
npx tsx --test --test-concurrency=1 tests/desktop/native.test.ts tests/acceptance/*.e2e.ts
```

These tests use actual Electron, preload, React, CodeMirror, SQLite and SDK processes. The harness assigns a private absolute `AGENTSPACE_USER_DATA` directory to each application. It must not reuse a person's normal profile, spaces or host configuration.

The native composition suite also checks failed-save closure in all five languages: cancelling the native discard confirmation preserves current input and its retained draft; confirming closes normally, and reopening can recover that draft. Only persistence failures and the OS dialog choice are supplied by the fixture. Real close nonces, binding checks, preload, editor and draft storage remain active.

To reproduce a smaller native work area for the acceptance files:

```sh
AGENTSPACE_TEST_WINDOW_MAX=1024x688 \
  npx tsx --test --test-concurrency=1 tests/acceptance/*.e2e.ts
```

The maximum is a harness control and is removed from the application's environment. Geometry records distinguish requested bounds, controlled maximum, actual native/content bounds, OS work area, CSS viewport, zoom and DPR. An OS-clamped window is checked against the observed work area. Keyboard/pointer assertions use actual focus, caret, glyph, outline, clipping and hit-test geometry, rather than assuming a complete pane is visible.

### Native-device and fault isolation

OS chooser selections and selected external-link results are supplied by trusted test fixtures. The product's request/schema/binding/Core handlers still execute. This verifies the workflow after a path/result is supplied; physical chooser interaction needs separate observation.

Before any automated copy, install [clipboard-fixture.ts](../tests/acceptance/clipboard-fixture.ts). It replaces only Main's `clipboard.writeText` device with an in-memory sink, records original handler/function provenance, reads only that sink and restores the device during cleanup. Ordinary automated checks must not read, overwrite, clear, snapshot or restore the person's OS clipboard. These assertions verify copied payloads and the real business boundary; OS clipboard delivery remains a physical-device check.

The privileged Main fault fixture wraps already registered IPC handlers. It can hold or lose a successful reply while retaining sender, schema, binding, authorization and transaction checks. Faults stay in test processes; the product has no renderer fault hook or production fault flag. Unknown-result cases retain the original key and input, then recover the actual durable outcome.

The separate no-debugger renderer-crash observer in `tests/desktop/native.test.ts` uses the development entry. Packaged Electron does not execute its development `--require` observer. Cleanup termination is not evidence of a normal product close or a successful crash-recovery flow.

## Critical invariants and test locations

| Boundary                       | Required observable result                                                                                                                                                                                                                                                                                     | Main test locations                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Persistence and concurrency    | Reopen retains exact immutable revisions. Same-base races have one winner; canonical same-key races recover one original result. A process killed before commit leaves no accepted head/change/receipt/search text; a commit with a lost reply is discoverable under its original key.                         | `tests/core/persistence.test.ts`, `concurrency.test.ts` and compiled workers                                                         |
| Proposal authority             | Proposing leaves accepted content unchanged. Creation reserves an ID; rejection creates no accepted object. Acceptance binds hash/status/target and rechecks the originating grant/protection. Rejection remains possible after later edits or revocation.                                                     | `tests/core/proposals.test.ts`, protocol suites, `native-workbench.e2e.ts`                                                           |
| Undo and history               | Later revisions, including ABA content histories, block old undo. Creation undo archives without erasing identity. Exact accepted results and source pins remain readable after current heads advance.                                                                                                         | Core proposal/read tests, `native-workbench.e2e.ts`, `native-change-discovery.e2e.ts`                                                |
| Scoped context                 | Hidden objects contribute no titles, counts or snippets. Queries bind scope/filter/sequence and restart on stale cursors. Read continuations retain an exact pin, recheck grants and reconstruct valid Unicode within full JSON byte budgets.                                                                  | `tests/core/context.test.ts`, `reads-drafts.test.ts`, `tests/protocol/context.test.ts`                                               |
| Human input                    | Dirty/composing buffers survive external saves and obsolete callbacks. Save/draft failures, lost replies, navigation cancellation and close recovery preserve later input. Reading K1 and editing current K2 saves K3 on the same object ID.                                                                   | `tests/ui/editor*.test.ts`, `transition.test.ts`, `close.test.ts`; native composition/navigation/response-loss/project-reading files |
| Change discovery               | Reopen finds human saves and applied/rejected proposals through durable changes and processed review. Fixed result, current version and prepared references remain distinct. Pagination failure preserves earlier pages and retries the same cursor; reader return preserves the actual collection/checkpoint. | `tests/ui/change-discovery.test.ts`, `native-change-discovery.e2e.ts`                                                                |
| Knowledge review               | Current-head filters agree across human and agent queries. Reviewed K1 followed by K2 becomes changed-since-review. Proposal/read/seen state does not certify knowledge. Continue and Library use their intended recent-work and browsing scopes.                                                              | Core/UI/protocol `knowledge-review.test.ts`, `native-knowledge-discovery.e2e.ts`                                                     |
| Context preparation and access | Saved historical pins, declared links and queried current members remain distinct. Selection stays bounded; copied preview bytes agree. Object grants use an explicit ID set; later project membership never expands access. Old binding/selection/configuration replies cannot replace newer state.           | `tests/ui/context-setup.test.ts`, `native-context-setup.e2e.ts`, `native-context-focus.e2e.ts`                                       |
| Import                         | Preview/confirmation and per-item outcomes preserve original bytes. Same-source/version retry returns the original object/pin and preserves later human edits and relationships. Changed sources need fresh review; pagination never combines revisions.                                                       | `tests/core/local-import.test.ts`, local workers, native local-data/local-UI files                                                   |
| Backup, export and restore     | Concurrent-writer backup is consistent, including a capacity-full source. Restore binds exact reviewed/acquired bytes, rejects replacement and occupied destinations, assigns a new instance and disables copied grants. Export contains current objects; foreign drafts require explicit human recovery.      | `tests/core/local-artifacts.test.ts`, local workers, `tests/desktop/local-unit.test.ts`, native local-data/local-UI files            |
| Desktop security               | Untrusted sender/frame/origin/schema/binding requests fail. Renderer resources and Markdown cannot acquire filesystem, SQL, shell or arbitrary navigation capability.                                                                                                                                          | `tests/desktop/unit.test.ts`, `local-unit.test.ts`, `native-bridge.e2e.ts`                                                           |
| Language and native layout     | English, Simplified Chinese, Japanese, Korean and Spanish preserve authored content while primary controls, errors and recovery remain reachable at normal/enlarged text and short windows. Focus/caret and reader return remain observable.                                                                   | `tests/ui/i18n.test.ts`, native locales/project-reading/change/knowledge/context files                                               |

Test paths in the final column are under `tests/acceptance/` when named `native-*.e2e.ts`. [CORE_API.md](CORE_API.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [LOCAL_DATA.md](LOCAL_DATA.md) define the corresponding contracts.

## Package verification

On an Apple Silicon Mac, after source checks:

```sh
npm run package:check
npm run package:mac
npm run package:verify
```

Packaging creates a version-derived application and ZIP. Verification checks the exact ZIP checksum, ASAR allowlist/hashes, internal symlinks and deep/strict ad-hoc signature, then extracts and moves the application to a path with spaces. The actual moved executable runs CLI and simultaneous legacy/modern SDK stdio clients under a PATH that cannot resolve system Node. Tool checks cover bounded pinned Unicode reads, scope denial, reviewable proposals and accepted explanations. Agent modes must create no desktop profile/installation identity/singleton lock. Tokens stay out of reports.

`package:verify` launches no GUI. To run visible-control acceptance against the existing package:

```sh
package_version=$(node -p "require('./package.json').version")
AGENTSPACE_TEST_EXECUTABLE="$PWD/release/AgentSpace-$package_version-macOS-arm64/AgentSpace.app/Contents/MacOS/AgentSpace" \
  npx tsx --test --test-concurrency=1 tests/acceptance/*.e2e.ts
```

The override selects the actual executable and omits the development app entry. Use the package report and hashes to identify the artifact. Source checks, bundled-runtime verification and packaged GUI checks establish different boundaries; retain each result with its actual build inputs. Rebuild and repeat affected checks when production inputs change. Commands, output paths and signing details are in [DESKTOP.md](DESKTOP.md).

## Continuous integration

The [Verify configuration](../.github/workflows/ci.yml) runs on main pushes, pull requests and manual dispatch. The [Verify workflow](https://github.com/li508q/agent-space/actions/workflows/ci.yml) shows the latest run status and logs.

| Job                                         | Configured execution                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core                                        | Ubuntu 24.04 with Node `22.22.3` and `24.22.3`: locked install, `check`, formatting and documentation checks.                                                                                                                                                      |
| macOS native and package                    | macOS 15: build; actual Electron agent modes and native bridge/local-data checks; serial writing, navigation, composition, response-loss, organization, project/change/knowledge/context/locale acceptance; production package and relocated runtime verification. |
| Packaged visible controls, within macOS job | The newly built executable runs project reading, change discovery, knowledge discovery, context setup and context-focus acceptance. ZIP/checksum/runtime reports are uploaded as temporary CI artifacts.                                                           |

A configured step is not a passing result. Assess the run for the exact source revision and inspect skipped/canceled steps. The macOS job does not include every local acceptance file or the development-only no-debugger crash observer. CI artifacts are local-build outputs with the signing scope below; the workflow publishes no release.

## Verification boundaries

| Area                     | Established scope and remaining boundary                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input and native devices | Composition is driven through Chromium input protocol. Physical OS IMEs, physical chooser operation, OS clipboard delivery and foreground Cocoa menu-role clicks are unverified. Automated menu commands and editor keyboard history have their own coverage.                                                                                                                              |
| Platforms                | Native and package checks cover macOS arm64. Core runs on the configured Node/Linux matrix. Windows, Linux desktop, other architectures and arbitrary accessibility configurations are unverified.                                                                                                                                                                                         |
| Distribution             | Packaging uses ad-hoc signing. Developer ID, notarization, hardened runtime and downloaded-copy Gatekeeper acceptance are unverified.                                                                                                                                                                                                                                                      |
| Storage failures         | Tests cover process termination, response loss, transactional SQLite capacity exhaustion and interrupted artifacts. Host power loss and destination disk-full have no physical-device check. Network-filesystem concurrency is unsupported; Core does not coordinate arbitrary external-file writers. Resource ceilings do not establish large-library performance or unbounded retention. |
| Agent hosts and meaning  | SDK clients exercise the protocol. External-host compatibility, model understanding, answer quality and independently configured model-agent continuation require host-specific validation. Prepared/copy activity does not prove receipt or task completion.                                                                                                                              |
| Human effectiveness      | First-time/long-term usability and native-speaker language review remain unverified. Context preparation has a bounded saved-object/project selection surface, without arbitrary selection across the workspace.                                                                                                                                                                           |
