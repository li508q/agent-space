# Core API

The Core owns authorization, accepted content, versions and operation receipts. Desktop and agent adapters use the same implementation.

| Contract                   | Definition                                  |
| -------------------------- | ------------------------------------------- |
| Services and results       | [`core.ts`](../src/contracts/core.ts)       |
| Strict commands and reads  | [`schema.ts`](../src/contracts/schema.ts)   |
| Bounded context            | [`context.ts`](../src/contracts/context.ts) |
| Local import and artifacts | [`local.ts`](../src/contracts/local.ts)     |
| Active-space bridge        | [`desktop.ts`](../src/contracts/desktop.ts) |

## Open and close a space

Build with `npm run build:core`; the ESM entry is `dist/core/index.js`.

- `Space.create(absoluteDirectory, { title, example? }): Result<Space>` creates an empty private space and refuses a nonempty destination.
- `Space.open(absoluteDirectory): Result<Space>` opens an existing supported space without migration.
- `createExampleSpace(directory)` creates separate, labeled synthetic material.
- `space.close()` closes the connection.

`space.human(installationNamespace)` returns `HumanServices` for trusted adapters. Persist that namespace across restarts; do not derive it from an editor or process ID. It is not an agent authentication mechanism.

`space.agent({ grantId, token, instanceId })` authenticates and returns `Result<AgentServices>`. Each call and continuation rechecks current authorization. Neither facade serializes its principal or database handle.

## Human services

| Services                                                      | Contract                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `status`                                                      | Space/instance identity, example flag and authority/activity sequences.                              |
| `createObject`, `saveObject`                                  | Atomic accepted revision or explicit unchanged result, fixed snapshot/change and echoed generation.  |
| `readObject`, `history`                                       | Complete trusted object view and bounded revision history.                                           |
| `setPolicy`, `markKnowledgeReviewed`                          | Human-owned protection and version review.                                                           |
| `createGrant`, `updateGrant`, `listGrants`                    | Scope, capabilities, generation and revocation; new-object proposal creation is disabled by default. |
| `getProposal`, `listProposals`, `markProposalSeen`            | Immutable candidate with current outcome; independent read state.                                    |
| `reviewProposal`, `undoChange`                                | Version-checked decision or conditional inverse revision.                                            |
| `saveDraft`, `listDrafts`, `readDraft`, `discardDraft`        | Durable base/generation and recovery text; stale generations cannot erase later drafts.              |
| `query`, `changes`, `activity`, `operationStatus`             | Bounded material/event pages and original-operation recovery.                                        |
| `describe`, `search`, `expandRelations`, `readAcceptedChange` | Shared read services described below.                                                                |
| `setLifecycle`, `relinkExternalAsset`                         | Checked archival/reactivation and trusted locator-only relinking.                                    |

Local import and foreign-draft services are specified in `local.ts`. Raw-path and verified-capture operations are trusted APIs, not renderer or agent capabilities.

## Agent services

| Service              | MCP/CLI tool           |
| -------------------- | ---------------------- |
| `discover`           | `space_discover`       |
| `query`              | `objects_query`        |
| `read`               | `object_read`          |
| `propose`            | `proposal_create`      |
| `changes`            | `changes_list`         |
| `operationStatus`    | `operation_status`     |
| `describe`           | `schema_describe`      |
| `search`             | `text_search`          |
| `expandRelations`    | `relations_expand`     |
| `readAcceptedChange` | `accepted_change_read` |

Agents cannot save accepted content, accept/reject/undo, manage grants or execute files/SQL. [Agent protocol](AGENT_PROTOCOL.md) defines launch arguments and tool inputs.

## Results, mutations and unknown outcomes

Calls return `{ ok: true, value }` or `{ ok: false, error }` with a stable code, retryability and optional safe field/parameters. Inspect business outcomes: successful `reviewProposal` can mean applied, rejected or conflicted. `WriteResult.generation` echoes the submitted generation; it does not mark newer visible input saved.

An operation key belongs to the persistent human namespace or grant ID. Its canonical digest includes the command and request. Replaying a recorded same-key request returns its original complete result; using that key for a different request fails.

`operationStatus` returns original `receipt.business` separately from `currentProposal`. Receipts contain bounded identities, pins and generations, not bodies or secrets. `not_found` is not proof of failure: retain the original request and key while querying or replaying an uncertain operation.

Grant tokens are returned once. Only the summary/hash is retained; same-key replay returns the summary with `token:null`. Recover a lost issuance by revoking that grant and issuing another, not by trying to recover its secret.

