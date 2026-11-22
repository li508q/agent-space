# Local agent protocol

The commands below target the real compiled Node development adapter, including bounded shared-context reads. Native launch modes, a relocated packaged application and a named model host have separate acceptance evidence. This adapter never changes host configuration automatically.

AgentSpace uses the official split MCP server/client SDK 2.4.0. Its stdio server supports legacy initialization and the `2026-07-28` modern opening through the same factory. There is no HTTP listener, model account or background agent runner.

## Build and check

From the repository root with its supported Node runtime and locked dependencies installed:

```sh
npx tsc -p tsconfig.adapters.json
npx tsx --test tests/protocol/*.test.ts
```

This build writes ESM/declarations under `dist/agent`, including its own core/contracts copy. It does not write the parallel core build's entry. The actual Node entry is `dist/agent/adapters/entry.js`; the importable adapter entry is `dist/agent/adapters/index.js`.

The protocol tests spawn that compiled Node entry with the official SDK client in both protocol eras. Isolated, synthetic SQLite spaces exercise independent agent processes, human acceptance through another core connection, old evidence pins after source updates, scoped literal search, bounded relationship pages, revocation, restart replay and fixed Unicode reads. CLI subprocess tests invoke all ten tools and check invalid input, absent/wrong/unsupported spaces without creation/migration, and clean protocol stdout. Source-loss and corrupted-revision cases deliberately bypass immutable-storage protections in disposable fault fixtures; normal product operations cannot create those states. These tests do not establish model understanding, a named model-host integration, native UI behavior, large-space performance or packaged-app support.

## Trusted launch configuration

The launcher provides the following values, outside model-visible tool arguments:

| Field              | Source and meaning                                                               |
| ------------------ | -------------------------------------------------------------------------------- |
| `--space`          | Absolute path to an existing supported local space directory                     |
| `--instance`       | The selected space instance UUID; a restored copy requires explicit reconnection |
| `--grant`          | A human-issued durable grant UUID, also the stable agent operation namespace     |
| `AGENTSPACE_TOKEN` | The one-time token in the launch environment, never a command-line argument      |
| `--tool`           | CLI only: one of the ten names below                                             |

Grant creation and token copying belong to the trusted desktop. A grant's existence or copied configuration does not prove a live host connection. Token loss requires revoking that grant and issuing a new one; receipts do not recover secrets. Do not place a real token in documentation, source control or command-line history.

After securely setting these environment variables to values from the selected space/grant, a developer can run:

```sh
node dist/agent/adapters/entry.js --agent-server \
  --space "$AGENTSPACE_SPACE" \
  --instance "$AGENTSPACE_INSTANCE" \
  --grant "$AGENTSPACE_GRANT"
```

The server opens the space and binds the grant before serving MCP. It refuses missing/empty/incompatible spaces, an incorrect instance or a bad/revoked token. It does not create spaces, upgrade a database or fall back to another path. Each subsequent tool call uses the core's current authorization and scope checks, including revocation while a stdio process remains open. Opening a facade and negotiating/listing protocol capabilities do not create fictional tool activity.

MCP stdout contains only protocol messages. Diagnostics go to stderr without request bodies or tokens. The transport caps its buffered input at 2,097,152 bytes and rejects malformed UTF-8. EOF closes the bridge and its database connection; interrupt/terminate signals end that adapter, while an already committed proposal remains durable.

## Implemented tools

Input schemas come from the shared strict contracts. Unknown fields fail; tools cannot choose an actor, namespace, space path, grant/token, SQL or executable. `space_discover` accepts only an empty object because the core method has no parameters.

