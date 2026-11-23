# Product requirements

AgentSpace is a local personal workspace for direct writing, shared context and reviewable agent changes. A person must be able to determine **what changed, why, which sources support it, whether it took effect and what to do next**.

This document defines required behavior. [Testing](TESTING.md) defines verification and its limits; the [user guide](guides/en.md) describes operation.

## Scope

- Documents, projects, lightweight records and reusable asset references share stable identities, typed properties, relationships and versions.
- The desktop works without a model account. External agents use scoped MCP or CLI access to the same Core.
- Human edits save directly. Agent changes remain proposals until a person applies them.
- Context acquisition combines discovery, query, search, relation expansion and exact reads. Tasks do not require a fixed workflow or role.
- Imported originals remain intact. Backup, readable export and recovery have separate contracts.

## Core scenarios

| ID    | User action                                                        | Required outcome                                                                                                                         |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SC-01 | Bring existing folders and project/HANDOFF material into the space | Preview supported files and grouping; confirm before copying; preserve originals and avoid duplicates on retry.                          |
| SC-02 | Inspect knowledge changed during work                              | Find the proposal or accepted event, its reason, exact sources and actual outcome.                                                       |
| SC-03 | Open a project to inspect its accumulation                         | Reach its goal excerpt, continuation, material and direct assets before reading the complete body.                                       |
| SC-04 | Correct accumulated material                                       | Edit the current original under the same ID; keep cited historical versions and existing human input.                                    |
| SC-05 | Connect notes, working documents and structured information        | Reuse the same objects through views and explicit relationships; keep typed values meaningful.                                           |
| SC-06 | Reuse a repository or asset across projects                        | Reference its independent identity; project archival does not delete the asset.                                                          |
| SC-07 | Continue with another agent                                        | Read shared material and accepted explanations within a separate grant, without requiring another agent's private chat or operation key. |
| SC-08 | Compose an ad hoc retrospective or research task                   | Select relevant saved material and combine bounded tools; do not require a dedicated reporting endpoint.                                 |

SC-09, broader personal planning and application/service execution, is outside the current scope. See the [product brief](product-brief.md#scope).

## Acceptance criteria

| ID    | Requirement           | Observable result                                                                                                                                                                         |
| ----- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AS-01 | Direct local use      | Create/open a space and a distinct example; save and reopen work without a model key.                                                                                                     |
| AS-02 | Safe import           | Confirm files, actions and grouping before writing. Preserve original bytes, distinguish per-item outcomes and reuse the original object for the same source version.                     |
| AS-03 | Protected writing     | Navigation, failed saves and closing do not silently discard input. Save feedback describes the visible buffer. Composition and later input remain intact.                                |
| AS-04 | Shared organization   | Notes may stand alone or link to several projects. Assets retain independent identity. Project accumulation and incoming links are inspectable.                                           |
| AS-05 | Typed records         | Stable field keys and types survive edits and portability. Invalid values fail explicitly; null, empty text, zero and false remain distinct.                                              |
| AS-06 | Bounded context       | Exact reads retain the requested revision. Results disclose scope, budgets, truncation and unreadable references. Short CJK and accented searches have defined behavior.                  |
| AS-07 | Agent integration     | A real MCP client can discover/read and submit a proposal visible in the desktop. Tools cannot choose arbitrary disk locations or invoke human acceptance.                                |
| AS-08 | Safe review           | Display the complete proposed difference, purpose, reason and sources. Check base, policy and grant again on apply. Same-key replay is idempotent; different payloads cannot reuse a key. |
| AS-09 | Durable visibility    | After restart, accepted changes and processed proposals retain their explanation and fixed result. Prepared tool references remain distinct from accepted work.                           |
| AS-10 | Guarded recovery      | Undo checks the exact successor revision and preserves later changes. History stays readable; conflicts offer a usable recovery path.                                                     |
| AS-11 | Portability           | Distinguish current-only export from full-history backup. Restore to a new instance with stable object/version references and disabled copied grants.                                     |
| AS-12 | Trust boundaries      | The renderer has no arbitrary filesystem, database or process capability. IPC validates sender, frame, schema and binding; imported content remains data.                                 |
| AS-13 | Five languages        | Critical controls and long labels work in English, Simplified Chinese, Japanese, Korean and Spanish. Locale changes preserve authored content and editor state.                           |
| AS-14 | Desktop distribution  | Documented builds produce a standalone macOS Apple Silicon app with verifiable inputs, runtime, signatures and checksums. Platform claims match actual coverage.                          |
| AS-15 | Maintained repository | Guides, contracts, commands and screenshots describe the shipped behavior. CI verifies each published revision. Private data and generated builds stay outside source control.            |

## Behavioral constraints

- A proposal changes one existing object or proposes one new document/record. Multiple proposals have independent outcomes.
- Reading a proposal, processing it and marking knowledge reviewed are separate actions. Applying a change does not certify truth.
- A relationship never grants access. Object access includes readable retained and later versions; a copied brief identifies specific saved pins.
- Unknown results retain their original request identity. Do not report success, create a replacement operation or overwrite later input while the result is unresolved.
- Recovery drafts are distinct from accepted content. Neither a draft receipt nor an older successful save can mark newer input saved.
- Imported copies do not synchronize with external originals. Uncoordinated file or database writers are outside the transactional guarantee.

## Current limits

The desktop prepares up to 20 saved references from the starting version, its direct links and queried project material. It does not provide an arbitrary cross-project selection basket. Recorded external locations have no direct-copy control in the current desktop. Literal search, bounded traversal and per-object version review do not provide automatic semantic maintenance or source-freshness certification.

Cloud teams, general chat, workflow orchestration, arbitrary app execution and full spreadsheet compatibility are outside this product scope. Distribution and physical-device verification limits are listed in [Testing](TESTING.md).