Acceptance checks candidate hash/status, target expectation, current policy and originating grant. Rejection guards the candidate/hash/status and remains possible after target edits or grant revocation. A human draft copied from a proposal does not accept or alter that proposal. Undo checks the exact successor revision; creation undo archives identity rather than deleting history.

## Version review

Query/search/relationship summaries and `object_read(summary)` include current head H (`currentRevision`), highest human-reviewed revision R (`knowledgeReviewedRevision`) and a derived state:

| State                  | Condition         |
| ---------------------- | ----------------- |
| `never-reviewed`       | R is null.        |
| `current-reviewed`     | R equals H.       |
| `changed-since-review` | R is less than H. |

Review is human-only and tied to an exact current pin. Repeating the same review does not advance authority. Saving, applying/rejecting, reading or marking a proposal seen does not review knowledge. A source change without a new referencing-object revision leaves that object's review state unchanged.

The represented ref/title/digest/time remain historical when a pin is historical; H/R describe the head observed during this read. Review metadata is outside the revision digest. Re-read after mutations instead of treating an old receipt as current metadata.

`filter.knowledgeReviewStates` accepts 1–3 unique enum values: OR within the set, AND with other filters. Empty, duplicate, null and unknown values fail. Canonical enum order permits a reordered equivalent set to continue; changed members do not. Explicit all-three differs from omission. Authorized invalid metadata, including R greater than H, returns `INTEGRITY_FAILURE` rather than disappearing behind a filter.

## Bounded context and cursors

- `describe({ kind?, maxBytes })` returns fixed semantics; property definitions remain per-object.
- `search` requires nonblank literal text, uses scoped query semantics and has its own cursor domain.
- `expandRelations` uses explicit direction/predicates, depth 1–2, at most 50 total nodes/edges and a 5,000 authorized-candidate work cap. Pinned targets are terminal. Limits cover the whole recomputed walk, not each byte page or database latency.
- `readAcceptedChange` reads summary or evidence for a successful acceptance event. It checks the original receipt, candidate association and immutable result revision. Another agent needs the change ID and its own grant, not the originating chat or operation key.

Source authorization is independent of target authorization. Unreadable evidence exposes only aggregate availability, without hidden IDs, titles or counts. Evidence pages contain visible entries in source order and omit totals. Inconsistent stored data returns `INTEGRITY_FAILURE`, not healthy unavailability.

`maxBytes` is 1,024–65,536 bytes for bounded reads. `returnedBytes` measures UTF-8 JSON of the complete Core Result, including cursor/count fields; transport framing is additional. Pages split only at complete code points or entries. An indivisible item reports `LIMIT_EXCEEDED` and `requiredBytes`. Discovery fits within 8 KiB.

Current-state cursors bind instance, scope/grant generation, authority sequence, parameters and position. Authority/scope changes require a restart. Exact-read cursors instead retain the resolved pin/section/offset across head changes and recheck authorization. Query and search retain their repeat-input pagination form.

Prepared activity records only returned pins/ranges. A frontier node, hidden source or future page is not supplied context. `committed-change` is a durable local event and can describe a pending proposal; it does not imply an applied body.

## Native and local boundary

Main exposes native-selection/handle operations for import, backup, export, restore and relink. It does not forward `startImport`, `commitImportItem`, `getImportManifest` or path-bearing relink through preload. `ImportRunPage.coordinatorError` is a live Main failure observation, not a retained item outcome.

Import manifests freeze source identity/version, grouping, object IDs and keys. Same-source retries retain the original pin and later human edits. Restored/different installations require fresh source selection and approval. Artifact factories read the source database read-only and publish checked destination receipts. Restore creates a new instance and disables copied grants; foreign drafts are explicitly forked. See [Local data](LOCAL_DATA.md).

## Operating limits

Persistent/Core/local contracts and schema definitions are version 2. Unsupported formats fail without automatic migration. Spaces are plaintext local SQLite with private creation permissions. The database page ceiling is 512 MiB, managed objects at most 1 MiB, each serialized typed field 32 KiB, at most 64 fields/100 relations per object, input graphs depth 32/20,000 nodes, object grants 1,000 IDs and stored grants 256. Revisions and receipts have no automatic garbage collection.

At capacity, use read-only-source backup/export or another space. The database is authority, not a disposable index. [Testing](TESTING.md) defines platform, physical-device and failure coverage.
