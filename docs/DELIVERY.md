# Delivery plan

Started 2026-11-22; milestone updated 2026-11-23. The main coordination session owns phase transitions and integration. Each session receives a bounded assignment and returns evidence before the next phase begins.

The user has delegated product and engineering decisions to the coordinator within the focused local-product requirements. The coordinator decides and verifies each phase, reports material tradeoffs and results, and advances without requiring routine user sign-off. New user feedback remains the basis for adjustment.

Every phase remains anchored to the main-session interviews and the scenario provenance table in the PRD. New requirements must serve those pains or an explicit user update. Synthetic fixtures can test the real patterns; they must not be described as the user's original data or as observed product validation.

## Phases and exit criteria

| Phase                                      | Outcome                                                                                                                                       | Exit criteria                                                                                                                     | Current status                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0 Research baseline                        | User interviews, knowledge-update study, context study, architecture proposal                                                                 | Distinguish confirmed needs, recommendations, and limited experiments; retain original research                                   | Complete as input evidence                                   |
| 1 Product definition and PRD               | Product promise, focused scope, key scenarios, acceptance matrix, independent product and feasibility reviews                                 | Requirements reflect the user's actual pains; first-release boundaries are explicit; major product contradictions are addressed   | Complete; verified against focused acceptance targets        |
| 2 Technical design and implementation plan | Stack ADRs, storage and mutation contracts, MCP/IPC boundary, UI structure, localization contract, test strategy, owned implementation slices | Choose a practical main route; prove the highest-risk runtime/storage assumptions; define interfaces before parallel coding       | Complete; implementation and measured limits documented      |
| 3 Core vertical slice                      | Create/open space, human document edit, real MCP proposal, UI review/accept, conflict and conditional undo, restart                           | Real persistence, native desktop flow, and real agent calls pass; changes and recovery are understandable                         | Complete; native UI and actual SDK collaboration verified    |
| 4 Focused feature completion               | Project continuity, source/asset references, typed records, bounded context tools, import/export and backup/restore                           | PRD core functions work together; primary controls have real effects; keep deferred scope outside the release                     | Complete; integrated native and Core checks passed           |
| 5 Verification and refinement              | Reliability and boundary checks, daily-use UX, five-locale UI checks, packaged-app tests                                                      | Acceptance matrix has real evidence; meaningful failures are corrected; limitations match the tested platforms and build          | Complete; native/package/locale evidence and limits recorded |
| 6 Documentation and GitHub delivery        | Concise five-language primary docs, screenshots, contributor/license/CI material, repository presentation, reviewed commits and push          | Commands work; screenshots show the real app; no personal data or temporary output is tracked; remote contents and CI are checked | Published; current main CI linked below                      |

Tests accompany each implementation slice. Phase 5 is the integrated verification pass, not the first time the application is tested. Localization strings and layout constraints begin in phase 2; phase 6 completes the publication wording and presentation.

## Coordination and specialist guidance

| Work                            | Guidance and method                                                                                                     | Ownership                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Phase management                | Repository `agent-space-delivery` skill; explicit inputs, outputs, evidence, and scope changes                          | Main coordinator                                      |
| Product and PRD                 | Original interviews, independent product critique, requirement-to-scenario acceptance matrix, document-writing guidance | Coordinator, with independent reviewer                |
| Architecture and implementation | Independent technical review, current primary documentation, explicit ADRs, risk-focused prototypes                     | Technical session, integrated by coordinator          |
| Product interface               | `frontend-design`, applicable `ui-ux-pro-max` rules, brief-specific tokens, native interaction and screenshot review    | Assigned UI owner                                     |
| Verification                    | Real SQLite/core integration, real MCP client calls, native desktop end-to-end checks, security and recovery boundaries | Implementation owner plus independent acceptance pass |
| Five-language publication       | Consistent terminology, native-language review, real screenshots, link/command checks, repository writing guidance      | Documentation/localization owner, coordinator review  |

Independent review reports remain local in `.coordination/reviews/` and are excluded from Git. Public documents contain the resulting requirements, decisions, and real verification limits. Review conclusions are not implementation facts.

## Current milestone

The focused 0.1.0 implementation is complete. It gives people direct local writing, project/record/asset organization, inspectable agent context, reviewable changes, guarded history and portable local data. No provider account is required for direct use. A monthly review is a validation example, not a built-in routine or role engine.

The integrated Core/contract/UI-state/desktop-unit/real protocol gate passed 115/115, with strict TypeScript and zero-warning lint. Independent reviews found and corrected a navigation race, mixed-revision import pagination and acquisition of a changed backup. Their actual failing boundaries were reproduced before correction and passed afterward. These safeguards support control over human work; they are not claims of semantic truth or arbitrary external-file coordination.

Visible native checks cover direct writing, actual SDK proposal/review, pinned-source reading and return focus, later-edit protection, projects and typed records, incoming links, external-asset relink/archive/restore, import preview/results/retry, backup/export, verified restore to a new instance and foreign draft rescue. Tests preserve originals and keep unknown operation results separate from success. Five-language review and local-data controls were exercised at 980px with native standard and enlarged text.

The actual macOS arm64 app has been built, ad-hoc signed, ZIP-extracted and moved to a path with spaces. Its bundled runtime runs CLI and simultaneous legacy/modern MCP without system Node, and the same moved application passes visible workbench and local-data checks. Ad-hoc signing does not imply Developer ID, notarization or Gatekeeper acceptance. Physical OS IMEs, other operating systems, power-loss and destination disk-full remain outside the verified scope. See [TESTING.md](TESTING.md) for precise evidence.

Five-language primary documentation, ten real native screenshots, contributor/security guidance, issue/PR templates and pinned CI are published in the [source repository](https://github.com/li508q/agent-space). Local and remote source trees have been compared, and private data/build directories are excluded. The [Verify workflow](https://github.com/li508q/agent-space/actions/workflows/ci.yml) reports the current main result: complete Node 22/24 checks plus actual macOS native integration, production packaging and relocated bundled-runtime verification. A first-run Node 22 failure exposed a test helper that exhausted event-loop turns before asynchronous backup finished; it now uses a bounded elapsed-time wait and retains all result assertions. No production code or artifact changed for that correction. Generated local applications are excluded from Git; CI artifacts are temporary builds, not a GitHub release. No hosted deployment is part of this task.

The first release remains local-first and single-user. Cloud sync, teams, broad integrations, arbitrary mini-app execution and a general-purpose chat/orchestration product are outside this delivery.

## Phase report format

At each transition, report: completed artifacts, decisions and reasons, verification performed and its limits, unresolved material issues, and the next bounded assignment. Keep the milestone report useful to the user; do not substitute session activity or a test count for working behavior.

Product or scope changes are recorded in the PRD and relevant decision record. The coordinator handles coherent commits and the final authorized push to `li508q/agent-space` on `main`. Hosted deployment and release publication are separate actions.
