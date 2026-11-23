# Design system

AgentSpace is a document workspace. Keep writing central and evidence close to the affected material. Interaction states are defined in [UX](UX.md).

## Tokens

The maintained CSS sources are [`tokens.css`](../src/renderer/styles/tokens.css), [`base.css`](../src/renderer/styles/base.css) and [`app.css`](../src/renderer/styles/app.css).

| Role                     | Value                 |
| ------------------------ | --------------------- |
| Primary / secondary text | `#202936` / `#536170` |
| Document / canvas        | `#ffffff` / `#f3f5f7` |
| Action / selection text  | `#3658ad`             |
| Accepted / added         | `#246347`             |
| Attention / failure      | `#805600` / `#b42318` |
| Divider                  | `#d9e0e7`             |

Use local system fonts with locale-appropriate CJK fallbacks. UI text is 14px; prose is 17px at 1.6 line height, with a 70ch measure. Code uses the platform monospace family. Spacing follows a 4/8px rhythm. Lucide provides one outline icon family.

## Layout

- Keep prose continuous and left aligned. Use rows and dividers for collections; reserve shadows for dialogs.
- At medium widths, Details replaces the list. Below 1100 CSS pixels, use compact list/detail and panel return controls rather than compressing every pane.
- Reflow actions and long translated labels. Scroll tables within a named region; surrounding controls remain reachable.
- Keep project overview entries before the complete project body. Display counts as loaded or checked material, not inferred totals.
- Keep original/base, proposal and accepted/current result visibly distinct. Show all changed properties and links, with text or symbols alongside color.

## Input and feedback

- Use semantic controls, explicit labels and complete focus paint. Fixed chrome must not cover text, caret, diff or focused actions.
- Trap modal focus and restore its trigger on close. Preserve input and selection through language changes; defer destructive transitions during composition.
- Distinguish unsaved, saving, saved, failed, unknown and retained-draft states. Keep recovery actions beside persistent errors.
- Animate only state feedback. Respect reduced motion and avoid movement beneath a focused pointer target.
- Use a percentage only for an observed positive total. Otherwise show the reported stage/count. Prepared context and copied configuration do not imply an external task's progress.

## Content hierarchy

Put authored titles, content, reasons and source versions before technical identifiers. Show record field definitions, differing/missing values and table limits explicitly. Keep the saved-context action subordinate to writing and label its one-version scope.

Use the space menu for import/portability, Details for fields/relationships/lifecycle and History for versions. Do not add a permanent pane, graph or dashboard for an operation served by the existing workspace.

Verify composed contrast, wrapping, focus, caret and hit areas in the native application; token values alone do not establish accessibility. See [Testing](TESTING.md).
