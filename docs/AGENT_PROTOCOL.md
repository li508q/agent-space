# Agent protocol

AgentSpace exposes ten scoped capabilities over stdio MCP or a single-call CLI. Both adapters open an existing local space and use `AgentServices`. They run without a model account, HTTP listener or background agent runner.

## Launch configuration

Create access in the desktop and copy the generated configuration. The launcher supplies identity and credentials outside model-visible tool arguments:

| Value              | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `--space`          | Absolute directory of an existing supported space.                |
| `--instance`       | Selected instance UUID; restore requires a new configuration.     |
| `--grant`          | Human-issued grant UUID and agent operation namespace.            |
| `AGENTSPACE_TOKEN` | One-time token in the environment, never a command-line argument. |
| `--tool`           | CLI only: one tool name from the table below.                     |

A grant includes readable scope and proposal capability. Object grants include readable retained and later versions; links do not grant their targets. Creating documents/records requires separately enabled creation capability on a space grant. Human save, decisions, undo and grant administration are unavailable to agents.

Tokens are credentials. Keep them out of source control and logs. Lost issuance requires revoking the recovered grant and creating another. Configuration copy does not establish a connection; subsequent tool calls provide observed activity. A client label is a declaration, not verified model identity.

### Standalone development adapter

Use the repository's supported Node version and locked dependencies:

```sh
npm ci
npm run build:agent
node dist/agent/adapters/entry.js --agent-server \
  --space "$AGENTSPACE_SPACE" \
  --instance "$AGENTSPACE_INSTANCE" \
  --grant "$AGENTSPACE_GRANT"
```

Set the three identity variables and `AGENTSPACE_TOKEN` securely from the selected configuration. The compiled entry is `dist/agent/adapters/entry.js`; importable adapters are in `dist/agent/adapters/index.js`.

### Packaged adapter

The actual application executable accepts `--agent-server` and `--agent-cli` before window creation, preferences or the desktop single-instance lock. It uses bundled Node and needs no system Node. Generated configuration records that executable. Place and open the app in its intended location before creating access. After a later move, update the command path in the agent host's existing MCP configuration and reconnect. See [Desktop](DESKTOP.md).

The server refuses missing, incompatible or incorrectly bound spaces and invalid/revoked grants. It never creates a space, migrates a database or falls back to another path. Each call and continuation rechecks authorization. EOF closes the connection; a committed proposal remains durable.

## Tools

Inputs use strict shared schemas. Unknown keys fail. Tool arguments cannot choose an actor, namespace, space path, grant/token, SQL or executable.

| Tool                   | Input and result                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `space_discover`       | `{}` → configured identity, visible kinds, scope, capabilities and small usage hints; at most 8 KiB.                                   |
| `objects_query`        | Filter, limit, budget and optional cursor → current summaries and executed scope. Literal text is `filter.text`.                       |
| `object_read`          | Current/pinned ref, section and budget, or cursor and budget → exact pin/digest, actual range, byte count and continuation.            |
| `proposal_create`      | Create/update candidate, purpose, reason, sources and stable operation key → proposal receipt.                                         |
| `changes_list`         | Bounded sequence window and limit → authorized events, continuation and `acceptedChangeReadable`.                                      |
| `operation_status`     | Original key in this grant namespace → original receipt separately from current proposal status.                                       |
| `schema_describe`      | Optional kind and budget → object/property/relation semantics.                                                                         |
| `text_search`          | Required literal `filter.text`, filters, limit, budget and cursor → bounded scoped summaries.                                          |
| `relations_expand`     | Seed, direction, predicates, depth/node/edge limits and budget, or continuation → resolved typed edges and scope gaps.                 |
| `accepted_change_read` | Accepted change ID, summary/evidence section and budget, or continuation → original declaration, accepted pin and authorized evidence. |

MCP results contain the Core JSON Result as text and structured content. Failures retain stable code, retryability and safe parameters with `isError:true`. Invalid names/shapes return `INVALID_INPUT`; malformed protocol envelopes can produce a protocol error or end the connection. Stdout is protocol-only; sanitized diagnostics use stderr.

Stdio supports the SDK's legacy initialization and `2026-07-28` modern opening. Buffered transport input is capped at 2,097,152 bytes and must be valid UTF-8. SDK pins are in `package.json`.

## Acquire context progressively

1. Call `space_discover` for scope, limits and capability names.
2. Use `schema_describe` for semantics and `objects_query`/`text_search` to find relevant objects.
3. Follow explicit relationships only when useful. Check limits and unavailable references.
4. Read the selected exact pins and needed sections. Follow continuations with the same request contract.
5. Submit one sourced proposal per object. A successful proposal receipt is not human acceptance.

These operations compose freely; they do not prescribe a workflow. Properties belong to individual objects. Read actual keys, labels, types and choices; agent updates may change allowed values, not redefine fields. Dates are authored dates, not a temporal-fact engine.

Search uses NFKC/lowercase literal matching, with a scoped short-query fallback. Accents remain significant. Results are summaries, without snippets, semantic scores or a recall guarantee. Query and search cursors are separate. Starting budgets of 16 KiB for schema/search/relations and 32 KiB for an accepted summary are application defaults, not mandatory task steps.

### Versions and review metadata

`filter.knowledgeReviewStates` is an optional set of 1–3 unique values: `never-reviewed`, `current-reviewed`, `changed-since-review`. Values use OR within the set and AND with other filters. Empty/duplicate/unknown values fail. Canonical order permits equivalent reordered sets to continue; changed members, limits or budgets do not.