| Tool                   | Input and result                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space_discover`       | `{}`; configured space/instance/example identity, visible kinds, scope summary, capabilities and limits                                                                            |
| `objects_query`        | Explicit `filter`, `limit` and `maxBytes`, optional cursor; bounded current summaries and executed scope. Literal text is `filter.text`, including the core's short-query fallback |
| `object_read`          | Explicit current/pinned `ref`, section and `maxBytes`, **or** continuation cursor and budget; actual fixed pin, digest, range, byte count, truncation and next cursor              |
| `proposal_create`      | Shared create/update union, purpose/reason/sources and stable operation key; a candidate receipt, never human acceptance                                                           |
| `changes_list`         | Bounded `after`/`through` watermark and limit; authorized change summaries, `acceptedChangeReadable` and continuation                                                              |
| `operation_status`     | Original operation key in this grant namespace; original business receipt separately from current proposal status                                                                  |
| `schema_describe`      | Optional kind and explicit byte budget; fixed object/property/relation semantics, never a merged global table schema                                                               |
| `text_search`          | Required literal `filter.text`, optional exact filters, limit, budget and cursor; the same scoped search implementation as query                                                   |
| `relations_expand`     | Seed identity, incoming/outgoing direction, predicates, depth 1 or 2, total node/edge caps and budget; current-owner links with precise resolved pins                              |
| `accepted_change_read` | An accepted `changeId`, summary/evidence section and budget, or a continuation cursor; original declaration, exact target revision and currently authorized source pins            |

Only these ten capabilities are advertised. Human save/accept/reject/undo/grant operations are unavailable. Every tool uses the same currently bound grant; references do not expand its permissions.

MCP tool results contain the exact core JSON `Result` as both text and structured content. Core failures retain `error.code`, `retryable` and safe parameters; `isError` is true for a failure. Invalid tool names/argument shapes return `INVALID_INPUT` with `retryable:false`. Protocol-level malformed envelopes can instead produce an MCP protocol error or end the connection. Clients must retain an uncertain mutation's original key and request.

`proposed`/`pending` means a candidate was saved. Applying it is a separate human action. Same-key/same-request replay recovers the original candidate even if it was later applied or rejected; `currentProposal` reports that later state separately. A reused key with a different request fails. `operation_status.not_found` does not confirm failure.

The core `returnedBytes` counts the complete UTF-8 JSON Result, including its own count and any cursor. MCP adds framing plus its text/structured encodings; the budget does not cap that larger wire message. Each budget is 1,024–65,536 bytes. An indivisible item that cannot fit returns `LIMIT_EXCEEDED` with `params.requiredBytes`, rather than an empty repeating page. Read ranges use Unicode code points or entries. `object_read` continuations stay on their resolved historical pin after a head change and recheck authorization.

## Composing shared context

Start with `space_discover`: it remains under 8 KiB and gives tool names and short usage hints, without object lists or bodies. `schema_describe` describes four fixed object kinds, five nullable property types and five typed predicates. Properties belong to individual objects; read their actual keys, labels, types and options with `object_read(properties)`. Stable field keys are separate from authored multilingual labels. Existing agent updates may change allowed values, not redefine a field. ISO dates are authored dates; revisions describe accepted content history, not temporal facts.

`text_search` uses NFKC/lowercase literal matching over the existing projection, including the short-query fallback. It returns object summaries, not snippets, semantic scores or a completeness claim. Continue with the same filter/limit/budget and its cursor, then read a returned pin. Its cursors cannot be interchanged with `objects_query` cursors. Suggested starting budgets are 16 KiB for description/search/relations and 32 KiB for an accepted summary.

Relationship expansion uses breadth-first order, current owner revisions and explicit predicates. `belongs_to` targets a project/current reference; `uses` targets an asset/current or pinned reference; `source` requires a pin; `related` uses current identity; `continues_from` permits either. Pinned destinations are terminal. Incoming discovery matches object identity and can report an owner citing an old seed revision; the returned edge preserves that old pin. This does not certify support for the seed's current content.

`maxNodes` (including seed, at most 50) and `maxEdges` (at most 50) limit the entire logical traversal across pages. A separate 5,000 authorized-candidate work cap limits enumeration, not database scan time. Each page includes its seed and actual edge endpoints. Follow `nextCursor` while `truncated`; inspect `traversalCompleteWithinScope` and `stopReasons` even on the last page. An unreadable outgoing destination only sets aggregate `unavailableReferences` and never enters the frontier. Unreadable incoming owners are excluded without revealing their existence.

Another agent can follow an accepted result without the originating chat or operation key:

1. Find a `changes_list` item with `acceptedChangeReadable:true`.
2. Call `accepted_change_read` with that item's `id`, `section:"summary"` and a budget. It returns the accepted target pin, base pin (null for creation), declared purpose/reason, target digest and current target revision.
3. Read `section:"evidence"`, follow its cursor, then use `object_read` on the returned original source pins. Evidence pages contain reference metadata, never source bodies.

The Core verifies the original successful acceptance receipt, proposal payload and accepted revision's event association. Pending/conflicted/rejected events and direct human saves do not become accepted-proposal records. A later source update, target edit or undo never rewrites those pins. Revoking the originating agent after acceptance does not remove another authorized reader's access.

Object read scope includes retained accepted declarations for that object. **Target authorization does not authorize its sources.** Each source is checked against the caller's own current grant. Missing/unreadable sources yield aggregate availability status without IDs, titles, locators, digests, bodies or hidden counts. Evidence ranges count only visible entries and omit a total. Declared reasons remain authored content; the Core does not infer truth or scrub arbitrary natural language an author intentionally included in a declaration.

Search, relationship and evidence cursors bind the current authority sequence, instance, request and scope/generation. Authority or scope changes require restarting (`CURSOR_STALE`); complete revocation returns `FORBIDDEN` first. A restart still reads the original accepted evidence pins, with current availability/head metadata. Forged or cross-tool cursors are invalid. These current-state cursors differ from the fixed-version `object_read` cursor.

Activity stage `prepared` records the exact material the core assembled to return. This adapter adds no emission-confirmation log: it does not claim stdout was received, a model understood the content or an agent finished a task. `committed-change` is a local domain event and may still describe a pending proposal.

## Restricted single-call CLI

The CLI uses the same dispatch, authorization and ten tools. It reads one UTF-8 JSON value from stdin, capped at 2,097,152 bytes, and writes one newline-terminated JSON Result to stdout. It is an agent capability adapter, not a human administration or filesystem CLI.

```sh
printf '%s\n' '{}' | node dist/agent/adapters/entry.js --agent-cli \
  --space "$AGENTSPACE_SPACE" \
  --instance "$AGENTSPACE_INSTANCE" \
  --grant "$AGENTSPACE_GRANT" \
  --tool space_discover

