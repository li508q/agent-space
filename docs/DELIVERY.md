# Delivery plan

Date: 2026-11-22. The main coordination session owns phase transitions and integration. Each session receives a bounded assignment and returns evidence before the next phase begins.

## Phases and exit criteria

| Phase | Outcome | Exit criteria | Current status |
|---|---|---|---|
| 0 Research baseline | User interviews, knowledge-update study, context study, architecture proposal | Distinguish confirmed needs, recommendations, and limited experiments; retain original research | Complete as input evidence |
| 1 Product definition and PRD | Product promise, focused scope, key scenarios, acceptance matrix, independent product and feasibility reviews | Requirements reflect the user's actual pains; first-release boundaries are explicit; major product contradictions are addressed | Scope established; implementation evidence pending |
| 2 Technical design and implementation plan | Stack ADRs, storage and mutation contracts, MCP/IPC boundary, UI structure, localization contract, test strategy, owned implementation slices | Choose a practical main route; prove the highest-risk runtime/storage assumptions; define interfaces before parallel coding | In progress |
| 3 Core vertical slice | Create/open space, human document edit, real MCP proposal, UI review/accept, conflict and conditional undo, restart | Real persistence, native desktop flow, and real agent calls pass; changes and recovery are understandable | Planned |
| 4 Focused feature completion | Project continuity, source/asset references, typed records, bounded context tools, import/export and backup/restore | PRD core functions work together; primary controls have real effects; keep deferred scope outside the release | Planned |
| 5 Verification and refinement | Reliability and boundary checks, daily-use UX, five-locale UI checks, packaged-app tests | Acceptance matrix has real evidence; meaningful failures are corrected; limitations match the tested platforms and build | Planned |
| 6 Documentation and GitHub delivery | Concise five-language primary docs, screenshots, contributor/license/CI material, repository presentation, reviewed commits and push | Commands work; screenshots show the real app; no personal data or temporary output is tracked; remote contents and CI are checked | Planned |

Tests accompany each implementation slice. Phase 5 is the integrated verification pass, not the first time the application is tested. Localization strings and layout constraints begin in phase 2; phase 6 completes the publication wording and presentation.

## Coordination and specialist guidance

| Work | Guidance and method | Ownership |
|---|---|---|
| Phase management | Repository `agent-space-delivery` skill; explicit inputs, outputs, evidence, and scope changes | Main coordinator |
| Product and PRD | Original interviews, independent product critique, requirement-to-scenario acceptance matrix, document-writing guidance | Coordinator, with independent reviewer |
| Architecture and implementation | Independent technical review, current primary documentation, explicit ADRs, risk-focused prototypes | Technical session, integrated by coordinator |
| Product interface | `frontend-design`, applicable `ui-ux-pro-max` rules, brief-specific tokens, native interaction and screenshot review | Assigned UI owner |
| Verification | Real SQLite/core integration, real MCP client calls, native desktop end-to-end checks, security and recovery boundaries | Implementation owner plus independent acceptance pass |
| Five-language publication | Consistent terminology, native-language review, real screenshots, link/command checks, repository writing guidance | Documentation/localization owner, coordinator review |

Independent review reports remain local in `.coordination/reviews/` and are excluded from Git. Public documents contain the resulting requirements, decisions, and real verification limits. Review conclusions are not implementation facts.

## Current milestone

Phase 1 is complete as a definition milestone. Independent product, architecture, and implementation-feasibility reviews have been compared, and the PRD now covers the focused flows, save/review states, five-language experience, and acceptance targets.

Phase 2 is active. It is limited to technical decisions, contracts, runtime probes, and a bounded implementation plan. Starter configuration remains provisional until compatibility is checked. Application feature development starts with phase 3's core vertical slice.

The first release remains local-first and single-user. Cloud sync, teams, broad integrations, arbitrary mini-app execution, and a general-purpose chat/orchestration product are outside this delivery.

## Phase report format

At each transition, report: completed artifacts, decisions and reasons, verification performed and its limits, unresolved material issues, and the next bounded assignment. Keep the milestone report useful to the user; do not substitute session activity or a test count for working behavior.

Product or scope changes are recorded in the PRD and relevant decision record. The coordinator handles coherent commits and the final authorized push to `li508q/agent-space` on `main`. Hosted deployment and release publication are separate actions.
