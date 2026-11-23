# Product completeness and focus review

Review date: 2026-11-23. Baseline: 0.1.0 at `59353e7` and its actual macOS arm64 application.

The local collaboration foundation is implemented and technically verified. The product remains focused, but the original pains are not yet fully resolved in the default human workflows. Engineering delivery and complete usability acceptance are separate conclusions. This review records open work; it does not claim the changes below have shipped.

The 0.1.1 candidate implements project overviews and editing the current original from a reader. Its source checks are recorded in TESTING; new-package and independent acceptance remain separate gates. The findings below describe the 0.1.0 review baseline. The other corrections remain open.

## The product promise

A person owns the shared workspace and can write directly. Different agents use the same material and continue work through explicit references. Proposed changes, their declared reasons, their evidence and their accepted results remain understandable. The person can correct, reject and recover work.

The recurring scenarios are the knowledge/projects/HANDOFF/repository folder practice, unseen knowledge changes, unclear project accumulation, inconvenient corrections, weak links between notes and work, and context locked in separate agents. See the scenario provenance in [PRD](PRD.md). Monthly reporting is a validation example, not a dedicated workflow.

## What already works

- Direct local writing, real persistence, typed records, independent assets and explicit relationships.
- A small discovery entry and composable MCP/CLI query, search, traversal and pinned reads.
- Actual proposals with purpose, reason, complete differences and fixed source revisions.
- Guarded acceptance, historical evidence, later-edit protection, drafts, import, backup and restore.
- Five-language primary UI/documentation, actual native screenshots and reproducible verification.

The architecture has useful AI-facing semantics rather than a decorative chat interface. The open issues concern how people discover and combine those capabilities.

## Review findings tied to the original pains

| Problem                                                   | Current behavior                                                                                                                          | Bounded correction                                                                                                | Observable acceptance                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project accumulation is hard to inspect                   | A project's material list follows its full editor/body; direct asset use is not a clear overview section                                  | Show goal, continuation, linked material and used assets before the full writing surface; retain explicit editing | A long project document does not hide the accumulation entry; references retain the same identities                                               |
| Corrections require leaving the reading path              | Project material opens the pinned reader; View current is still a reader                                                                  | Offer Edit current original through the existing protected editor transition                                      | Editing K2 creates K3 on the same ID; cited K1 stays unchanged and previous human input is retained                                               |
| Actual changes are hard to rediscover                     | Review lists unresolved candidates; Tool activity filters to prepared results; history requires knowing the object                        | Expose durable recent changes and processed proposals through the existing views/services                         | After reopening, find a human save, an applied proposal and a rejected candidate without searching for their titles                               |
| Reviewed knowledge cannot be found as a set               | A per-version review mark exists, but ordinary summaries and query filters do not expose its state                                        | Derive current-reviewed/changed-since-review summaries and bounded shared filtering                               | K1 reviewed then K2 edited appears as needing review; acceptance alone never marks K2 reviewed                                                    |
| Starting collaboration requires assembling separate steps | Import, grant setup and one-object context copying live separately                                                                        | Add contextual guidance from a project/material entry to the existing access setup and a short start brief        | A new person can bring existing material to a real host without finding UUIDs or reading developer contracts; copying is not called task delivery |
| Continue working duplicates the library                   | It uses the general object query plus recovery drafts                                                                                     | Give it a distinct recent-work/recovery/change purpose; keep full browsing in Library                             | The two destinations answer different questions and retain clear project scope                                                                    |
| Asset location and technical detail distract from work    | External origin labels are visible, their recorded location is not directly available; context-format explanations appear on every editor | Expose the stored asset location for inspection/copy; disclose detailed context metadata when requested           | The person can obtain the original location and begin writing with clear save state at narrow widths and enlarged text                            |

The implementation must reuse the common Core and existing guards. Review filtering must be part of the bounded shared query contract, not a client-side scan of every document body. A project link must never silently expand a grant. Historical evidence remains read-only. Import must not automatically certify knowledge or overwrite later human relationships.

The five usage guides now distinguish prepared tool references/ranges from saved changes and accepted-proposal evidence in an object's History. This corrects the documentation, not the missing global change/resolved-proposal entry. A prepared result is not a committed revision, host receipt or external task completion.

## Evidence added by this review

A new isolated native walkthrough used the actual relocated package with synthetic material. In a 1380×900 window, the client viewport was 813 CSS pixels high and a one-sentence project's material section began at y=941. The project-reader path exposed no action to edit the current original. Asset details omitted the recorded locator. These observations confirm navigation/layout gaps; they are not a first-user or long-term usability study.

An actual Codex CLI 0.147.0 model task used an ephemeral configuration and temporary grant, without editing host settings. It discovered the project, searched and followed its continuation/evidence, then created one pending proposal. Direct Core observations confirmed the accepted revision/digest stayed unchanged and the unrelated multilingual text, properties and relations were preserved. Its evidence pinned the actual measurement revision. The complete host events contained only AgentSpace calls and agent messages.

That task made 25 MCP calls, including 20 section reads over five objects. It establishes one real host's ability to compose the tools, not optimal cost, universal host compatibility or general semantic quality. Earlier SDK, concurrency, native and package checks retain their distinct scope in [TESTING](TESTING.md). The planned corrections require their own acceptance after implementation.

## Keep the scope focused

Retain direct human saving, agent proposals, fixed evidence, independent object lifetimes and composable capabilities. Address the entries and transitions above before adding another product area.

This review does not require a chat client, role/DAG engine, automatic truth judge, full temporal-fact system, graph database, arbitrary mini-app execution, plugin marketplace, cloud sync, teams or a full spreadsheet. A background semantic organizer is not part of this release. Semantic retrieval should follow evidence of persistent misses on natural tasks.

The earlier file-browser design informs ownership, discoverability and asset reuse. Its read-only editor, mandatory domain homepage and file-only authority are not frozen constraints on the later writing/collaboration product. macOS arm64/ad-hoc signing remains the current distribution boundary; Windows and notarized distribution are separate release work.

## Acceptance before calling the human workflow complete

Start with synthetic material without pre-injected relationships. Import the folder, confirm a project and continuation, inspect its accumulation, correct an original from the reading path, configure a real agent, review and accept a sourced proposal, reopen and find the result through recent changes, then continue with another independently authorized agent without the first private chat. Preserve the later human edit during recovery and verify backup portability.

Repeat with another ad hoc intent, such as cross-project research or asset-use inspection. The person should be able to explain where they are, what accumulated, what changed, why, whether it took effect and what they can do next. No monthly endpoint or fixed role is required.