printf '%s\n' '{"filter":{"text":"项目"},"limit":10,"maxBytes":8192}' | \
  node dist/agent/adapters/entry.js --agent-cli \
  --space "$AGENTSPACE_SPACE" \
  --instance "$AGENTSPACE_INSTANCE" \
  --grant "$AGENTSPACE_GRANT" \
  --tool objects_query
```

Exit codes: `0` successful Result; `1` core/startup failure; `64` launch/tool/schema error; `65` invalid JSON/UTF-8 or oversized input; `70` unexpected adapter failure. Inspect the stable Result code for business meaning. Server startup failures emit a sanitized Result to stderr and leave stdout empty. `--help` writes help to stderr and needs no credentials or open space.

## Electron main handoff

```ts
import { runAgentMode, type AgentMode } from './adapters/index.js';

// mode is 'server' for --agent-server, or 'cli' for --agent-cli.
// argv contains only the arguments AFTER that flag.
const exitCode: number = await runAgentMode(mode as AgentMode, argv, process.env);
```

The exported signature is:

```ts
runAgentMode(
  mode: 'server' | 'cli',
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number>
```

The desktop owner must detect these flags before creating a window or acquiring the normal desktop single-instance lock, await the returned exit code, and terminate the agent-mode process through the app's lifecycle. The function uses the process's stdin/stdout/stderr, closes its own space connection and does not call Electron APIs or `process.exit()`. Do not import the Node-only `entry.js` from main; it executes CLI argument dispatch on load.

The packaged launcher must use the application's bundled Node runtime and a real movable executable path. The current development entry requires the developer's Node installation; it is not a claim that packaged flags already work. Packaged process lifecycle, stdout cleanliness, relocation, host configuration paths and one-time-token UI need the separate desktop/package acceptance pass.

A host's stdio launch configuration must map its command/arguments/environment fields to that actual executable. A generic JSON launch description is not a universal host configuration format. Codex TOML and final executable paths are handled by the desktop/integration owner; this adapter does not edit any host configuration.

SDK references: [v2 stdio serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio), [v2 client connection](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect). The installed 2.4.0 package declarations are the implementation reference for this stage.
