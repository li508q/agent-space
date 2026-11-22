# AgentSpace

**Work with AI. Stay in control.**

A local personal workspace for writing, connected context, and human–agent collaboration. Keep your material in one space, understand proposed changes and their sources, and decide what becomes part of your work.

## Delivery status

AgentSpace is in staged development. The local desktop now runs from source: write directly, connect a scoped MCP client, inspect a proposal and its cited version, then accept or reject it. Real Electron checks cover persistence, later-edit protection and interrupted-response recovery. Project organization, records, import and backup are the next stage; an install package is not published yet.

## Product direction

- Read and write directly, without requiring a model account.
- Connect notes, projects, records, sources, and reusable assets.
- Give different agents bounded, versioned context through real local tools.
- Review changes with their purpose, differences, and supporting material.
- Preserve human edits, inspect history, and recover safely.
- Serve English, Chinese, Japanese, Korean, and Spanish readers.

## Design and delivery

- [Product brief](docs/product-brief.md)
- [Product requirements and acceptance targets](docs/PRD.md)
- [Phases and current milestone](docs/DELIVERY.md)
- [Architecture and decisions](docs/ARCHITECTURE.md)
- [Implemented core API](docs/CORE_API.md)
- [Interaction specification](docs/UX.md)
- [Implementation slices](docs/IMPLEMENTATION.md)
- [Test strategy and current evidence](docs/TESTING.md)
- [Contributor agent guidance](AGENTS.md)

The first release focuses on local, single-user work. Its scope and verification targets are defined in the requirements; research proposals are not presented as implemented capabilities.

## Development checks

Use the Node version in `.nvmrc`, then run:

```sh
npm ci
npm run check
npm run dev
```

`dev` builds and opens the local desktop. See [desktop setup](docs/DESKTOP.md), [agent configuration](docs/AGENT_PROTOCOL.md) and [test evidence](docs/TESTING.md) for the implemented subset and exact verification boundaries.

[MIT license](LICENSE).
