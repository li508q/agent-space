# Product completeness and focus review

Review date: 2026-11-23. Original review: 0.1.0 at `59353e7`. Project-inspection/correction: moved 0.1.1 from `4786bf0`. Compact-navigation follow-up: moved 0.1.2 from `a169b6d`, on macOS arm64.

The local collaboration foundation is implemented and technically verified. The product remains focused, but the original pains are not yet fully resolved in the default human workflows. Engineering delivery and complete usability acceptance are separate conclusions. This review separates accepted corrections from open work; the whole human workflow has not yet passed acceptance.

**Accepted:** project overviews, editing the current original from a reader and visible navigation status/cancellation in compact layouts. Source checks, new-package runtime verification and independent native acceptance passed within the limits in [TESTING](TESTING.md). Change discovery, knowledge-review filtering, contextual collaboration setup and writing-detail corrections remain open.

The expanded CI subsequently found a separate compact-list control defect: an opening request locked the list while its status/Cancel surface was hidden. The 0.1.2 application corrects that presentation and passed source checks, new-package runtime verification and independent follow-up. The earlier 0.1.1 acceptance retains its bounded scope; the newly exercised path is closed by its own 0.1.2 evidence.

The 0.1.3 candidate adds durable recent changes and processed proposals through the existing Activity and Review entries. Source checks and packaged runtime verification passed. Independent keyboard checks found two layout defects: a review footer obscured a focused source at 200% zoom, and a list boundary clipped an outer focus outline in a wide window. Focused corrections passed source and native regression checks; independent acceptance of the final rebuilt package remains pending. The open-work table below describes the earlier acceptance baseline until that gate closes.

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

## Full-cycle review and reflection

| Area                        | Review outcome                                                                                                                                           | Evidence or remaining boundary                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product definition          | Keep personal ownership, direct use and understandable human–agent collaboration as the center.                                                          | Original interviews map to PRD scenarios; monthly reporting remains an example, and the broader digital-twin vision remains deferred.                                                                                                                                             |
| PRD and acceptance          | Preserve the original pains and test their natural paths, not only API availability.                                                                     | Project inspection/correction is now accepted; the remaining paths below stay open rather than being removed from the requirements.                                                                                                                                               |
| Stack and data model        | Retain the shared TypeScript/SQLite Core, restricted Electron interface and MCP/CLI adapters.                                                            | Architecture decisions explain alternatives and actual runtime proofs. The correction needs no new database, dependency or permission.                                                                                                                                            |
| Implementation and division | Assign one bounded slice and one application writer; independently inspect the resulting build.                                                          | 7A has separate implementation and moved-package evidence. Later slice contracts are design inputs, not completed features.                                                                                                                                                       |
| Verification                | Keep persistence, protocol and native evidence distinct from usability claims.                                                                           | Current integrated check: 115/115. Independent 0.1.1 acceptance: twenty locale/layout groups plus two full keyboard paths; the separate 0.1.2 follow-up covers compact status, cancellation and preserved human work. Real first-user and long-term effectiveness are unverified. |
| Languages and interface     | Keep five-language UI and primary guides, with native enlarged-text checks.                                                                              | Critical 7A controls worked in all five locales; this is not certification by native-speaking users or physical IMEs.                                                                                                                                                             |
| Documentation and GitHub    | Correct stale stage wording, unimplemented interaction examples and README status visibility; extend CI to guarded human paths and safe package reports. | The repository contains the resulting contracts and real screenshots; remote CI must pass for each published revision. No hosted site or release publication is implied.                                                                                                          |

The main process correction is to separate capability delivery from the person's complete experience. Existing API support did not make project accumulation discoverable or an original easy to correct. Those gaps required working UI changes. Repeating reviews or polishing prose cannot close the remaining paths.

## Corrections tied to the original pains

**Closed in 0.1.1, with a separately verified 0.1.2 follow-up:**

- **Inspect project accumulation.** A bounded goal excerpt, continuation, direct assets and material navigation precede the full writing surface. Independent checks reached all 67 members and 57 direct assets; indirect assets were not mixed into the direct set.
- **Correct from the reading path.** Edit current original follows the same ID through K1 reading, K2 editing and K3 saving. Historical K1 and proposal evidence remain fixed. Existing drafts, failed saves, cancellation, conflict and return focus retain their protections.

- **Reach pending navigation controls.** Compact list and Details presentation no longer hide the existing status. Opening can be cancelled by keyboard; preparation that confirms a write remains visible. Original list/details state, later input and the existing reader survive the transition.

