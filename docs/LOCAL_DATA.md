# Local data, import and recovery

AgentSpace keeps managed text, typed fields, relations, immutable revisions, proposals, receipts and drafts in local SQLite. Original files remain under their own authority. The renderer receives named business methods; native dialogs select filesystem locations. See [ARCHITECTURE.md](ARCHITECTURE.md), [CORE_API.md](CORE_API.md) and [TESTING.md](TESTING.md).

## Import existing material

Choose files or a folder, inspect the bounded preview, confirm grouping and selected actions, then inspect per-item results. Markdown (`.md`, `.markdown`) and plain text (`.txt`) must be valid UTF-8; accepted text preserves its original Unicode, BOM and line endings. Managed copies are editable independent objects. Other formats can be explicitly selected as external asset references; they are not converted or executed.

The optional `knowledge-project-repos/v1` profile recognizes a simple layout:

```text
knowledge/                 → independent text copies
projects/<project>/        → proposed project grouping
projects/<project>/HANDOFF.md → ordinary text copy, with confirmed membership
repos/<repository>/        → independent repository asset reference
```

This is a replaceable recognition profile, not a required space layout or workflow. `.git` markers also identify repository roots. Repositories are referenced without traversing or running their code. Automatic HANDOFF continuation links and relationship changes to reused objects are not inferred; people can edit those relations explicitly. Importing an automatically maintained knowledge folder never marks the material as reviewed knowledge.

Bounds are depth 12, 1,000 visited entries, 50 MiB of selected text inspected, a 1 MiB complete managed-object payload and a 1 MiB confirmed manifest. Symlinks, `.git`, common dependency/cache/build directories and nonregular files are skipped. Oversized, invalid-UTF-8, binary and unsupported files appear with explicit issues and reference/skip choices. A preview can be truncated; it does not imply the whole directory was examined. Roots are summarized by up to three labels plus a total; grouping metadata and entries are paged within complete-Result byte budgets.

Before confirming, Main rechecks the selected sources against the approved preview; it checks again while capturing each item. Changed text requires a fresh preview/approval. It neither silently imports newer bytes nor writes the source. Source paths are provenance/locators, never object identity or executable instructions.

## Persistent progress and retries

Format v2 adds `import_runs` and `import_items` to the same database. A run stores an immutable approved manifest, fixed object IDs, original human namespace, source identity/version, dependencies and stable per-attempt operation keys. Each item's accepted revision, FTS projection, authority change, receipt and success state commit in one Common Core transaction. Partial progress is explicit; the whole folder is not one atomic mutation.

Restart or retry resumes pending items under their original keys. A committed source-version claim is unique across runs: re-import returns the original immutable pin and leaves later human corrections, labels and archival untouched. Different source versions create separate copies; import never refreshes an edited note in place. Reused project/asset identities resolve dependencies of newly imported copies. Results retain relative paths as well as titles, so repeated README/HANDOFF filenames remain distinguishable.

Pause/resume/retry have durable operation receipts. `getImport` reports current progress separately from the original command result. A known source failure has an item outcome; an inability to write that outcome is returned as a real failure. Main may add `coordinatorError` to a progress page when its live driver stops without a durable item update. This field is an observation in the current app process, not retained progress or a content change.

A restored space or a different installation cannot automatically resume old source authorization. Resume opens a native source chooser and presents a new preview; confirmation creates a new immutable run with a `parentRunId`. Canceling leaves the old run/content unchanged. A changed source also requires this reapproval. There is no watcher, background synchronization or source overwrite.

The trusted `startImport`, `commitImportItem`, `getImportManifest` and path-bearing `relinkExternalAsset` methods are absent from preload and AgentServices. Only Main supplies verified source captures/locators. Agent tools still have their reviewed read/propose surface.

## Readable export and full backup

| Artifact        | Included                                                                                                                                                          | Excluded                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Readable export | Every current object, including archived objects; UTF-8 Markdown bodies; typed fields, relations, policy/origin metadata; UUID filenames and a hashed JSONL index | Old revision bodies, proposal/receipt/draft/knowledge-review history and external target bytes |
| SQLite backup   | A complete consistent snapshot, including revision/proposal/receipt/draft history, current indexes and import journal                                             | Referenced original files, code repositories and other external target bytes                   |

Export metadata preserves current/pinned refs. A historical pin may point to a revision outside this current-only export; the manifest states that historical pin bodies are absent. Export counts describe included content: revisions equal exported current objects and proposals/receipts/retained drafts are zero. A readable export is data interchange, not a restorable full-history database.

