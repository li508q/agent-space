# AgentSpace local product brief

Date: 2026-11-22. This brief captures the user's implementation request and the earlier interviews. It guides the first local product; engineering decisions should support this scope.

## Product promise

**让人始终掌握方向，让智能充分发挥。目标、依据、行动与变化，清楚可见。**

AgentSpace is a personal workbench that a person owns and can use directly, with different agents collaborating through shared context and understandable changes. A strong feeling of control comes from being able to see, correct, continue, and recover actual work.

## Actual problems to solve

1. Context is fragmented across projects, folders, tools, and agent conversations. Switching agents repeats explanation and loses continuity.
2. Automatically maintained knowledge changes without the person knowing what changed, why, or which work it affects.
3. It is difficult to see what a project accumulated or to edit that material comfortably.
4. Notes, work documents, structured records, project state, and reusable assets have weak connections.
5. Whole-space reading is expensive and incomplete. Agents need a clear small entry and composable discovery, query, search, relation expansion, and versioned source reads.

## First local product

Complete one coherent end-to-end experience:

1. Create/open a local space, with a clearly separated example space for trying the product. The user's original folders stay intact when importing.
2. Browse projects and their material; read and write real Markdown documents, maintain useful typed properties/records, and connect source/asset references. Notes can exist independently of a project.
3. Search and inspect related material, its origin, revision, and context. Structured queries and exact source reads must be useful without AI.
4. Let an external agent access that same space through a real local MCP/CLI integration. Give it a small discoverable entry, bounded read access, stable references, and a clear way to propose changes.
5. See a proposed change with its purpose, target, before/after difference, reason, sources, and current status. Accept, reject, or revise it; detect stale bases and conflicts. Human-authored edits remain direct.
6. See durable, understandable activity and version history. Restore/undo conditionally, preserve later edits, export/backup and reopen the space. Surface failures and partial state accurately.

The data model and capabilities are generic. Monthly reviews, project handoffs, and knowledge consolidation are validation scenarios, not dedicated workflow engines. Reusable assets have an independent lifetime and are referenced by projects.

## Scope discipline

The initial release is local-first, single-user, and focused on the flows above. Cloud sync, team accounts, a plugin marketplace, arbitrary mini-app execution, a general agent orchestrator, full spreadsheet compatibility, broad calendar integrations, and a new general-purpose chat client are later options, not requirements of this implementation.

A user should not need an API key to use the workbench. AI-native means a useful shared object/context model, real tools, scoped mutations, provenance, and human–agent collaboration. Prefer completing the external-agent collaboration loop over adding superficial chat or fictional AI activity.

## Architecture expectations

- Shared object IDs, typed relationships, source/version references, explicit authoritative data and rebuildable projections.
- One understandable mutation contract across UI and agent entry points: actor/scope, expected revision, idempotency, proposals versus accepted changes, visible history and conditional undo.
- Local structured authority is a real database, not a disposable cache. Decide whether small managed document bodies should be stored transactionally inside it or as immutable files, and record the tradeoff. Native external files retain a declared ownership mode.
- Use one modular core and narrow trusted adapters. Do not start with microservices or imitate a generic enterprise ontology.
- Background maintenance may be purpose-specific and recoverable. User work stays open-ended; roles and recipes are optional.
- Optimize for clear everyday interaction, safe persistence, and testable boundaries. Do not claim arbitrary uncoordinated filesystem writers receive transactional guarantees.

## Interface direction

Treat this as a desktop document/work workspace. A stable navigation area, a comfortable reading/writing surface, and contextual provenance/change review should work together. Favor clear typography, quiet surfaces, meaningful emphasis, useful density, and predictable keyboard interaction. Show human terms first; technical receipts and source details can be inspected when useful.

Use a document-workspace design with an explicit token system and accessibility rules. Color and motion should help people locate content, understand changes, and act with confidence.

## Languages and repository delivery

The interface and primary usage documentation serve English, Simplified Chinese, Japanese, Korean, and Spanish readers. Keep product strings externalized, respect the user's chosen locale, and verify critical workflows and long labels in all five. User-authored content keeps its original language.

Use English for the root README, with prominent links to four complete localized READMEs and concise localized usage guides. Describe implemented capabilities and limits accurately. Include real screenshots from the application, reproducible development/build/test commands, contribution guidance, architecture decisions, and a license.

The user explicitly requested a separate Desktop `agent-space` folder and a verified implementation committed and pushed to the provided remote main branch. The root coordinator handles commits and the final push after integration and verification.

## Evidence to consult

The coordinator supplied the original interview and research archive outside this repository. Read the two research READMEs, main reports, mature document/table/version study, context model/interface study, and architecture main/data/protocol/scenario/decision reports. Their results are evidence with stated limits, not already implemented capabilities.

The prior proposal favored Tauri/Rust/React and immutable body files plus SQLite heads. Those were recommendations. Select a practical maintained stack after checking official documentation and runtime behavior, and keep implementation scope focused. Do not block delivery on nonessential technical preference questions.

## Acceptance

- A native local desktop app launches from a documented command and a packaged macOS artifact.
- All visible primary actions perform real operations with persisted results, errors, and recovery. Closing/reopening preserves accepted work.
- A real MCP client can discover/read/search the space and create a proposal; the person can review and accept it in the UI; a second stale writer is rejected safely.
- Later human edits survive a stale proposal and conditional undo. Changes, version references, and explanations remain inspectable.
- Export/backup can be opened/restored and checked with stable references. Imported originals are preserved.
- Meaningful automated checks and actual desktop screenshot/interaction verification pass; platform/signing/security limits remain explicit.
- README and focused architecture/user/contributor documentation describe the implemented behavior, setup, tests, and remaining limits accurately.
- Five-locale UI and primary documentation are complete, critical flows work in every locale, and the repository is polished and ready for the coordinator's final push.
