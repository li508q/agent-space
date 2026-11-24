# Interaction specification

The desktop presents shared material, human writing and agent proposals with explicit state and recoverable transitions. This is the interaction contract; [requirements](PRD.md), [visual rules](design-system.md) and [verification](TESTING.md) define the related constraints.

## Navigation

| Destination      | Purpose                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Continue working | Resume recovery drafts or up to ten recent objects in this space instance; open recent changes or import material. |
| Projects         | Inspect project goals, continuation, accumulated material and direct assets.                                       |
| Library          | Browse bounded results by type, lifecycle, project, text and version-review status.                                |
| Review           | Read pending/conflicted or applied/rejected proposals and inspect their outcomes.                                  |
| Activity         | Inspect actual authority events separately from prepared tool context.                                             |

The space name remains visible. Example spaces carry a persistent label. Search, New note and Settings stay reachable. Details and History are contextual panels; compact layouts show them in front of the working surface. Close the panel to return to the editor.

Recent positions contain IDs and times, not authored text. They belong to one space instance. Empty recent work does not imply an empty Library. In-session source returns preserve their caller; a global persisted Back/Forward stack is not provided.

## Writing and save state

All object kinds use the same title/body editor, history and save guards. Notes may exist without a project. An empty title uses a display placeholder without storing that placeholder in authored content.

Autosave follows 800 ms without input; recovery retention follows 250 ms. Save now or ⌘S submits immediately. Composition defers save and transitions that would replace the input buffer.

| State                     | Meaning                                          | Available action                                                                 |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Unsaved changes           | Visible input has not been accepted              | Continue writing or save now.                                                    |
| Saving                    | The current request is in flight                 | Continue writing; newer generations remain separate.                             |
| Saved                     | The visible buffer is durably accepted           | Continue or navigate.                                                            |
| Not saved                 | Persistence or validation failed                 | Retry, copy input or remain in the editor.                                       |
| Checking save result      | The original request's result is unknown         | Check/replay the same request before starting another write.                     |
| Content changed elsewhere | The saved head advanced beyond this draft's base | Inspect current content and keep/copy the draft; do not overwrite automatically. |
| Recovery draft kept       | A draft receipt was confirmed                    | Resume or discard explicitly; accepted content is unchanged.                     |

An older save cannot mark newer input saved. Background reads never replace dirty input. Save and draft-retention failures remain visible near the editor; a toast is insufficient.

The body footer contains a closed Context details section for copying saved context. Keep save state, errors and Copy edits immediately available. Recorded locations appear separately at the end of the body, and in Details: show the exact locator and origin mode of the displayed revision as inert text, with a dedicated copy action. Neither display nor copy opens, executes, checks or synchronizes the target. Keyboard focus reveals the complete location-copy control within the body scrollport.

Before replacing an editor, finish composition, pause input and confirm either a saved version or a retained draft. Keep that guard through the pending read/create reply. A cancelled or failed opening retains the old editor. If save and draft retention both fail, offer retry, copy or explicit discard and keep the input available. Each transition and native close owns an independent lock; a late callback cannot release another lock.

## Projects, fields and relationships

Projects open with a labeled goal excerpt of at most 280 code points, continuation references, direct asset references and linked material. New projects start in writing mode. Edit project text uses the same object and protected editor.

Reference groups show 3 entries initially, then 10 and further pages of 10. Project material uses 20-item/32 KiB pages. Counts mean loaded items or recorded references. Append failure preserves earlier rows; a stale cursor restarts the query.

- **Fields:** stable keys identify text, number, boolean, date and select fields. Label changes preserve keys. Type changes explicitly clear values. Null, empty text, zero and false stay distinct.
- **Relationships:** membership targets a project; ordinary links follow current identity; sources pin a checked revision. Asset use and continuation may follow current identity or a checked pin. Changing a link does not edit its target or expand access.
- **Form application:** Use these fields/relationships places the complete validated map into the editor buffer. Normal saving follows. Unapplied form values are not a durable object draft; cancellation requires an explicit discard decision.
- **Record table:** display up to 50 loaded records using one selected record's field definitions. Show missing fields, different definitions, per-row errors and truncation. Keep horizontal scrolling within the named table region.
- **Reuse fields:** a new record can reuse definitions and stable keys with every value set to null. Do not copy the original title, body, sources or membership.

