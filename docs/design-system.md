# Workbench design

Status: phase 2 visual structure and tokens; no final interface has been built or verified. Detailed interaction states are specified in [UX.md](UX.md).

AgentSpace is a document workspace. Writing occupies the center; provenance and proposed changes remain close to the affected material.

| Token | Value     | Purpose                      |
| ----- | --------- | ---------------------------- |
| Ink   | `#202936` | Primary text                 |
| Slate | `#536170` | Secondary text               |
| Paper | `#ffffff` | Writing surface              |
| Mist  | `#f3f5f7` | Navigation and context       |
| Blue  | `#3658ad` | Selection and primary action |
| Green | `#246347` | Accepted and added material  |

System UI fonts stay offline, with locale-appropriate system fallbacks. Default document reading and prose editing use a comfortable system sans-serif; code uses the platform monospace family. UI text is about 14px, reading text 16–17px with a 1.6 line height and a 60–75-character measure. Spacing follows a 4/8px rhythm. Borders encode pane boundaries and selected objects; shadows are reserved for dialogs. Lucide supplies one outline icon family. These tokens implement the interaction direction in UX.md rather than defining a second competing theme.

```text
┌ Space / project / material                         Language ┐
├───────────────┬────────────────────────────┬────────────────┤
│ Continue work │ Title / saved state        │ Details        │
│ Projects      │                            │ Relationships  │
│ Library       │ Markdown or typed records  │ Pinned sources │
│ Review        │                            │ Versions       │
│               │                            │                │
└───────────────┴────────────────────────────┴────────────────┘
```

All content is left aligned. Follow UX.md's responsive behavior: at medium widths Details replaces the list, and below 1100px use collapsible navigation and list/detail routes instead of squeezing more panes into the editor. Panels scroll independently without hiding focused controls. Review pairs removed and added lines, retains unchanged context, and shows the current revision beside the proposal base. Text and labels identify conflict and acceptance in addition to color.

This structure puts actual material ahead of counts or decorative cards. Source evidence sits beside writing; proposed changes replace the central reading surface while preserving a return path to cited material. Show creation candidates as proposed new documents/records, not as already saved objects. Current project links and pinned evidence need visibly distinct meanings in details.

Use visible focus, semantic buttons, announced errors and retained input. Dialogs must trap focus and restore it on close. Defer disruptive transitions during composition, respect reduced motion, and keep controls visible under localized wrapping and zoom. The keyboard-focus and error-recovery guidance was matched in the UI/UX reference; earlier marketing-layout matches were not adopted. Native screenshots and interaction checks remain phase 3–5 work.
