# Contributing to AgentSpace

AgentSpace helps a person understand and direct work shared with AI agents. A contribution should make writing, context, changes or recovery clearer. Keep the product useful without a model account and focused on one person's local space.

## Run locally

Use the Node version in `.nvmrc` and the committed npm lockfile:

```sh
npm ci
npm run dev
```

`dev` builds the application and opens Electron. It is not a hot-reload server. Use a separate example space or temporary space for development; do not test destructive or failure cases with personal material.

## Find the right layer

| Path                | Responsibility                                           |
| ------------------- | -------------------------------------------------------- |
| `src/contracts/`    | Strict inputs, results and shared meanings               |
| `src/core/`         | Authorization, persistence, versions and mutation rules  |
| `src/adapters/`     | MCP and single-call CLI over the same core               |
| `src/desktop/`      | Native dialogs, application lifecycle and bounded IPC    |
| `src/renderer/`     | Writing, organization, review and localized presentation |
| `tests/acceptance/` | Cross-layer fixtures and real desktop flows              |

The core owns accepted changes. The renderer and MCP adapter must not acquire a second save path. A relationship does not grant access to its target; a proposal is not an accepted revision. Preserve these distinctions when changing an interface.

## Verify a change

```sh
npm run check
npm run format:check
npm run docs:check
npm run build
```

For desktop changes on macOS, run the GUI suites serially. Do not run another Electron QA session at the same time:

```sh
npx tsx --test --test-concurrency=1 tests/desktop/*.test.ts tests/acceptance/*.e2e.ts
```

Use real SQLite files for persistence changes and a real SDK client for protocol changes. Tests should check a meaningful failure or user outcome. A mock editor or browser page does not establish native acceptance. State what ran, what it proved and any platform limitation in the pull request.

## Writing and interface changes

Keep primary copy concise and preserve user-authored text. Add product strings to all five dictionaries: English, Simplified Chinese, Japanese, Korean and Spanish. Key and interpolation parity is checked; that does not replace checking the actual controls, long labels, keyboard focus and zoom.

Use the existing local tokens, icons and font stack. Prefer clear document and change views over extra dashboards. Explain declared agent intent, supplied references and durable results; do not imply that the application sees a model's private reasoning or knows an external task has finished.

## Documentation and comments

Write for the person operating the product or maintaining the code. Use prerequisites, actions, results and limits. Comments explain an invariant or a non-obvious mechanism; avoid development chronology and repair narratives.

Keep one maintained reference per topic: requirements in PRD, interaction state in UX, authority and modules in ARCHITECTURE, service contracts in CORE_API/AGENT_PROTOCOL, and commands/coverage in TESTING. Update all five user guides when an operation changes. Use version-derived artifact paths and keep implementation claims tied to current behavior.

## Before opening a pull request

Describe the concrete problem, the resulting behavior and relevant verification. Update usage documentation when a user-visible promise changes. Keep generated builds, private spaces, access tokens and `.coordination/` out of commits. Use synthetic material in tests and screenshots.

Contributions are provided under the repository's [MIT license](LICENSE).