Both paths open the source read-only and use SQLite's online backup API. Watermarks and counts are read from the completed copy, not a live pre-copy guess. Backup is validated for format/schema, physical integrity, foreign keys, content digests, current search projection, relationships and retained journal/revision associations. Export writes and checks body/metadata hashes before publishing its complete manifest. Neither path requires inserting a source activity/receipt. The real 512 MiB SQLite-full test confirms that both remain available after a source write fails.

A private sibling work directory holds the temporary full snapshot; it never appears inside a readable export directory. Successful operations attempt to remove the private snapshot scratch; cleanup failure does not invalidate a published receipt. Incomplete operations retain operation-owned work for retry. A destination is reserved with an operation ID/request digest, and its receipt is written only after completion. An interrupted backup/export without its complete manifest is not a verified artifact. A restore publishes the space file only after its acquired data and transformed metadata are checked; an interruption before its destination receipt can leave a valid space with an unfinished operation. Retry refuses advanced heads rather than overwriting them. Same-operation retries reuse the consistent copy; a new operation cannot silently overwrite an occupied directory. Process exit between copying and publication is tested. These checks do not simulate a host power cut or physically full destination disk.

## Restore and retained drafts

Select a backup, review its included scope and restore to a new directory. The current space and backup are not overwritten. Restore binds the actual acquired private staging file to the confirmed backup SHA-256, byte size, complete snapshot identity and counts before changing any instance/grant metadata. This check applies to new copies and reused scratch; a changed external path or a healthy database with the same space/instance is insufficient. A rejected acquisition is removed from the operation-owned scratch so correcting the source permits the original operation to retry. Restore then assigns a fresh `instanceId` and cursor secret, revokes restored grants/token hashes, and revalidates its identity/counts before publishing `space.sqlite`. Space/object IDs, history, old receipt JSON and receipt namespaces are preserved byte for byte. Old agent configurations and cursors do not become valid in the restored instance; create an explicit new grant/configuration.

A completed destination receipt replays the original restoration result without overwriting later human edits. An unfinished destination whose heads or watermarks have advanced is refused rather than reconstructed over newer work. The restoration digest is captured while staging is still private. Closed backup files are acquired byte for byte, with bounded copying, then validated; applying the online backup API again could change physical headers across SQLite runtime versions. The online API remains the live-space backup/export mechanism.

Retained drafts are normally isolated by installation namespace. Human-only recovery discovery lists drafts belonging to other installations using signed references bound to this instance and source generation/digest. Read the old draft, then explicitly copy it to a fresh draft ID in the current namespace. The original draft and receipts remain unchanged. A copy receipt states its original draft/generation/digest; it is not an accepted save. A changed recovery reference fails rather than copying unseen newer input.

## Lifecycle and external relocation

Human queries default to active objects and may explicitly include archived/all material. Agent query input remains unchanged. Archive and restore are CAS-protected new revisions; they do not delete identities, linked assets or history. A later revision protects against an old lifecycle request or undo.

External-asset relinking uses a native chooser, shows the old/new location for confirmation and preserves the object ID/history. It does not move or open either target. A same-key retry uses the frozen original request even if the target later disappears. Generic undo returns `UNDO_NOT_SUPPORTED` for origin-only relinks; choose the previous location explicitly to make another recorded revision. There is no physical object deletion or garbage collection.

## Format and operating limits

The first public 0.1.0 uses persistent format/core contract **2**. Format 1 was an unreleased development format; it is refused with `SCHEMA_UNSUPPORTED` without migration or an upgrade UI. Unknown/newer formats are also refused. This small format change adds transactional import coordination rather than a second sidecar content authority. Future released-format compatibility will require a separately reviewed migration and backup design.

Spaces use a 512 MiB database page ceiling, including retained history/receipts. A write at capacity returns `LIMIT_EXCEEDED`; backup/export may need additional destination disk space. Local disk is required; network filesystems, arbitrary external SQLite writers, same-user process isolation, external-file CAS, large-library performance, signing and non-macOS packaging are not established by these tests. One artifact copy runs at a time in Main. Opaque UI handles live only for the current app process; persisted content/import runs and destination receipts survive separately.

## Verification

```sh
npm run test:local
npm run test:core
npm run typecheck:desktop
npm run build:agent
```

Local tests use real temporary files, actual SQLite, independently spawned compiled Core writers and process exit. Desktop coordinator tests inject native chooser results while exercising the real Workspace/Core/filesystem; they do not establish OS dialog or renderer interaction acceptance. The coordinator runs actual Electron checks separately. No GUI or desktop build is part of `test:local`.
