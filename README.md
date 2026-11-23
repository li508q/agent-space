<p align="center"><img src="docs/assets/banner.svg" alt="AgentSpace — Work with AI. Stay in control." width="1200"></p>

<p align="center">English · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

AgentSpace is a local workspace for writing, connected project material and collaboration with different agents. Read the sources, inspect proposed changes and decide what becomes part of your work.

Use the workspace without a model account or API key. Connect an external agent when you want help reading or changing material.

<img src="docs/assets/workbench.png" alt="The AgentSpace desktop with synthetic example material" width="1200">

## What you can do

- **Write and resume.** Edit Markdown, keep recovery drafts and return to recent work.
- **Build project context.** Connect notes, documents, typed records and reusable assets. Open a project to see its text, continuation references and accumulated material.
- **Prepare an agent's starting context.** Inspect a brief with saved-version references, then create explicit MCP or CLI access.
- **Review changes.** Read a proposal's reason, diff and cited sources before applying or rejecting it. Inspect accepted versions and use guarded undo.
- **Keep and move your data.** Import editable copies while preserving originals; create a full backup or a readable export of current content.
- **Choose your language.** English, Simplified Chinese, Japanese, Korean and Spanish. Authored content keeps its original language.

<img src="docs/assets/review.png" alt="An agent proposal with its reason, diff and cited source versions" width="1200">

## Run locally

The current desktop target is **macOS Apple Silicon**. To run from source:

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

Use the Node version in [`.nvmrc`](.nvmrc). Create a space, open an existing one or try the separate example space. [Usage guide →](docs/guides/en.md)

Run `npm run package:mac` on an Apple Silicon Mac to build a standalone app with its own runtime. See [desktop setup](docs/DESKTOP.md) for build, signing and platform details.

To connect an agent, open **Settings → Set up agent access**, choose objects and capabilities, and copy the generated configuration into your MCP host. Creation of new notes or records needs a separate permission. [MCP and CLI →](docs/AGENT_PROTOCOL.md)

## Your data and access

Spaces are local files you control. AgentSpace does not encrypt them; use your operating system to protect local data and backups. External asset references retain links to files you manage separately.

A connected agent can receive authorized material, and its host may send it to a model provider under that host's settings. Local storage does not prevent this sharing. Revoking access stops future tool requests; it cannot recall content already supplied. Prepared or copied context does not prove model understanding or task completion.

[Data and trust boundaries](docs/SECURITY.md) · [Backup and recovery](docs/LOCAL_DATA.md)

## Develop and contribute

See [contributing](CONTRIBUTING.md) for the development workflow and checks, [architecture](docs/ARCHITECTURE.md) for the shared core, and [CI](https://github.com/li508q/agent-space/actions) for automated results.

[Documentation](docs/README.md) · [Product scope](docs/PRD.md) · [Verification and limits](docs/TESTING.md) · [MIT license](LICENSE)