Details shows current saved head H and human-reviewed revision R separately from the editor base. Mark reviewed requires a clean, noncomposing, unlocked editor at H and submits that exact pin. Saving, applying, reading and proposal decisions never mark knowledge reviewed. Never reviewed is neutral; Changed since review describes the object's own newer revision, not automatic certification of its sources.

## Reading sources and editing originals

A source opens its cited revision read-only. View current version is separate. Edit current original obtains the same object's current revision through the guarded editor transition; saving produces a later revision under the same ID. The cited version remains intact.

Reuse an existing editor for that ID. Retained old-base input stays labeled as a draft; a newer saved head becomes a conflict rather than replacing the buffer. Archived or unavailable current material leaves the historical reader available with a specific error.

Return to reading restores the cited reader. Finishing the reading stack restores its project, document, review, table or Activity caller and trigger. Restore position only while its route, editor identity and generation remain current. Later navigation or writing supersedes an old return. Incoming links use bounded relationship expansion and show exact owner revisions, missing targets and reached limits.

## Preparing context and access

Copy saved context copies the displayed saved version's identity, digest, body, properties and relationships. An editor selection is explicitly labeled as selected body text. It does not recursively copy linked bodies. Disable copying for dirty, composing or locked input; Copy edits remains a separate rescue action.

Prepare context starts with only the displayed saved version selected. It retains an optional task of up to 1,000 Unicode code points and at most 20 distinct object/revision pins.

1. Keep the starting version's declared links separate from current active project material as queried. Resolve current targets to exact pins.
2. Add material from the space through an optional literal-text query, with object-kind and lifecycle filters. These results remain separate from declared links and project material. Page candidates in at most 20 items/32 KiB. Show More and loaded counts; do not label the result a complete historical project snapshot. Keep selected pins across filters and pages; deduplicate by object/revision, not by title.
3. On an ordinary page failure, retain successful rows, selected pins and the failed cursor so Retry repeats that page. A stale cursor or authority-sequence mismatch invalidates the old continuation and starts a fresh first page. Keep the old successful rows, marked stale, until that fresh page succeeds; then replace the result list atomically. Late responses from another filter, binding or query generation cannot replace current choices.
4. Verify every selected pin and digest before preview, copy or access setup. Unavailable selections must be retried or removed; never substitute the current head.
5. Show the exact `agentspace-brief/v1` preview. Its groups index only selected pins. A selected project's optional goal excerpt is at most 280 code points; removing that project removes its title and excerpt.
6. Invalidate preview and success/error feedback when the task, selection, binding or candidate chain changes. A copy failure retains choices and exposes retry.

Selection itself neither changes relationships nor grants access. Preparation is in-memory state for one binding, retained through Settings/Import visits. It is not a saved document, recovery draft or restart promise. It preserves the underlying editor and reading return path. Explicitly opening an import result follows that reader instead of reopening the old preparation.

Set up agent access carries selected object IDs to the form, including objects outside its first directory page. Preserve prior human choices or a known one-time configuration; Use selected material explicitly replaces a selection. The person checks scope and capabilities and chooses Create access.

Object grants cover readable retained and later versions. Brief pins do not restrict a grant to those versions. New links never expand a grant. Creation proposals require separately enabled creation capability on a space-scoped grant. Neither grant permits human acceptance.

Pending or unknown access operations freeze editable fields, new mutations and dismissal; Retry retains the original request. Configuration copy means launch information is prepared. The application does not write host settings or infer a live connection. Entry enabled and Last tool call describe only observed states.

## Proposal review

A proposal concerns one existing object or one new document/record. Display purpose, complete body/property/relationship differences, reason and exact sources before technical receipts. Use text/symbols as well as color for additions and removals. Missing evidence remains explicit.

| Action                               | Result and guard                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open                                 | Mark the proposal read; keep processing status unchanged.                                                                                         |
| Apply an existing-object proposal    | Recheck base, policy, grant and target input state; apply once against the original candidate. A dirty target must be resolved first.             |
| Create from a proposal               | Recheck creation permission, schema, references and reserved identity; create revision 1. Do not convert an identity collision into an overwrite. |
| Reject                               | Persist the outcome without changing the target or creating a proposed object.                                                                    |
| Edit current original                | Open current accepted content under human attribution; the original proposal stays unresolved.                                                    |
| Continue a creation as a human draft | Copy its content/values into a separate human object; leave the proposal unresolved.                                                              |
| Inspect a stale proposal             | Keep the original, current content and proposed difference available; offer copy, direct edit or rejection. No force apply or silent rebase.      |

