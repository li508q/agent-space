# AgentSpace product requirements

Status: first-release scope established. Updated 2026-11-23. The common core, native collaboration, organization, bounded context and local portability are implemented and technically checked. Original-pain usability corrections are tracked in [PRODUCT_REVIEW.md](PRODUCT_REVIEW.md) and [DELIVERY.md](DELIVERY.md); complete product acceptance remains pending. Requirements below remain acceptance targets, not claims that every workflow has passed.

## Product purpose

**Work with AI. Stay in control.**

AgentSpace is a local personal workspace where people can read, write, organize, and continue their work, while different agents use the same context and propose understandable changes. The person can see the relevant sources, correct a result, and recover without surrendering ownership of the material.

The first user works across multiple projects and agent tools, writes notes and documents, and reuses code, knowledge, and other assets. The workbench remains useful without a model account or API key.

## Problems, risks, and user outcomes

| Reported problem or collaboration risk                                      | Required user outcome                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Context lives in separate conversations and folders                         | Find relevant material through one space and provide stable context to another agent |
| Knowledge changes without a clear explanation                               | See the proposed or accepted change, its reason, sources, and actual status          |
| Editing and inspecting accumulated material is awkward                      | Write comfortably, understand save state, and inspect project accumulation directly  |
| Notes, documents, knowledge, project state, and assets are weakly connected | Use one set of objects and explicit references from different working views          |
| Agent work feels opaque                                                     | Inspect declared intent, material delivered by tools, proposals, and durable results |
| Old output or recovery may overwrite newer human work                       | Detect stale bases and perform guarded recovery with a clear conflict path           |

The interface reports observable actions and declarations. A tool delivering content does not prove that a model understood it; a declared task does not prove it finished. Private model reasoning is outside the product's visibility.

## Scenario provenance

The first release is grounded in the user's material and the main-session interviews. Distinguish reported use from a requested capability, a jointly constructed example, and an engineering failure case.

| ID    | Scenario or need                                                                                                                                  | Basis                                  | Product implication                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SC-01 | A simple folder contains an automatically maintained knowledge area, project subfolders with HANDOFF, and a separate repository area              | Reported working practice              | Organize existing work without requiring a new routine or a project for every note                                               |
| SC-02 | Knowledge changes after work, but the person cannot readily see what changed or why                                                               | Reported pain                          | Make proposals, accepted changes, reasons, and sources inspectable                                                               |
| SC-03 | After working on several things, the person wants to open each project and see what it accumulated                                                | Reported pain and desired action       | Provide project material, related knowledge, and continuity references from real objects                                         |
| SC-04 | Directly correcting accumulated knowledge is inconvenient                                                                                         | Reported editing friction              | Treat human writing/editing as a primary flow, with accurate save state and safe recovery                                        |
| SC-05 | Personal notes, ideas, work documents, and accumulated knowledge should connect in one content system; tables should serve structured information | Stated need and product reasoning      | Shared content identity, typed records, meaningful relationships, and versioned sources                                          |
| SC-06 | Code repositories are kept separately, and the design gives reusable assets an independent lifetime                                               | Reported practice and prior design     | Reference assets across projects without duplicating their authority                                                             |
| SC-07 | Context is locked in separate agent conversations; different agents should access the same personal space and continue work                       | Reported pain and explicit requirement | Real shared context/tools, project continuity, and controlled mutations independent of private chats                             |
| SC-08 | Read the space entry, gather this month's work, and write a personal retrospective                                                                | Jointly constructed validation example | Test ad hoc cross-project composition; do not make monthly reporting a dedicated product workflow                                |
| SC-09 | A personal digital twin may later include broader planning, generated small applications, and service access                                      | Stated longer-term direction           | Preserve clear object/capability boundaries; keep broad calendar, app execution, and service platforms outside the first release |

Stale writers, response loss, database failures, and unsafe recovery are engineering cases derived from collaboration and persistence requirements. They are acceptance risks, not claims that the user personally experienced every failure. Public examples and screenshots use synthetic content representing these scenarios.

## First release scope

### Local space and direct use

- Create and open a local space. Offer a separate, clearly labeled example space.
- Work with real persisted data, reopen accepted work, and keep the selected space visible.
- Import supported Markdown/plain-text material from user-selected locations as managed copies with origin information. Preserve the original files. Reference other native formats without claiming to parse or synchronize them.
- Include a guided, previewed folder-import path for the reported knowledge/project/HANDOFF/repository layout. Let the person confirm folder-to-project grouping and asset references before writing; treat layout recognition as a replaceable import profile. Skip unsupported or excluded items with a clear result, cap traversal, and avoid duplicate copies on retry. This is a phase 4 import flow, not live two-way synchronization or a universal migration platform.
- Apply import grouping to new copies. Re-importing the same source version reuses its original object and preserves current human edits and relationships. Explain before confirmation that new grouping does not reclassify reused objects, and identify reuse distinctly in the results. A person can edit those relationships explicitly afterward.
- Preserve unsaved input when navigation, a conflict, or a failed save interrupts writing.

