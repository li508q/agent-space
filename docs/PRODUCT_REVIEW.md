# Product completeness and focus review

Review date: 2026-11-23. Original review: 0.1.0 at `59353e7`. Project-inspection/correction: moved 0.1.1 from `4786bf0`. Compact-navigation follow-up: moved 0.1.2 from `a169b6d`. Change discovery: moved 0.1.3 from `fbd5417`; small-window and repeated-reader-return follow-up: moved 0.1.4 from `9d0ff13`, on macOS arm64.

The local collaboration foundation is implemented and technically verified. The product remains focused, but the original pains are not yet fully resolved in the default human workflows. Engineering delivery and complete usability acceptance are separate conclusions. This review separates accepted corrections from open work; the whole human workflow has not yet passed acceptance.

**Accepted:** project overviews, current-original editing from a reader, compact navigation status/cancellation, durable recent changes and processed proposals. Source checks, new-package runtime verification and independent native acceptance passed within the limits in [TESTING](TESTING.md). Knowledge-review discovery and a distinct Continue view are also accepted in 0.2.0 within the separately recorded scope. Contextual collaboration setup passed the bounded 0.2.1 source, relocated-runtime and independent package gates; publication CI is tracked separately. Writing-detail corrections, requested visual refinement, personal-source use and the final two-fresh-agent lifecycle remain open.

The expanded CI subsequently found a separate compact-list control defect: an opening request locked the list while its status/Cancel surface was hidden. The 0.1.2 application corrects that presentation and passed source checks, new-package runtime verification and independent follow-up. The earlier 0.1.1 acceptance retains its bounded scope; the newly exercised path is closed by its own 0.1.2 evidence.

The 0.1.3 application adds durable recent changes and processed proposals through the existing Activity and Review entries. Independent keyboard checks exposed and closed two layout defects: a footer obscured a source at 200% zoom, and a list boundary clipped an outer focus outline. The final moved package passed the focused follow-up and complete English/Spanish keyboard flows. Earlier candidates retain their separately scoped data, pagination and failure evidence; they are not described as full reruns of the final artifact.

