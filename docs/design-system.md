# Workbench design

Status: workbench structure and tokens used by writing/review and organization. Local import, transfer, recovery and historical-evidence additions require integrated native layout checks; evidence is tracked in [TESTING.md](TESTING.md). Detailed interaction states are specified in [UX.md](UX.md).

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

Organization extends the same workspace. Project goals use ordinary prose, with optional authored fields and a restrained list of accumulated material. Record fields use labeled controls in a bounded editing dialog; rows are separated by rules rather than repeated cards. Preserve an explicit unapplied state until validated values enter the main editor. Field identity belongs in optional technical disclosure, while labels and values remain primary. New material choices stay beside the material list, and independent notes retain their global action.

The record table occupies the writing surface, uses a selected record as its column reference, and states its 50-row limit and loaded/query scope. Missing, unset, and differently defined fields have text labels rather than ambiguous blank cells. Use semantic headers, an individually named keyboard-scrollable table region, and wrapping surrounding controls. At narrow widths or native zoom, the table scrolls inside its region; its controls remain above it and may scroll vertically when space is limited. Asset reference inspection uses ordinary links with an explicit checked-result range, without a graph or unverified coverage count.

Use visible focus, semantic buttons, announced errors and retained input. Dialogs must trap focus and restore it on close. Defer disruptive transitions during composition, respect reduced motion, and keep controls visible under localized wrapping and zoom. The keyboard-focus and error-recovery guidance was matched in the UI/UX reference; earlier marketing-layout matches were not adopted. Native screenshots and interaction checks remain phase 3–5 work.

Local operations extend the same hierarchy: space-level actions in the space menu, object lifecycle/location in Details, version explanations in History, and other-installation recovery in Continue working. Import entries and per-item outcomes use wrapping rows separated by rules; relative paths identify otherwise repeated filenames. Suggested grouping is editable, with the reused-object limitation visible beside it. Keep long localized controls reachable within the dialog's vertical scroll. Two-column group controls become one column below 640 CSS pixels, including under native zoom.

Use a plain progress element only for a reported positive total. An unknown total gets a processed count, and an uncertain outcome gets a persistent explanation with check/retry actions. A checked restore receipt and the result of opening its space are separate regions. Incoming links and accepted evidence use compact link lists with scope/limit text. They do not introduce graph canvases, decorative status cards or another permanent pane. The saved-context action is subordinate to writing and explicitly states its one-version scope.