### Content and working context

- Read and edit Markdown with a comfortable writing surface and safe preview.
- Save human edits after a short quiet interval, with an explicit save command available. Report successful persistence separately from a retained recovery draft. Do not interrupt input-method composition or replace a dirty editor buffer with a background update.
- Maintain useful typed properties and lightweight records with stable row identity. Keep null, zero, and empty values distinguishable.
- Let notes exist independently; link content to projects, sources, and reusable assets without making independent copies for every view.
- Show project goals, progress/continuation references, accumulated material, and related knowledge. Reusable assets remain independent of project lifetime.
- Distinguish raw material, reviewed knowledge, and project state. Saving or accepting an edit does not itself certify a statement as true.

### Context acquisition and agent collaboration

- Provide a small discoverable entry and real local MCP/CLI integration.
- Support bounded discovery, schema description, structured filtering, text search, typed relation expansion, exact revision reads, and status/change inspection as composable capabilities.
- Show the executed scope, result limits, source revisions, and known stale or unavailable material. Short CJK queries and accented text require an explicit tested strategy.
- Let a person inspect/copy selected context and source references. Record what tools actually supplied to a configured agent client.
- Let another authorized agent trace an accepted change to its declared reason and exact evidence revisions, without the original agent's private conversation or operation key. Reading the changed object does not grant access to its sources.
- Keep client access bound to an explicitly configured space and capability. The default agent mutation capability is proposal creation, not the person's direct-save or accept authority.
- Make integration setup accurate and reproducible; configuration examples must point to an existing built entry point.

### Changes and recovery

- A proposal contains a target, base revision, proposed differences, declared purpose, reason, source references, and status.
- An agent can propose a new note/record as well as a revision to existing material. A new-object proposal has no accepted base and does not appear as current content before the person applies it. Creation capability remains explicit and scoped.
- Start with one object per atomic proposal, including its body, properties, and references. Multiple proposals have individual outcomes; bulk or cross-object transactions require separate acceptance coverage.
- A person can inspect before/after differences, open supporting material, accept, reject, or continue editing without losing their place.
- Reading a proposal does not resolve it. Read/unread, pending/applied/rejected/conflicted, and knowledge review status are separate meanings.
- Preserve the original agent proposal when the person revises its result. If the first release uses a simpler path, explicitly offer a new draft or direct human edit; do not label that action as applying the unchanged original proposal.
- Accept only against a compatible current revision and policy. Preserve a stale proposal and the current human version; do not silently overwrite or pretend a text merge resolves factual disagreement.
- Human saves remain direct. Any future relaxation of agent write policy must be explicit, scoped, visible, and reversible where feasible.
- Keep durable accepted history and proposal outcomes. Guard undo/restore against later changes. If an old state cannot safely replace the current one, offer inspection or a new draft rather than destructive rollback.
- Provide a consistent backup and a portable export with clearly different promises. Restore into a new space and verify identity/version references before use.

### Languages and presentation

- UI and primary usage documentation cover English, Simplified Chinese, Japanese, Korean, and Spanish.
- Store product strings separately, preserve the chosen locale, localize relevant dates/counts/errors, and keep user-authored content unchanged.
- Make primary controls usable with a keyboard, visible focus, adequate contrast, restrained motion, and clear empty/error/conflict states.
- Keep technical receipts and detailed identifiers inspectable without placing them in every primary flow.

## Core scenarios

| Scenario                    | Flow and observable outcome                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Write and accumulate        | Open a project or independent note, edit content/records, save, reopen, and find it through the same project and search views                    |
| Provide context             | Discover types, filter relevant objects, search/expand when needed, read pinned sources, and inspect which material was delivered                |
| Review an agent proposal    | A real agent client creates a proposal; the person understands its purpose, scope, difference, and evidence, then accepts or rejects it          |
| Handle disagreement         | Human work advances after a proposal's base; acceptance reports conflict while preserving both versions and the human draft                      |
| Continue with another agent | The next client reads the project's current continuation entry, relevant sources, and accepted changes without needing a private chat transcript |
| Recover and carry work      | Inspect history, attempt conditional undo, export or back up, restore in a new space, and verify references and content                          |