Summaries include current H, reviewed R and the derived state. Historical ref/title/digest still describe that historical version; H/R describe the current head observed by the read. They are outside the revision digest. Human review can stale a query without changing the pin. Saving, applying, reading or seen markers do not review knowledge or certify truth.

### Relationships and budgets

`belongs_to` targets a current project; `related` follows current identity; `source` requires a pin; `uses` targets an asset in current/pinned mode; `continues_from` allows either. Expansion is breadth-first over current owners; pinned destinations are terminal. Incoming discovery matches identity while retaining the owner's original cited pin.

Depth is at most two, total nodes/edges at most 50, with a 5,000 authorized-candidate work cap. Those limits cover the traversal across pages, not database latency. Inspect `traversalCompleteWithinScope` and `stopReasons` even on the last page. Unreadable outgoing targets set aggregate availability without entering the frontier; hidden incoming owners are not disclosed.

Bounded reads accept 1,024–65,536 bytes. `returnedBytes` measures the complete UTF-8 Core Result, including cursor/count fields; MCP framing and duplicated text/structured encoding are additional. Ranges contain whole code points or entries. An indivisible item returns `LIMIT_EXCEEDED` with `requiredBytes`.

Query/search/graph/evidence cursors bind parameters, authority, instance and scope/generation. Restart on `CURSOR_STALE`; complete revocation returns `FORBIDDEN`. Exact object-read continuations retain their resolved historical pin across head changes and still recheck authorization. Prepared activity, drafts and seen markers do not advance authority.

## Continue from an accepted change

1. Find a `changes_list` item with `acceptedChangeReadable:true`.
2. Read its ID with `accepted_change_read`, `section:"summary"` and a budget.
3. Read `section:"evidence"` and its continuations, then read the returned source pins explicitly.

The target pin, declaration and evidence remain those of the original acceptance after later edits, source changes or undo. Direct human saves and pending/rejected/conflicted proposals are not accepted-proposal records. The originating agent's revocation does not remove another currently authorized reader's access.

Target access includes its retained declaration but does not authorize sources. Evidence exposes only independently authorized entries, without hidden IDs, titles, locators, bodies or counts. Missing evidence is explicit. Declared reasons remain authored text; the Core does not certify their truth or scrub content an author deliberately included.

## Mutation recovery

Retain the original operation key and request until its outcome is known. Same-key/same-request replay recovers the recorded original proposal even after later processing. `currentProposal` reports later status separately. Different requests cannot reuse a key. `operation_status.not_found` does not establish failure.

Prepared activity records references and ranges assembled by Core. It does not certify stdout emission, host receipt, model understanding or completion.

## Clipboard formats

Copy saved context uses `agentspace-context/v1` for one saved object or explicitly selected body text. Prepare context uses the separate `agentspace-brief/v1` format:

| Field                | Meaning                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | `agentspace-brief/v1`.                                                                                                                                                        |
| `scope`              | Selected saved versions; `completeProjectSnapshot:false`, `relationTraversal:"none"`.                                                                                         |
| `space`              | Selected space ID, instance and title.                                                                                                                                        |
| `task`               | Optional human intent, at most 1,000 Unicode code points.                                                                                                                     |
| `references`         | 1–20 distinct pins, each with saved title, kind and digest. Different revisions remain distinct.                                                                              |
| `referenceGroups`    | `startingSavedVersion`, `directLinksInStartingVersion`, `currentActiveProjectMaterialAsQueried`, `earlierSelectedResults`; each indexes selected pins and groups may overlap. |
| `projectGoalExcerpt` | Optional selected starting project's exact prefix, at most 280 code points, with pin/unit/truncation.                                                                         |
| `usage`              | `read:"exact-pins"`, `changes:"proposals"`, `delivery:"clipboard-only"`.                                                                                                      |

The desktop verifies selections. It does not recursively include linked bodies, credentials, recorded filesystem locators or unselected bodies. Removing the starting project removes its title/excerpt. The brief is neither an as-of project snapshot nor an access grant. Copied text does not confirm host receipt.

## Single-call CLI

The CLI reads one valid UTF-8 JSON value from stdin, capped at 2,097,152 bytes, and writes one newline-terminated Result:

```sh
printf '%s\n' '{}' | node dist/agent/adapters/entry.js --agent-cli \
  --space "$AGENTSPACE_SPACE" \
  --instance "$AGENTSPACE_INSTANCE" \
  --grant "$AGENTSPACE_GRANT" \
  --tool space_discover
```

| Exit | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | Successful Result. Inspect its business outcome. |
| `1`  | Core/startup failure.                            |
| `64` | Launch, tool or schema error.                    |
| `65` | Invalid JSON/UTF-8 or oversized input.           |
| `70` | Unexpected adapter failure.                      |

Server startup failures emit a sanitized Result to stderr and leave stdout empty. `--help` uses stderr and needs neither credentials nor an open space.

## Adapter integration

`runAgentMode(mode: 'server' | 'cli', argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number>` is exported by the compiled adapter index. Pass only arguments after the mode flag; detect the mode before normal desktop startup. The function owns stdin/stdout/stderr and its Core connection, not Electron lifecycle or `process.exit()`. Do not import `entry.js` into Main: it dispatches on load.

Map generated command/arguments/environment to the host's actual configuration format. Generic stdio JSON is not a universal host schema; generated Codex TOML targets `mcp_servers`. Host settings remain under the host owner's control.
