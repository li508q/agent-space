# Core API handoff

Status: implemented 3A/3B surface, 2026-11-23. Native IPC, actual product MCP/CLI adapters and packaging remain later assignments. Definitions are in [`src/contracts/core.ts`](../src/contracts/core.ts), requests in [`schema.ts`](../src/contracts/schema.ts), and the named active-space bridge in [`desktop.ts`](../src/contracts/desktop.ts).

## Factories and trusted context

Build with `npm run build:core`; the real ESM entry is `dist/core/index.js`. `Space.create(absoluteDirectory, { title, example? })` creates a private empty space, while `Space.open(absoluteDirectory)` only opens an existing supported space. Both return `Result<Space>`. Creation refuses a nonempty destination. `createExampleSpace(directory)` creates separate, labeled synthetic persisted material; it fabricates no agent activity. Close with `space.close()`.

`space.human(installationNamespace)` is for the trusted desktop main process. Keep that namespace stable across application/editor restarts. It is not an authentication interface to expose through MCP. `space.agent({ grantId, token, instanceId })` validates stored authorization and returns only `AgentServices`; each later call rechecks it. Constructing a facade does not prove an agent is connected and creates no tool-result event. Neither facade serializes its private context or database handle.

The core imports no Electron, renderer or MCP SDK. For the planned packaged desktop, choose agent server/CLI launch mode before creating a window or acquiring a normal app-instance lock. That adapter can run this same core in the bundled Node runtime; a user-facing configuration must ultimately point to the packaged executable, not TypeScript sources or a separately installed Node. Those launch modes are not implemented here.

## Implemented services

| Human service                                          | Result and use                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                               | Space/instance identity, example flag, authority/activity sequences                                                             |
| `createObject`, `saveObject`                           | Real atomic accepted revision or explicit unchanged result; fixed snapshot, change ID and echoed generation                     |
| `readObject`, `history`                                | Full trusted object view, current/pinned relation resolution; paged revision summaries and explicit next revision               |
| `setPolicy`, `markKnowledgeReviewed`                   | Human-owned policy revision and a distinct review record pinned to the reviewed revision                                        |
| `createGrant`, `updateGrant`, `listGrants`             | Stored scope/capabilities/generation/revocation; creation is independently disabled by default                                  |
| `getProposal`, `listProposals`, `markProposalSeen`     | Immutable proposal/base/current/proposed content, paged summaries, independent seen state                                       |
| `reviewProposal`, `undoChange`                         | Bound review outcome or guarded inverse revision; creation undo archives identity rather than deleting history                  |
| `saveDraft`, `listDrafts`, `readDraft`, `discardDraft` | Durable generation/base/source and separately readable recovery text; stale generations cannot erase or resurrect a later draft |
| `query`, `changes`, `activity`, `operationStatus`      | Bounded current material, separate durable change/activity pages and original-operation recovery                                |

| Agent service                           | Actual phase 3 tool name |
| --------------------------------------- | ------------------------ |
| `discover`                              | `space_discover`         |
| `query` (including literal text filter) | `objects_query`          |
| `read`                                  | `object_read`            |
| `propose`                               | `proposal_create`        |
| `changes`                               | `changes_list`           |
| `operationStatus`                       | `operation_status`       |

Publish only these implemented capabilities in the next adapter. `schema_describe`, separate `text_search`, relation expansion and scoped accepted-change/evidence reading are phase 4 work. Do not relabel a query as another tool while retaining the wrong activity name. The latter evidence API must let another authorized agent find an accepted reason and exact evidence pins through the change/proposal pointer; do not fill that gap by silently modifying the accepted body or relations.

## Result and recovery semantics

Public calls return `{ ok: true, value }` or a stable error code, retry flag and optional field/parameters. A successful response is specific to that operation. `ReviewResult.outcome` is `applied`, `rejected` or `conflicted`; generic success does not mean adoption. Every accepted revision is immutable. `WriteResult.generation` echoes the submitted editor generation; it does not certify a newer visible buffer as saved.

An operation key is scoped to the persistent human namespace or grant ID and includes the command in its canonical request digest. Same-key replay returns the original complete Result even after later edits or proposal decisions. `operationStatus` returns a small original `receipt.business` discriminator (object pin/generation, review outcome, draft generation/retained state, proposal or grant identity) and separately named `currentProposal`. It contains no body or secret. `not_found` is not a failure confirmation; resend/query the same key when the result is unknown.

A grant token is deliberately one-time: `createGrant` stores and replays the same grant summary, while its ephemeral `token` is non-null only on the initial issuance. Losing that response requires revoking the recovered grant ID and issuing a new one; the secret cannot be recovered from a receipt. Do not display a connection as established merely because a grant exists or its configuration was copied.

Acceptance checks the immutable hash, proposal status version, current target expectation, current policy and originating grant. Rejection checks only the candidate hash/status version and human context, so a stale or revoked candidate can still be rejected. “Use as draft” can use `getProposal` plus `saveDraft` with a proposal source and an explicitly selected new/current target. That remains a human draft; it does not alter or accept the agent original. Historical copying similarly composes `readObject` at a pin with `createObject` under a new identity.

## Budgets, cursors and observations

Query pages bind filters/limits, scope digest (including instance and grant generation), authority sequence and last ID. An authority change returns `CURSOR_STALE`; activity, draft saves and seen markers do not invalidate a query. Read continuations bind a retained pin, section, scope and next Unicode-code-point/entry offset and survive a later head change, while revoked/changed authorization is checked again. Evidence locator strings are advisory metadata; `object_read` selects explicit sections and returns the actual range it prepared, not an inferred semantic heading range.

`returnedBytes` measures UTF-8 JSON of the entire core `Result` envelope, including cursor and the byte-count field. This does not include an MCP transport's additional encoding. Readers return whole code points or whole typed entries; if one entry cannot fit, they report `LIMIT_EXCEEDED` with the minimum required budget. `unavailableReferences` flags scope gaps without exposing outside IDs, titles or counts. Original text and labels are never normalized in storage; search alone uses a normalized projection.

An `ActivityEntry` has a stable numeric ID and explicit stage. `prepared` means the core assembled a tool result with those exact pins/ranges. It does **not** mean the adapter wrote stdout, the host received it, or a model understood/finished work. `committed-change` is a local durable domain event (including a pending proposal), not proof that its body was applied. Human UI polling creates no agent activity. No transmission-observation port or fictional agent run exists in this stage.

## Limits and pending boundaries

Format/core-contract version 1 is required on every transaction; no automatic migrations run. Spaces are plaintext local SQLite with private creation permissions. The database page ceiling is 512 MiB (history/receipts count); SQLite capacity failure returns `LIMIT_EXCEEDED`. Managed payloads are at most 1 MiB, serialized typed fields 32 KiB, input graphs depth 32/20,000 nodes, object grants 1,000 IDs, and stored grants 256. First release keeps revisions/receipts without automatic GC. A full space requires a future export/backup path or a new space; deleting the database is not an index rebuild.

The current tests do not establish UI/IME behavior, cross-space asynchronous callback handling, a renderer security boundary, real host/protocol integration, export/backup/restore, large-space performance, disk power-loss durability or a signed movable application. The desktop adapter must validate sender/frame, bound space/instance, schemas and response relevance before using these services. See [TESTING.md](TESTING.md) for actual evidence and [IMPLEMENTATION.md](IMPLEMENTATION.md) for the next stopping point.