Monthly reviews, research writing, and knowledge consolidation are examples that use these capabilities. They do not require dedicated workflow engines or permanent role agents.

## Acceptance matrix

These are acceptance targets, not completed test results. Implementation evidence is added as the corresponding phases finish.

| ID    | Requirement                      | Passing observation                                                                                                                                                                                                                          | Verification phase |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| AS-01 | Local direct use                 | Create/open a space and a separate demo; save and reopen work without a model key                                                                                                                                                            | 3, 5               |
| AS-02 | Safe import and origin           | Selected files or a previewed folder import become managed copies with origin and confirmed project grouping; original bytes remain unchanged; retries do not duplicate accepted items; unsupported/unreadable inputs have a specific result | 4, 5               |
| AS-03 | Comfortable human writing        | Editing, switching objects, failed saving, and closing/reopening do not silently discard input; save status matches persisted data                                                                                                           | 3, 5               |
| AS-04 | Shared organization              | A note can exist alone or appear through several relationships; a reusable asset retains one identity; project accumulation is inspectable                                                                                                   | 4, 5               |
| AS-05 | Real typed records               | Stable row keys and field types survive editing/export/restore; invalid values fail clearly; views reference the same records                                                                                                                | 4, 5               |
| AS-06 | Useful bounded context           | Exact reads return the requested revision; queries/search expose scope and truncation; CJK short queries, accents, empty results, and source gaps have tested behavior                                                                       | 2, 4, 5            |
| AS-07 | Real agent integration           | An actual MCP client discovers and reads a selected space, then creates a proposal visible in the native app; tool inputs cannot select arbitrary disk locations or invoke human-only acceptance                                             | 2, 3, 5            |
| AS-08 | Clear review and safe acceptance | Show all proposed changes and required explanations; accept once with a stable operation identity; a stale base or reused key with different payload is rejected safely                                                                      | 3, 5               |
| AS-09 | Understandable activity          | Accepted changes and proposals remain inspectable after restart; show declared intent and prepared version references accurately; demo actions are identifiable                                                                              | 3, 4, 5            |
| AS-10 | Guarded recovery                 | Conditional undo preserves later edits; history remains readable; a conflict has a usable next action rather than overwriting current work                                                                                                   | 3, 5               |
| AS-11 | Backup and portability           | Consistent backup and portable export are distinguishable; restore in a new space preserves the promised objects, text, rows, relations, and retained revisions                                                                              | 4, 5               |
| AS-12 | Trusted boundaries               | Native renderer has no arbitrary filesystem/process/database access; IPC/tool schemas, source handling, preview rendering, and external links respect the configured boundary                                                                | 2, 3, 5            |
| AS-13 | Five-language experience         | All five locales have complete critical strings; key flows and long labels fit; locale switching preserves data and user-authored text                                                                                                       | 3, 5, 6            |
| AS-14 | Reproducible desktop delivery    | Documented checks/builds run; a packaged macOS app launches and passes the core flow; other platform and signing claims match actual evidence                                                                                                | 5, 6               |
| AS-15 | Professional repository          | Five-language primary docs match the implemented behavior; real screenshots, license, contribution guidance, CI, commands, and remote contents are checked                                                                                   | 6                  |

The native experience pass also checks long localized conflict messages, CJK input composition, focus when entering/leaving source details, and text zoom. Fixed action bars must not hide the diff or focused controls. A person must be able to read a proposal's cited version and then return to the same review position.

For experience review, the person should be able to answer: **What changed? Why? Which source and version? Has it taken effect? What can I do next?** Validate these questions with the actual interface, not only with a technical log.

## Deferred scope

Cloud synchronization, team accounts, a plugin marketplace, arbitrary generated app execution, full spreadsheet compatibility, broad calendar integrations, general-purpose chat, a general agent orchestrator, and autonomous semantic rewriting are outside the first release. The research may inform later iterations, but it does not make every studied capability a release requirement.

The first release establishes versioned material, provenance, and controlled changes. A full temporal-fact engine or automatic truth/contradiction judge is not implied by historical version support.

## Decisions and implementation status

Local-first, single-user delivery, agent independence, the control-focused experience, a focused scope, and five-language primary delivery come from the user's current direction. The selected engineering route is Electron, TypeScript, a shared transactional SQLite core, and narrow desktop/MCP adapters. The reasons and alternatives are recorded in [ARCHITECTURE.md](ARCHITECTURE.md); feasibility checks do not substitute for product acceptance.

This PRD defines the focused local product. Implemented coverage, phase outcomes and verification limits are tracked in [DELIVERY.md](DELIVERY.md) and [TESTING.md](TESTING.md).