Pending/conflicted and applied/rejected lists have independent bounded status cursors. Keep the selected proposal while refreshing or changing collections. A real decision retires older detail reads. Applied result links pin the accepted revision separately from the later current original. Rejected creation has no result object. Do not invent a human rejection reason.

Reading, proposal processing and knowledge review are independent. An uncertain decision retains its original request and visible state until resolved. Accepted explanations retain the original declaration and evidence; a human save has no fabricated agent declaration.

## Activity and history

Activity defaults to Actual changes; Prepared context is separate. Recorded action, actor and time remain distinct from current proposal status. An event about access, reading or rejection does not imply a changed body.

Authority and preparation records use independent descending windows of at most 50 sequence numbers before filtering. Refresh starts a new window. Keep successful pages on failure and retry the same boundary. Counts mean loaded records. Source reading temporarily closes the Activity dialog; return restores its tab, pages, scroll and trigger.

History opens immutable versions. Preview undo shows the complete object state to restore. Undo requires the current revision to remain the exact revision produced by the selected change, including at commit time. Matching text alone is insufficient. Undo creates another version; undoing creation archives the object while retaining identity/history. Later changes block undo and remain untouched.

When undo is blocked, allow reading/copying the older version or creating a separate note with a source reference. Editor Undo/Redo, historical undo and full-backup restore are distinct operations. External-location changes use explicit relinking rather than generic undo.

## Import, portability and lifecycle

- **Import:** choose files/folder and a profile; load all bounded preview pages; confirm actions and optional grouping before writing. Same source/version reuses the original object and preserves later human edits and relationships. Show each committed/reused/skipped/failed/blocked outcome. Pause, reset failures and resume are separate operations. Changed source authorization requires a fresh preview and confirmation.
- **Empty states:** import is reachable from Continue and a successful unfiltered empty Library result. Loading, failed/obsolete queries and empty recent work do not establish an empty space.
- **Backup/export:** use separate actions for full-history backup and readable current content. Show actual stages, counts and exclusions. Completion requires a verified artifact receipt. Unknown transfer replies retain their operation ID and handle.
- **Restore:** validate the chosen backup, create and verify a new space, then offer a separate Open restored space action. A failed open does not erase a successful restore. Opening uses the normal input guard.
- **Foreign drafts:** copy the original independently of retention, or explicitly retain a new local draft before Resume. The original remains intact and stale-base checks still apply.
- **Archive:** change one object's lifecycle at its checked revision. Archived content is read-only. Restoring reactivates its current content; related objects are unaffected.
- **Relink:** use a native location chooser, review old/new labels and confirm. Preserve asset identity/history; do not accept a raw renderer path.

Progress reports only observed stages. Do not invent percentages, completion or agent activity. Dialogs with unresolved mutation results cannot dismiss. Native close is cancelled while another dialog needs a decision. Transfers with known live handles may continue after their dialog closes; that view does not imply restart persistence.

## Keyboard, layout and language

- Expose New note (⌘N), Search (⌘K), Save (⌘S), Find (⌘F), Settings (⌘,) and editor Undo/Redo in the native menus. No global shortcut applies a proposal while typing.
- Preserve logical Tab order, visible complete focus paint and a reachable editor exit. Enter/Escape do not submit, navigate or dismiss during composition.
- Restore the caller's focus after source reading or a dialog. A later focus action supersedes an older callback. A focused pointer target must not move beneath the pointer.
- Reflow actions and prose at short/narrow windows and enlarged text. In compact mode, panels and material lists use explicit return controls. Confine table overflow to its named region. Fixed chrome must not cover the diff, caret or focused control.
- Use complete status messages without announcing each keystroke. Colors supplement labels. Respect reduced motion and avoid decorative movement of focused content.
- Locale changes affect UI copy only and preserve editor, selection and review state. Keep names, body text, field labels and original agent reasons in their authored language. Use complete translated messages and locale-aware date/count formatting.

See [Design system](design-system.md) for tokens and [Testing](TESTING.md) for the native verification scope.
