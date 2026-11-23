# Using AgentSpace

[English](en.md) · [简体中文](zh-CN.md) · [日本語](ja.md) · [한국어](ko.md) · [Español](es.md)

AgentSpace is a local place for your work and the agents helping with it. You can write, organize and recover material without a model account. An external agent can use the same space through explicit access and reviewable proposals.

## Open a space

Create a space in a new local folder, or open an existing AgentSpace folder. The selected space stays visible in the header. The example space is separate and visibly labeled; its material is synthetic.

The application and a space are separate. Moving the application does not move your data. Generate agent configuration after putting the application in its intended location; regenerate it if the executable later moves.

This first delivery is verified on macOS Apple Silicon. The local build is ad-hoc signed, without Developer ID or notarization. Other operating systems are not claimed as verified releases. Source development uses the exact supported Node versions from the repository.

## Write and connect material

Create an independent note whenever you need one. Projects group work through relationships; a note can belong to several projects while retaining one identity. A reusable asset can be referenced by different projects.

Human edits save after a short quiet interval. **Save now** is also available. **Saved** means the visible generation was persisted. A retained recovery draft is a separate state. If saving conflicts or fails, use the available retry, draft or copy path; a later human revision is never silently replaced.

A project opens with an overview: an excerpt of its text, continuation references, direct asset references and a paginated material list. Section buttons stay outside the full text. Choose **Edit project text** to write; an empty project offers **Edit project goal**. Counts name loaded items or recorded references, not space-wide totals. Typed fields and continuation links do not impose a fixed routine.

From a source reader, **Edit current original** opens the current internal object through the normal save/draft protection. Reading K1 and editing current K2 saves K3 on the same ID; K1 and its citations remain fixed. Existing unsaved edits for that object stay in their editor with their original base and any conflict visible. **Return to reading** restores the cited version and calling position. An archived or missing current object leaves the readable history intact. This edits the managed object, not an external original file.

Records use text, finite numbers, booleans, calendar dates and select values. A label can use any language; renaming it preserves its stable field key. Unset, empty text, zero and false remain distinct. Reusing a record's field definitions creates a new row with cleared values. The table shows a bounded view of those same records; it is not a global spreadsheet schema.

Relationships distinguish current objects from pinned evidence. A source link preserves the cited revision even when its object is edited later. A human knowledge-review mark applies to a particular revision; saving or accepting an edit does not certify it as true.

## Bring existing folders in

Choose files or a folder through the application. Preview the proposed copies, project groups and external references before confirming. The knowledge/project/HANDOFF/repository profile is a convenience for an existing folder layout, not a required way to store every space.

Supported UTF-8 Markdown and plain text become managed copies with origin information. Original bytes remain unchanged. Repositories and unsupported native formats can be explicit external references; their contents are not copied or synchronized. Imported knowledge is not automatically marked reviewed.

Inspect traversal limits and skipped items. The first release bounds depth, visited entries, selected source bytes and object size. A limited preview does not mean the rest was scanned. Source changes after preview require renewed review. Import results are per item: successful work survives a partial failure, and retry recovers committed items without replacing later human edits.

Grouping choices apply to newly created copies. A previously imported source version reuses its original object and keeps its existing relationships; this import does not regroup that object. Open it to change relationships explicitly.

There is no background two-way file synchronization. After a restart, resume explicitly. A restored run needs renewed source authorization rather than silently reopening old paths.

## Give an agent context

Open **Settings → Agent access** and create a labeled grant. Choose the whole space or selected objects, reading and proposal capabilities, and whether a whole-space client with read and proposal access may propose new notes or records. Object-specific grants cannot create new objects. Links do not extend access to another object.

Copy the generated launch configuration into your MCP host, or use the documented CLI. It points to the actual executable, space, instance and grant. The token is issued once; only its hash is retained by AgentSpace. If it is unavailable, revoke that grant and issue another. Configuration contains a credential, so share it deliberately.

An agent starts with small discovery and model-description calls. It can combine structured filtering, literal search, bounded links and exact-version reads for the current task. A monthly retrospective is one possible task, not a built-in workflow. Search reports limits and does not promise semantic completeness.

You can inspect and copy a selected saved version with its references. Treat unsaved text as a draft. **Activity → Actual changes** shows persisted events with their time and actor, including human saves and proposal decisions. Open the version at that event or the original proposal; creating or rejecting a proposal does not apply its content. **Prepared context** separately shows the exact references and ranges prepared for tool results, without proving host receipt, understanding or external completion. In **Review**, switch between **Pending** and **Processed**; each status has its own loaded records, more and retry controls. Applied proposals retain their original diff, reason and source pins after restart. **Read accepted version** opens the fixed result; opening the current original is a separate action. Rejected proposals retain the original suggestion without inventing a rejection reason or a new object. Returning from a source preserves the proposal selection and reading position.

## Review and continue work

A proposal shows what the agent wants to change, why, the expected base version and declared sources. Current content remains unchanged until you apply it. Read the diff, open a source at the cited version, then return to the review.

Accept, reject or continue with your own draft. If the base changed, both the proposal and current human version remain intact. Revoking the originating grant does not prevent a person from rejecting its old candidate. Guarded undo refuses to overwrite later work; an older version can also be inspected or copied into a new note.

Accepted explanations and source pins remain available through history and context tools. Another authorized agent can trace them without the first agent's private chat or operation key. Permission to read a changed object does not automatically grant permission to its evidence.

## Keep data recoverable

Archive material when it should leave the active view. Archiving a project does not erase its notes or shared assets. Restoring reactivates its current retained content. If an external asset moves, relink it explicitly and inspect the old and new location; the asset retains its identity and history. Generic undo does not revert an external-location relink; explicitly relink to the previous location if needed.

A full backup preserves the consistent space database, retained versions, proposals, receipts and drafts. A readable export contains current accepted content and typed metadata, including declared references; it does not include historical bodies, proposals or recovery drafts. Neither copies external repositories or original files. Exports and backups can include origin paths and other personal metadata.

Restore a backup into a new destination. The restored copy has a new instance and old agent access is disabled there. Original data and its access are not changed. Reconnect agents explicitly. Drafts from another installation are discoverable and can be copied into a new recoverable draft without moving or rewriting the original.

Wait for the verified completion result before calling an artifact complete. A lost response is an unknown result; inspect its operation or transfer status. A filesystem error opening a completed restore does not mean the restored data disappeared.

## Current boundaries

The release limits a managed object to 1 MiB and a space database, including history and receipts, to 512 MiB. Import defaults include depth 12, 1,000 visited entries and 50 MiB of managed source bytes. Context tools use explicit byte and result limits. A full database can still be exported or backed up to a writable destination.

Data is not encrypted by AgentSpace. Protect local files and copies using the operating system. An external agent's provider and permissions outside these tools are controlled by its host. Cloud sync, team accounts, semantic truth checking, arbitrary app execution and a full spreadsheet engine are outside this release.

See [data boundaries](../SECURITY.md), [agent protocol](../AGENT_PROTOCOL.md) and [verification evidence](../TESTING.md). Unsupported development formats are rejected without modifying their files; compatibility begins with this release's documented format.
