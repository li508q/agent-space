# Product brief

**Work with AI. Stay in control.**

AgentSpace is a personal workspace for writing, organizing knowledge and collaborating with different agents through shared context. The person owns the material, decides which changes take effect and can inspect or recover their work.

## User outcomes

- Continue work across projects and agents without rebuilding context from private conversations.
- See what a project accumulated and edit the original material directly.
- Understand a proposed change through its purpose, difference, reason and exact sources.
- Keep notes, documents, structured records and reusable assets connected without duplicating their authority.
- Retain later human work when a proposal, save or recovery operation conflicts.

## Product model

A local space holds documents, projects, records and asset references. Objects have stable IDs, typed properties, relationships and versioned content. Notes can stand alone; one asset can serve several projects.

People use the desktop directly without a model account. External agents use scoped MCP or CLI tools to discover material, read exact versions and submit proposals. The person reviews each proposal before it becomes accepted content.

Tasks remain open-ended. Querying, reading, linking and proposing can be combined for research, project handoff or a retrospective. The product does not prescribe a role sequence or routine.

## Control principles

1. **One authority.** The desktop and agents share the same transactional Core.
2. **Explicit scope.** Access is granted deliberately. Links do not grant access to their targets.
3. **Visible evidence.** Prepared material, proposals, accepted results and knowledge review have distinct meanings.
4. **Protected work.** Version checks, recoverable drafts and conditional undo preserve later edits.
5. **Owned data.** Imported originals remain intact. Full backups and readable exports serve different purposes.

Transparency covers declared intent, supplied references, tool results and durable changes. It does not expose private model reasoning or certify an external task's completion.

## Scope

The current product is local-first and single-user. It supports direct Markdown writing, project continuity, lightweight typed records, reusable references, bounded context access, proposal review, history and local portability.

Cloud collaboration, a general chat host, workflow orchestration, arbitrary app execution, full spreadsheets and broad calendar integrations are outside this scope. Literal search and bounded traversal do not promise semantic recall or automatic truth assessment.

The UI and primary guides support English, Simplified Chinese, Japanese, Korean and Spanish. Authored text keeps its original language. The packaged desktop target is macOS Apple Silicon; see [desktop requirements](DESKTOP.md) and [verified scope](TESTING.md).

## Reference

- [Requirements](PRD.md): behaviors and acceptance criteria.
- [Interaction specification](UX.md): states, actions and transitions.
- [Architecture](ARCHITECTURE.md): authority, boundaries and design decisions.
- [Data and trust boundaries](SECURITY.md): access and local file protection.
