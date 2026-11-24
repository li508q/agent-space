# Design system

AgentSpace is a document workspace. Keep writing central and evidence close to the affected material. Interaction states are defined in [UX](UX.md).

## Tokens

The maintained CSS sources are [`tokens.css`](../src/renderer/styles/tokens.css), [`base.css`](../src/renderer/styles/base.css) and [`app.css`](../src/renderer/styles/app.css).

| Role                             | Value                                           |
| -------------------------------- | ----------------------------------------------- |
| Primary / secondary text         | `#1e2a3b` / `#526176`                           |
| Document / canvas / chrome       | `#ffffff` / `#f1f4f8` / `#e9eef5`               |
| Primary action / hover / pressed | `#315acc` / `#284db6` / `#223e91`               |
| Selection background / text      | `#e5edff` / `#284db6`                           |
| Control boundary / divider       | `#6f7e94` / `#d8e0ea`                           |
| Disabled text / background       | `#5a6a80` / `#f1f4f8`                           |
| Accepted / added                 | `#246548` on `#eef7f1`                          |
| Attention / failure              | `#835b05` on `#fff5dd` / `#b5373d` on `#fff0f0` |

Use local system fonts with locale-appropriate CJK fallbacks. UI text is 14px; prose is 17px at 1.65 line height, with a 70ch measure. Code uses the platform monospace family. Spacing follows a 4/8px rhythm. Lucide provides one outline icon family.

## Layout

- Separate 200px navigation, 248px material list and continuous white document surfaces. Details uses 288px when space allows. Keep ordinary actions secondary; reserve cobalt for the primary decision. Selected modes and keyboard focus have distinct indicators.
- Keep prose continuous and left aligned. Use rows and dividers for collections; reserve shadows for dialogs.
- At medium widths, Details replaces the list. Below 1100 CSS pixels, use compact list/detail and panel return controls rather than compressing every pane.
- Reflow actions and long translated labels. Scroll tables within a named region; surrounding controls remain reachable.
- Keep project overview entries before the complete project body. Display counts as loaded or checked material, not inferred totals.
- Keep original/base, proposal and accepted/current result visibly distinct. Show all changed properties and links, with text or symbols alongside color.

## Input and feedback

- Use semantic controls, explicit labels and complete focus paint. Fixed chrome must not cover text, caret, diff or focused actions.
- Trap modal focus and restore its trigger on close. Preserve input and selection through language changes; defer destructive transitions during composition.
- Distinguish unsaved, saving, saved, failed, unknown and retained-draft states. Keep recovery actions beside persistent errors.
- Primary actions switch foreground and background immediately in every state. Other controls use 80ms color feedback; selected modes use 120ms. Reduced motion is static. Do not animate the position or opacity of focused dialogs, panes or inputs.
- Default to opaque surfaces. Only the application header may gain restrained blur when supported and transparency/contrast preferences permit it. Reduced transparency, unsupported queries and forced colors retain opaque surfaces. Prose, diff, warnings and menus remain opaque; this is not a claim of native Liquid Glass.
- Use a percentage only for an observed positive total. Otherwise show the reported stage/count. Prepared context and copied configuration do not imply an external task's progress.

## Content hierarchy

Put authored titles, content, reasons and source versions before technical identifiers. Show record field definitions, differing/missing values and table limits explicitly. Keep the saved-context action subordinate to writing and label its one-version scope.

Use the space menu for import/portability, Details for fields/relationships/lifecycle and History for versions. Do not add a permanent pane, graph or dashboard for an operation served by the existing workspace.

Verify composed contrast, wrapping, focus, caret and hit areas in the native application; token values alone do not establish accessibility. See [Testing](TESTING.md).
