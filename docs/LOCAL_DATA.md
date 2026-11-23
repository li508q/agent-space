# Local data operations

Managed content, properties, relations, immutable revisions, proposals, receipts and recovery drafts live in local SQLite. External originals retain their own authority. Native dialogs select locations; the renderer receives named operations and opaque handles.

## Import

1. Select files or a folder and an import profile.
2. Load the bounded preview and inspect supported files, exclusions, actions and optional project grouping.
3. Confirm the plan before writing.
4. Inspect each committed, reused, skipped, failed or blocked result; retry only unfinished items.

Markdown (`.md`, `.markdown`) and plain text (`.txt`) must be valid UTF-8. Accepted text preserves Unicode, BOM and line endings. Copies are editable objects. Other formats require explicit external-reference selection; they are not converted or executed.

`plain-files/v1` keeps material independent. The optional `knowledge-project-repos/v1` profile recognizes knowledge files, project/HANDOFF folders and repository roots. It is an import interpretation, not the required space layout. Repositories are referenced without traversing or running code. Continuation links and changes to reused objects require explicit relationship edits.

| Limit                   | Value  |
| ----------------------- | ------ |
| Directory depth         | 12     |
| Visited entries         | 1,000  |
| Selected text inspected | 50 MiB |
| Complete managed object | 1 MiB  |
| Confirmed manifest      | 1 MiB  |

Symlinks, `.git`, dependency/cache/build directories and nonregular files are skipped. Oversized, binary, unsupported or invalid-UTF-8 items report an issue. A truncated preview is not a full-directory inventory. Native preview pages expose bounded entries and grouping metadata.

Main verifies source identity/version against the approved preview and again during capture. Changed text requires a fresh preview and approval. Source paths are provenance, not object identity or executable instructions. Import never writes or synchronizes originals, nor marks knowledge reviewed.

### Progress and retry

The approved immutable manifest, fixed IDs, dependencies, original namespace and attempt keys are retained in `import_runs`/`import_items`. An item's accepted revision, search projection, authority event, receipt and success state commit in one transaction. A folder is not one atomic mutation.

Same-source-version import reuses the original immutable pin and preserves later human titles, content, relationships and archival. A changed source version becomes another copy, not an in-place refresh. Grouping applies to new copies; reused objects retain existing relationships. Do not merge by title.

Pause, retry and resume have durable receipts. Read current progress separately from the original command outcome. `coordinatorError` describes a live Main failure when item progress could not be persisted; it is not a retained success/failure state.

A restored space or another installation requires fresh native source selection and approval. Reauthorization creates another immutable run with `parentRunId`; cancellation leaves the original run/content unchanged. Raw verified-capture methods are trusted APIs and are not exposed through preload or agent tools.

## Export and backup

| Artifact        | Included                                                                                                                                                       | Excluded                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Readable export | Every current object, including archived objects; Markdown bodies, typed properties, relations, policy/origin metadata, UUID filenames and hashed JSONL index. | Historical bodies, proposal/receipt/draft/review history and external target bytes. |
| SQLite backup   | Consistent complete managed database, including history, receipts, drafts, proposals, indexes and import journal.                                              | External originals, repositories and other referenced bytes.                        |

Readable export is interchange, not a restorable full-history backup. Historical pins in its manifest may reference bodies outside the export. Export counts represent included content, not the source's full history.

Both operations open the source read-only and use SQLite's online backup API. Counts and watermarks come from the completed snapshot. Backup validation checks format/schema, physical integrity, foreign keys, content digests, search and retained associations. Export checks body/metadata hashes before publishing its complete manifest.

Destinations are reserved by operation ID/request digest. Completion requires a checked artifact receipt; an unfinished directory or absent manifest is not success. Retain the same operation/handle after an unknown reply. Retry uses the acquired snapshot, not a newly observed source. Another operation cannot overwrite an occupied directory.

Private sibling scratch holds temporary full snapshots outside readable export output. Completed operations attempt scratch cleanup; a cleanup failure does not revoke a valid published receipt. Incomplete operations retain owned work for retry.

## Restore

1. Select a backup and review its scope.
2. Choose a new destination. Do not overwrite the current space or backup.
3. Acquire the selected bytes and verify the confirmed SHA-256, size, identity and counts before transforming metadata.
4. Assign a new `instanceId` and cursor secret; disable copied grants/token hashes.
5. Validate and publish the space, then explicitly open it through the normal editor/space guard.

Space/object IDs, retained revisions and old receipt bytes/namespaces are preserved. Old configurations and cursors do not become valid in the new instance. Issue new access explicitly.

A completed destination receipt replays its original result without overwriting later edits. An interrupted publication can leave a valid space without a completed destination receipt; retry checks exact heads/watermarks and refuses to reconstruct over advanced work. The restoration digest is captured before staging becomes public. Reused scratch must match the exact acquired backup pin, not merely its path or space/instance identity. A rejected acquisition removes only operation-owned scratch so corrected input can retry.

Closed backup files are acquired byte-for-byte before validation. Reapplying the online backup API could alter physical headers across SQLite runtimes; that API is used for live-source backup/export instead.

## Recovery drafts

Drafts normally belong to one installation namespace. Foreign-draft discovery returns signed references bound to the current instance and original generation/digest. Read the original, then copy its text or explicitly retain a fresh local draft before resuming. The original draft and receipts remain unchanged. Changed recovery references fail instead of copying unseen newer input.

A retained-draft receipt is not an accepted content save. If draft persistence fails, copying original text remains a separate rescue operation. Never claim a draft was retained without its receipt.

## Archive and relink

Human queries default to active objects and may include archived/all. Archive and restore are checked new revisions, not deletion. Linked assets and history remain independent. Agent query lifecycle remains active-only.

External assets use a native chooser and old/new confirmation. Relink preserves object identity/history and does not move or open targets. Same-key replay retains the original selected request. Origin-only relink has no generic undo (`UNDO_NOT_SUPPORTED`); explicitly choose another location. There is no physical deletion or automatic garbage collection.

## Operating requirements

Persistent/Core/local format 2 is required. Unsupported formats return `SCHEMA_UNSUPPORTED` without migration. The database page ceiling is 512 MiB, including history and receipts. A full source returns `LIMIT_EXCEEDED` for writes; read-only-source backup/export remains available and needs destination capacity.

Use local disk. Main serializes artifact copies; opaque UI handles live only in that application process, while content, import runs and destination receipts persist separately. Network filesystems, arbitrary external writers and external-file synchronization are outside the contract.

See [Core API](CORE_API.md) for trusted services, [Security](SECURITY.md) for protection and [Testing](TESTING.md) for commands and physical-device limits.
