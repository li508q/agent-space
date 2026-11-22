---
name: agent-space-delivery
description: Coordinate staged product definition, architecture, implementation, verification, localization, and repository delivery for AgentSpace. Use for this repository's delivery work, not for the product's end-user task workflows.
---

# AgentSpace staged delivery

Use this skill with the repository's `docs/product-brief.md`, `docs/PRD.md`, and `docs/DELIVERY.md`. Read the current phase and actual evidence before dispatching work. The user's central value is stronger human control through legible human–agent collaboration; a new feature must serve that value or an existing acceptance requirement.

Use the PRD's interview-origin scenarios when choosing features and checks. Keep reported practice/pain, stated needs, jointly constructed examples, and engineering risk cases distinct. Do not promote a monthly example or a future vision into the product's required workflow.

## Bound each assignment

Give each session an objective, source inputs, included and excluded scope, owned paths, expected artifact, meaningful checks, and a stopping point. Authorize only the current phase. Preserve already completed work when the user changes sequencing; do not let a session silently continue into later phases.

Independent reviewers receive the same user requirements and raw evidence. They do not read peers' reports or implementation conclusions during their first pass. The coordinator compares their results, records a reasoned decision, and then sends bounded integration feedback. File ownership and separate context reduce interference; they are not OS isolation.

## Use evidence for transitions

Keep requirement, proposal, decision, implementation, and verification status distinct. A document existing does not prove a workflow works. Before closing a phase:

- Match its artifacts to the phase's exit criteria in `docs/DELIVERY.md`.
- Resolve material contradictions, or name the remaining decision and its consequence.
- Match each completion claim to inspected code, a real result, or a clearly labeled design artifact.
- Report the concrete outcome and next bounded phase in the main session.

Do not create approval gates for routine choices already authorized by the user. Ask about a material scope or product tradeoff with a concrete recommendation and alternatives. A failed check leads to a focused correction; it does not justify unrelated expansion or an inaccurate success claim.

## Apply specialist guidance selectively

Use `frontend-design` and applicable `ui-ux-pro-max` guidance for product interaction and visual work. Use the document-writing skill for product/usage prose when available, honoring repository Markdown. Use current primary documentation for implementation choices and the actual desktop/MCP toolchain for checks. Load only relevant guidance; a landing-page pattern is not a desktop workbench design.

Integrate localization from the first UI contracts, then verify English, Chinese, Japanese, Korean, and Spanish before delivery. Preserve user-authored content and keep technical details out of primary product flows unless needed for a decision.

## Keep implementation and delivery honest

Protect the difference between a visible demo and real data, a proposal and an accepted change, an operation receipt and remote execution, an automated test and a product guarantee. Test the boundary that could fail, including restart, stale writers, conditional undo, actual agent calls, native UI, and export/restore.

Commit only a coherent reviewed phase. Push to the authorized remote after the planned integration and verification. Never commit personal data, credentials, temporary review material, or unreviewed generated output. Check GitHub results after the push; publish releases or deploy services only within separate user authorization.

These are development phases. Do not turn them into mandatory user workflows, fixed role agents, or a general orchestration engine inside AgentSpace.