**Still open:**

| Problem                                                   | Current behavior                                                                                                                | Bounded correction                                                                             | Observable acceptance                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual changes are hard to rediscover                     | Review lists unresolved candidates; Tool activity filters to prepared results; history requires knowing the object              | Expose durable recent changes and processed proposals through existing services                | After reopening, find a human save, an applied proposal and a rejected candidate without title search; inspect the original reason and pinned evidence |
| Reviewed knowledge cannot be found as a set               | A per-version review mark exists, but summaries and query filters omit its state                                                | Derive current-reviewed/changed-since-review summaries and bounded shared filtering            | K1 reviewed then K2 edited appears as needing review; acceptance alone never marks K2 reviewed                                                         |
| Starting collaboration requires assembling separate steps | Import, grant setup and one-object context copying live separately                                                              | Contextual guidance from project/material to existing access setup and a short start brief     | Connect a real host without finding UUIDs or reading developer contracts; copying is not called task delivery                                          |
| Continue working duplicates the library                   | It uses the general object query plus recovery drafts                                                                           | Use it for recent work, recovery and recent-change access; retain complete browsing in Library | The two destinations answer different questions and retain clear project scope                                                                         |
| Asset location and technical detail distract from work    | Origin labels are visible, but the recorded location is not directly available; context-format explanations occupy every editor | Inspect/copy the stored location and disclose technical context metadata when requested        | Obtain the original location without executing it; write in all locales at narrow/enlarged layouts with save failure, conflict and recovery visible    |

The implementation must reuse the common Core and existing guards. Review filtering must be part of the bounded shared query contract, not a client-side scan of every document body. A project link must never silently expand a grant. Historical evidence remains read-only. Import must not automatically certify knowledge or overwrite later human relationships.

The five usage guides now distinguish prepared tool references/ranges from saved changes and accepted-proposal evidence in an object's History. This corrects the documentation, not the missing global change/resolved-proposal entry. A prepared result is not a committed revision, host receipt or external task completion.

## Evidence added by this review

A new isolated native walkthrough used the actual relocated package with synthetic material. In a 1380×900 window, the client viewport was 813 CSS pixels high and a one-sentence project's material section began at y=941. The project-reader path exposed no action to edit the current original. Asset details omitted the recorded locator. These observations confirm navigation/layout gaps; they are not a first-user or long-term usability study.

An actual Codex CLI 0.147.0 model task used an ephemeral configuration and temporary grant, without editing host settings. It discovered the project, searched and followed its continuation/evidence, then created one pending proposal. Direct Core observations confirmed the accepted revision/digest stayed unchanged and the unrelated multilingual text, properties and relations were preserved. Its evidence pinned the actual measurement revision. The complete host events contained only AgentSpace calls and agent messages.

That task made 25 MCP calls, including 20 section reads over five objects. It establishes one real host's ability to compose the tools, not optimal cost, universal host compatibility or general semantic quality. Earlier SDK, concurrency, native and package checks retain their distinct scope in [TESTING](TESTING.md). Each remaining correction requires its own acceptance after implementation; 7A has the separately recorded 0.1.1 evidence above.

## Keep the scope focused

Retain direct human saving, agent proposals, fixed evidence, independent object lifetimes and composable capabilities. Address the entries and transitions above before adding another product area.

This review does not require a chat client, role/DAG engine, automatic truth judge, full temporal-fact system, graph database, arbitrary mini-app execution, plugin marketplace, cloud sync, teams or a full spreadsheet. A background semantic organizer is not part of this release. Semantic retrieval should follow evidence of persistent misses on natural tasks.

The earlier file-browser design informs ownership, discoverability and asset reuse. Its read-only editor, mandatory domain homepage and file-only authority are not frozen constraints on the later writing/collaboration product. macOS arm64/ad-hoc signing remains the current distribution boundary; Windows and notarized distribution are separate release work.

## Acceptance before calling the human workflow complete

Start with synthetic material without pre-injected relationships. Import the folder, confirm a project and continuation, inspect its accumulation, correct an original from the reading path, configure a real agent, review and accept a sourced proposal, reopen and find the result through recent changes, then continue with another independently authorized agent without the first private chat. Preserve the later human edit during recovery and verify backup portability.

Repeat with another ad hoc intent, such as cross-project research or asset-use inspection. The person should be able to explain where they are, what accumulated, what changed, why, whether it took effect and what they can do next. No monthly endpoint or fixed role is required.