The subsequent remote run exposed a smaller-window boundary at about 328 CSS pixels high. One new test had assumed the proposal list stayed visible after compact navigation; another correctly exposed oversized list scroll clearance. The 0.1.4 source follow-up uses a 2px list clearance and tighter short-window title spacing, preserves control sizes, and passed the affected small-window checks and existing regressions. Its rebuilt package also corrects clipped dialog focus and repeated Activity-return scroll drift. Independent checks passed eight layout groups and 32 middle/end returns with exact positions, preserved records and focus; the [0.1.4 publication run](https://github.com/li508q/agent-space/actions/runs/45145805796) subsequently passed all three jobs. Earlier failures retain their original candidate scope.

The 0.2.0 application from `d7202a4` implements shared current-head review states, bounded filtering, a distinct Continue view and explicit saved/reviewed versions. The integrated source gate passed 133/133; the affected final source runs passed 14/14 at normal and 688px-capped bounds, and 10/10 at 681px. Its rebuilt, relocated package passed bundled CLI/MCP verification and a focused independent check of review controls, history return, Details return, failure/retry and Spanish rows. Earlier candidates exposed clipped focus and return-position defects; their failures remain separate evidence. The new package did not repeat every earlier Core and native flow. Contextual setup is implemented in the following 0.2.1 source and has its separately scoped package acceptance. Writing-detail work and complete workflow acceptance remain open.

A following CI run exposed an original-edit focus timeout at 1.5× text, with the correct saved body already installed. A bounded source correction handles a hidden source trigger's natural blur without taking focus from a later control or dialog. Original assertions and the delayed failure mechanism pass locally; the [exact source publication CI](https://github.com/li508q/agent-space/actions/runs/45202596836) passed all three jobs. The preceding package acceptance retains its original scope. See [the follow-up evidence](TESTING.md#original-edit-focus-follow-up).

The 0.2.1 independent package check observed the six contextual-collaboration business batches without a failure. Its seven layout groups exposed a clipped task field/outline and version descriptions outside the dialog. The bounded source correction now passes 42 strict focus observations and preserves pointer placement, human input and fixed versions. A shared test clipboard device also keeps three native copy flows out of the user's OS clipboard while retaining their actual IPC/MCP assertions. A rebuilt package from `a68aec7` subsequently passed the independent seven-group focus/pointer and minimal-business follow-up, with matching entry/exit fingerprints and normal shutdown. It did not repeat the preceding six business batches; publication CI remains a separate gate.

Informal owner use also identified a visual-design gap. Professional color, control hierarchy, icons and restrained materials are a separate planned correction. Real personal-source intake and freely combining material across levels are being scoped from actual notes; they have not been delivered by a document or inventory alone. Complete workflow acceptance remains open.

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

| Area                        | Review outcome                                                                                                                                           | Evidence or remaining boundary                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product definition          | Keep personal ownership, direct use and understandable human–agent collaboration as the center.                                                          | Original interviews map to PRD scenarios; monthly reporting remains an example, and the broader digital-twin vision remains deferred.                                                                                                                                               |
| PRD and acceptance          | Preserve the original pains and test their natural paths, not only API availability.                                                                     | Project inspection/correction is now accepted; the remaining paths below stay open rather than being removed from the requirements.                                                                                                                                                 |
| Stack and data model        | Retain the shared TypeScript/SQLite Core, restricted Electron interface and MCP/CLI adapters.                                                            | Architecture decisions explain alternatives and actual runtime proofs. The correction needs no new database, dependency or permission.                                                                                                                                              |
| Implementation and division | Assign one bounded slice and one application writer; independently inspect the resulting build.                                                          | Project correction and change discovery have separate implementation and moved-package evidence. Later slice contracts are design inputs, not completed features.                                                                                                                   |
| Verification                | Keep persistence, protocol and native evidence distinct from usability claims.                                                                           | Current 0.2.1 source check: 138/138. Independent 0.1.1 acceptance: twenty locale/layout groups plus two full keyboard paths; the separate 0.1.2 follow-up covers compact status, cancellation and preserved human work. Real first-user and long-term effectiveness are unverified. |
| Languages and interface     | Keep five-language UI and primary guides, with native enlarged-text checks.                                                                              | Critical 7A controls worked in all five locales; this is not certification by native-speaking users or physical IMEs.                                                                                                                                                               |
| Documentation and GitHub    | Correct stale stage wording, unimplemented interaction examples and README status visibility; extend CI to guarded human paths and safe package reports. | The repository contains the resulting contracts and real screenshots; remote CI must pass for each published revision. No hosted site or release publication is implied.                                                                                                            |

The main process correction is to separate capability delivery from the person's complete experience. Existing API support did not make project accumulation discoverable or an original easy to correct. Those gaps required working UI changes. Repeating reviews or polishing prose cannot close the remaining paths.

## Corrections tied to the original pains

**Closed within the separately recorded 0.1.1–0.2.1 checks:**

- **Inspect project accumulation.** A bounded goal excerpt, continuation, direct assets and material navigation precede the full writing surface. Independent checks reached all 67 members and 57 direct assets; indirect assets were not mixed into the direct set.
- **Correct from the reading path.** Edit current original follows the same ID through K1 reading, K2 editing and K3 saving. Historical K1 and proposal evidence remain fixed. Existing drafts, failed saves, cancellation, conflict and return focus retain their protections.

- **Reach pending navigation controls.** Compact list and Details presentation no longer hide the existing status. Opening can be cancelled by keyboard; preparation that confirms a write remains visible. Original list/details state, later input and the existing reader survive the transition.

- **Find what changed.** Activity separates durable events from prepared tool references. Pending and Processed retain per-status pagination; original reasons, differences, evidence pins and accepted-result versions remain inspectable after restart. Later human edits and recoverable input survive reading and return.

- **Find reviewed knowledge and resume work.** Shared bounded queries expose never-reviewed, current-reviewed and changed-since-review states. Continue uses recent work, recovery and recent-change access; Library retains complete browsing. Reading or accepting a proposal never certifies the current version as reviewed.

- **Prepare collaboration from the material being read.** Selected saved versions, a visible brief and explicit object-access setup preserve historical pins, human writing and scope. The six first-candidate business batches and the corrected package's seven-group focus/pointer follow-up have separate evidence; real-model handoff remains part of the final integrated trial.

**Still open:**

| Problem                                                | Current behavior                                                                                                                | Bounded correction                                                                      | Observable acceptance                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final two-agent handoff                                | Context preparation, generated access and real SDK calls work; the final two-fresh-model sequence has not run                   | Use the final exact package with separate model processes and grants                    | A second agent continues from shared accepted results and authorized sources without the first private conversation                                 |
| Asset location and technical detail distract from work | Origin labels are visible, but the recorded location is not directly available; context-format explanations occupy every editor | Inspect/copy the stored location and disclose technical context metadata when requested | Obtain the original location without executing it; write in all locales at narrow/enlarged layouts with save failure, conflict and recovery visible |

The owner's additional visual feedback calls for clearer control hierarchy, icons, density and restrained materials. A selected design direction is not yet an implemented interface. Likewise, the private catalog and bounded reading of real notes are preparation for personal-source intake and cross-level selection, not proof that those workflows already work. Their implementation must be bounded by actual use, preserving original files and private data.

The implementation must reuse the common Core and existing guards. Review filtering must be part of the bounded shared query contract, not a client-side scan of every document body. A project link must never silently expand a grant. Historical evidence remains read-only. Import must not automatically certify knowledge or overwrite later human relationships.

The five usage guides distinguish Actual changes, Prepared context and Pending/Processed review. Their separate entries expose saved events, prepared references and proposal outcomes with their own meaning. A prepared result does not confirm host receipt, understanding or external task completion.

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
