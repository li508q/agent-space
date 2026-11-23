<p align="center"><img src="docs/assets/banner.svg" alt="AgentSpace — Work with AI. Stay in control." width="1200"></p>

<p align="center">English · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

A local workspace where you write directly, different agents share context, and proposed changes stay understandable. See the reason, inspect the cited version, and decide what becomes part of your work.

**Status:** Early local release. Core collaboration is implemented; usability refinements remain open. [Review scope and open work](docs/PRODUCT_REVIEW.md).

<img src="docs/assets/workbench.png" alt="The real AgentSpace desktop with synthetic example material" width="1200">

## What you can do

- **Write and organize.** Keep notes, documents, projects, lightweight records and reusable asset references in one space.
- **Share precise context.** Give an agent scoped MCP or CLI access. Discover, filter, search, follow links and read exact versions within explicit budgets.
- **Understand changes.** Review an agent's purpose, reason, differences and evidence before applying a proposal. Accepted explanations remain available to the next authorized agent.
- **Keep your work.** Preserve drafts, inspect history and use guarded undo without replacing later edits.
- **Bring material in and take it away.** Preview folder imports; create a full-history backup or readable current-content export.
- **Use your language.** English, Simplified Chinese, Japanese, Korean and Spanish UI. Your authored content keeps its original language.

AgentSpace works without a model account. Connect the agents you already use when you want them to read or propose changes.

<img src="docs/assets/review.png" alt="A real agent proposal with its reason, diff and exact evidence" width="1200">

## Start locally

The first delivery targets macOS Apple Silicon. Use the locally built application, or build from source:

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

Use the Node version in [`.nvmrc`](.nvmrc). Open a clearly marked example space, or create a local space and start writing. [Read the guide →](docs/guides/en.md)

For a standalone app, run `npm run package:mac` on an Apple Silicon Mac. The app includes its own runtime. [Desktop build details →](docs/DESKTOP.md)

To connect an agent, open **Settings → Agent access**, choose its scope and capabilities, then copy the generated configuration. New notes and records require separate creation access. Agent proposals become accepted content only after your review. [MCP and CLI details →](docs/AGENT_PROTOCOL.md)

## Built around clear boundaries

One transactional SQLite core serves the Electron desktop and real MCP/CLI adapters. Stable object IDs, typed relationships, exact source versions and durable receipts keep those clients on the same data. React and CodeMirror provide the writing interface; a narrow sandboxed preload mediates native actions.

Local storage belongs to you. External agents receive the material requested through their grants; their provider settings remain with the host you connect. A prepared result records references assembled for a response; it does not confirm host receipt, model understanding or task completion. Private model reasoning is not captured.

[Architecture](docs/ARCHITECTURE.md) · [Data and trust boundaries](docs/SECURITY.md) · [Verification](docs/TESTING.md)

## Contribute

```sh
npm run check
npm run format:check
npm run build
```

See [contributing](CONTRIBUTING.md), [requirements](docs/PRD.md) and the [documentation index](docs/README.md). The first release focuses on a person's local work; cloud collaboration, general chat, broad integrations and app execution are outside its scope.

[MIT](LICENSE). Local build and platform verification limits are described in the guide.
