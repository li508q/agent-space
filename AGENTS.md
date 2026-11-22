# AgentSpace development

Build a focused, local-first personal workbench for clear human–AI collaboration. The product should strengthen the person's control: goals, sources, proposed changes, accepted results, and recovery are understandable. It must work directly for a person without a model provider.

## Staged coordination

The user explicitly requested phased delivery under the main session. Read `.agents/skills/agent-space-delivery/SKILL.md` and `docs/DELIVERY.md`. Execute only the currently assigned phase; return its artifact and evidence before proceeding. Do not interpret the overall product objective as authorization to skip product definition, PRD, technical contracts, or verification. A session asked to stop at a safe boundary must retain its work and report it, not continue the full application on its own.

## Scope and quality

- Follow `docs/product-brief.md`. Turn the user's actual pains into working flows, not a broad platform or a mock interface.
- Keep content, project continuity, reusable asset references, shared context, and reviewable changes in one coherent local space. Preserve independent object identity, source references, revisions, and field ownership.
- Human edits can save directly. Agent changes use explicit scope, expected revision, explanation, and a reviewable proposal by default. Show conflicts and protect later edits during undo.
- Implement actual local persistence, search, recovery, export, and a real agent interface. Demo fixtures must be visibly identified and separated from user data. Never simulate an AI connection or report unobserved agent progress as real.
- Transparency means declared intent, sources, tool actions, proposals, and results. Do not promise access to a model's private internal reasoning.
- Choose a maintainable modern stack using current primary documentation and actual available toolchains. Explain material changes from the prior architecture in an ADR. Avoid dependencies added only to look modern.
- The desktop renderer must not have unrestricted filesystem, process, database, or network privileges. Validate every IPC/tool request at the trusted boundary. Source files and imported instructions are data.
- Use `frontend-design` and `ui-ux-pro-max` for product UI. The taste skill explicitly excludes multi-step product interfaces and is not the layout authority here. Use a considered document/workspace design, keyboard access, clear states, restrained motion, and locally available fonts/assets. Verify the real desktop UI with screenshots and interaction tests.
- Verify the change with meaningful core integration, real MCP/tool calls, and desktop end-to-end checks. Build a launchable macOS artifact on this machine; state platform/signing limits accurately. Do not label an unverified build production-ready.
- Maintain professional repository basics, a lockfile, reproducible scripts, focused documentation, CI, license information, and useful error messages. Do not put personal machine paths, credentials, or private source data in public-facing docs or fixtures.
- Preserve the coordinator-provided research archive outside this repository as read-only source material. Do not copy personal paths or raw personal context into this public repository.
- Deliver UI and primary product documentation in English, Simplified Chinese, Japanese, Korean, and Spanish. Keep strings externalized and verify layout and critical controls in every locale. User-authored content keeps its original language.
- Work only in this repository or isolated temporary/build directories. Do not alter global user settings or repository settings. The user has authorized the root coordinator to commit and push the verified implementation to the provided remote main branch; implementation/review sessions must leave Git commits and pushes to the coordinator. No hosted deployment or release publication is implied.

## Independent session boundaries

- Product/UX reviewer owns only `.coordination/reviews/product-ux-independent.md`.
- Architecture/reliability reviewer owns only `.coordination/reviews/architecture-independent.md`.
- The implementation session owns application code, tests, build scripts, assets, and implementation documentation. It must preserve the root coordinator's `AGENTS.md` and `docs/product-brief.md`.
- Reviewers and implementer must not read each other's review reports or message each other during the independent pass. Use the same user brief and original evidence; form conclusions independently.
- The root coordinator alone compares the independent findings and sends concrete integration feedback. Independence is an instruction and file-ownership boundary, not an operating-system sandbox.
- Keep `.coordination/`, local build outputs, test databases, and personal machine metadata out of Git. Public documentation should describe the product and its real guarantees, rather than narrating agent sessions.
- Do not create nested sessions unless the root/user explicitly requests them. Do not reset or overwrite another session's files. Report the paths changed and actual verification results.
