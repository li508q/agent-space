# Using AgentSpace

[English](en.md) · [简体中文](zh-CN.md) · [日本語](ja.md) · [한국어](ko.md) · [Español](es.md)

AgentSpace keeps your writing, project material and agent proposals in a local space. You can read, edit, organize and recover work without a model account.

## Install the app

AgentSpace requires **Apple Silicon and macOS 13 or later**. Download the macOS arm64 ZIP and `SHA256SUMS` from [GitHub Releases](https://github.com/li508q/agent-space/releases/latest). Keep both files in the same folder and verify the ZIP before extracting it:

```sh
shasum -a 256 -c SHA256SUMS
```

The app includes its runtime; direct use needs neither a Node installation nor a model account. Downloads use ad-hoc signing, without a Developer ID signature or Apple notarization. If macOS blocks the app, check its source and checksum, then follow [Apple's instructions for Open Anyway](https://support.apple.com/en-us/102445). AgentSpace does not change macOS security settings.

## Open or create a space

Choose **Create space** for a new local folder, **Open space** for an existing AgentSpace folder, or **Open example space** to try synthetic material stored separately from your work. The header identifies the selected space.

The app and your space are separate: moving the app does not move the data. Put the app in its final location and open it there before creating agent access. If you move it later, update the executable path in your agent application's MCP configuration and reconnect.

Choose the interface language and text size in **Settings**. Changing language keeps authored titles, text and field labels as written.

## Return to work or find material

**Continue working** offers recovery drafts, up to ten recent items in this space instance and **View recent changes**. The list points to the same material rather than keeping document copies. Removing an unavailable item from this list does not delete material. Temporary errors offer retry; a restored instance has its own recent list.

Use **Library** to browse, search and filter saved material, or choose **New material**. A space can contain material even when it has no recent work. Loaded counts and paged results describe the checked scope; use the more-results controls to continue.

## Import existing material

Open **Import existing material** from Continue, the space menu or an empty Library view without filters.

1. Choose files or a folder.
2. Inspect the preview: text copies, source locations, proposed project groups, external references, skipped items and scan limits.
3. Confirm your choices, then inspect each item's result.

Valid UTF-8 Markdown and plain text become editable managed copies with origin information. Original files remain unchanged. Repositories and other native formats can be explicit external references; their contents are not copied, run or synchronized. The optional **Knowledge, projects and repositories** profile suggests project groups and repository references.

A limited preview covers only the reported scan. If a source changes after preview, inspect and confirm it again. Import commits items separately, so successful items survive a partial failure. Retrying or importing the same source version reuses its original object and preserves later human edits and existing relationships. New grouping applies to new copies; edit a reused object's relationships explicitly. A different source version creates a separate copy.

There is no background file synchronization. Resume an interrupted import explicitly after restart. Restoring a space requires choosing and confirming old import sources again.

## Write and save

Create an independent note, project, record or reusable asset through **New material**. A note can remain outside any project. Use **Details** to edit fields and relationships; one note or asset can be referenced by several projects without duplicating it.

Human edits save directly after a short pause; **Save now** is also available. Read the state beside the editor:

- **Saved** confirms that the displayed edits are saved as current content.
- **Recovery draft kept** confirms a retained draft, separately from a successful content save.
- **Not saved** or **Checking save result…** requires attention. Keep the editor open and use the offered retry to resolve the original request.

On a conflict, your edits and the newer saved version remain separate. Inspect the current original before deciding how to continue. If a draft cannot be retained, **Copy edits** copies the body text so you can preserve it before closing. Resume retained drafts from Continue; resuming a draft does not by itself accept its content.

Records support text, finite numbers, booleans, calendar dates and choices. Unset (`null`), empty text, `0` and `false` are distinct. Renaming a field keeps its identity; changing its type clears its value. Reusing field definitions creates a new record with unset values, without copying text or links. The record table is a bounded view of the same records, with columns taken from a selected reference record.

## Read project material and sources

A project opens with its goal excerpt, continuation references, direct asset references and paged material. Choose **Edit project text**, or **Edit project goal** when empty, to write its full text. Counts describe loaded material or recorded references. You can use fields and continuation links without adopting a fixed routine.

Relationships can **Follow current** content or point to a **Pinned version**. A source citation keeps the exact saved version even after its original is edited. A historical project's links and today's project material are separate views, rather than a complete snapshot of past membership.

In the source reader, **Edit current original** opens the current managed object. For example, reading version 1 while editing current version 2 produces version 3 on the same object; version 1 and its citations remain intact. Existing unsaved edits stay in their editor with their original base and any conflict visible. **Return to reading** returns to the cited version and calling position. An archived or unavailable current original does not remove readable retained history. This action edits the managed copy, not an external source file.

At the end of the document or source reader, expand **Context details**, which is initially collapsed. **Copy saved context** copies this item's saved title, body, fields, links, version details and space information. Selecting part of the body in the editor includes that text instead of the full body. Linked document bodies are not included. For a task brief with several version references, use context preparation below.

Imported copies and external references show **Recorded location** after the body and in Details. This is the location recorded in the version you are reading, including a historical version. **Copy location** copies that text; it does not open or run anything, confirm that the original exists, or synchronize it. Imported copies remain separate from their originals. If no location was recorded, copying is unavailable. Material without an external origin has no location section.

## Prepare context for an agent

From a saved document or the source reader, choose **Prepare context**.

1. Optionally describe the task in up to 1,000 Unicode code points.
2. Select up to **20 unique saved-version references** across all groups. Only the starting item is selected initially. Its direct links and, for a project, current active material appear in separate groups. Load more within a group as needed.
3. Expand **Add material from the space** to combine other projects, areas of your work and independent material. Search by literal text and filter by type and active, archived or all material. Results show current saved versions; selecting a result fixes that exact version. Changing the query or refreshing does not replace selected versions. **Selected from earlier results** keeps choices that are outside the original groups visible for removal, even when search is collapsed.
4. Open **Inspect brief and references**. AgentSpace checks every selected saved version again before previewing, copying or opening access setup. Inspect the visible text, then **Copy brief and references**.

Search pages and loaded counts describe the current query, not the whole space. Use more results or **Refresh results** as needed. If a refresh or next page fails, successfully loaded rows and your selections remain; retry before treating those results as current. Direct links, current project material and space search remain distinct sources of candidates. They do not reconstruct a complete historical project snapshot.

The brief contains the task and fixed references, plus up to 280 characters of the starting project's goal when that project is selected. Deselecting it removes its title and excerpt. Linked document bodies are not recursively included. An unavailable selection needs retry or removal; it is never replaced with a newer version.

Selecting material does not create relationships or grant access. **Set up agent access** opens a separate form; only **Create access** issues the grant. Copy success means the text reached the clipboard, not that an agent received it. Preparation stays in memory while this space is open, including visits to Settings or Import; it is not a saved document or a draft recoverable after restart.

## Connect an agent with explicit access

Choose **Set up agent access** from context preparation or open it in **Settings**.

1. Label the access and choose selected objects or the whole space. Select reading and proposal capabilities.
2. Inspect the choices, including prepared items beyond the first page. Existing form choices are kept; **Use selected material** explicitly replaces them.
3. Choose **Create access**, copy the Codex configuration or stdio launch JSON, add it to your agent application's MCP settings and reconnect. Then give the agent the brief. The [protocol guide](../AGENT_PROTOCOL.md) also documents CLI use.

The brief fixes particular versions; an object grant covers the object's readable versions, **including future versions**. New links and project membership do not add objects to a fixed selection. Proposing new notes or records needs separate creation permission on a whole-space grant with read and proposal capabilities. Object-specific grants cannot create new objects. Agent access does not include your direct-save or proposal-acceptance authority.

The configuration contains a token shown once; AgentSpace stores its hash. Copy it while available. If it is lost, revoke that access and create another. An uncertain access operation keeps the form locked until the original retry resolves it. Ordinary Settings round trips in the same open space retain a known one-time configuration.

An agent can discover the space, filter and search within its grant, follow bounded relationships and read exact versions. Search reports limits and does not guarantee semantic completeness. Prepared context records the references and ranges assembled for tool results; it does not prove host receipt, model understanding or task completion.

In **Details → Agent proposal permissions**, choose which parts an agent may propose changing, then select **Save proposal permissions**. Editing content keeps the existing permissions. Every proposal still requires your review before it can be applied.

## Review proposals and inspect changes

Open **Review → Pending** to inspect a proposal.

1. Read its purpose, reason, target, base version and full differences. Open sources at their cited versions; returning keeps your proposal selection and reading position.
2. For an update, choose **Apply proposal**. For a new object, choose **Create note** or **Create record**. **Reject proposal** leaves accepted content unchanged.
3. Use **Draft for new material** on a creation proposal to start your own draft of the same type. For an update, edit the current object. The original proposal remains separate.

Reading a proposal does not resolve it. Read/unread, pending/applied/rejected/conflicted and human knowledge review are separate states. If the current saved version no longer matches the proposal's base version, applying is blocked; the proposal and current content are preserved. Use **Copy proposed content** and edit the current object, or ask the agent for a new proposal. You can reject an old candidate after revoking its originating access.

Use **Review → Processed** to inspect applied or rejected proposals. **Read accepted version** opens the saved result at acceptance; a separate action opens the current original. Rejected proposals retain their reason, differences and sources.

**Activity → Actual changes** shows saved edits and proposal decisions, with time, actor and links to the event's version or original proposal. Accepted explanations and source references remain traceable by another authorized agent without the original chat. Access to a result does not automatically authorize its sources.

In **History**, use **Preview undo** before undoing a change. Guarded undo refuses to overwrite later edits. You can inspect an old version or create a new note from it instead.

## Mark knowledge you have reviewed

In **Details → Version review**, compare the current saved version with the last version reviewed by a person. After checking the saved current version, choose **Mark as reviewed**. Unsaved edits remain separate.

Find material through Library's **Review status** filter: **Never reviewed**, **Current version reviewed** or **Changed since review**. Never reviewed is neutral. Importing, saving, reading or applying a proposal does not mark knowledge reviewed. A review mark records a person's review of that version; it does not certify truth or maintain knowledge automatically.

## Archive material or reconnect an external asset

Use **Details → Archive material** to remove an item from active views while keeping its identity and history. **Restore from archive** reactivates it. Archiving a project does not archive or delete its notes and shared assets.

If an external asset moves, use **Choose asset location** and confirm the old and new locations. The asset keeps its identity and history; relinking does not move the external file. Generic undo does not reverse a location change. To return to the old location, choose it explicitly.

## Back up, export and restore

Open **Back up, export and restore** from the space menu.

| Choose          | Use it for                             | Included                                                                                            |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Full backup     | Restoring a space with its history     | Consistent database, retained versions, proposals, operation history, drafts and import progress    |
| Readable export | Reading current content in other tools | Current accepted content, including archived items, typed fields, relationships and origin metadata |

A readable export excludes historical bodies, proposals and recovery drafts; it is not a full-history restore source. A historical citation may refer to a body outside the export. Neither option copies external files or repositories. Both may contain origin paths and other personal metadata.

Wait for **Completed and checked**. A lost response means an unknown result: check the original operation or retry it. If a completed restore cannot be opened, retry opening separately; that does not cancel the verified restore.

Restore a backup into a **new destination**. It receives a new instance identity and old agent grants are disabled in that copy. The original space and its access remain unchanged; reconnect agents explicitly. Recovery can find drafts from another installation and copy a selected draft into a new local draft while preserving the original.

## Privacy, limits and further help

AgentSpace does not encrypt local data. Protect the space and its copies with operating-system controls. A connected agent can receive authorized content, which its host may send to a model provider under the host's settings. Local storage does not prevent that transfer. Revocation stops future tool access and cannot recall material already shared.

A managed object is limited to 1 MiB; the space database, including history, to 512 MiB. Import bounds include depth 12, 1,000 visited entries and 50 MiB of selected text. Context tools have explicit result and byte limits. A full space can still be backed up or exported to a writable destination.

See [product scope](../PRD.md), [local data and recovery](../LOCAL_DATA.md) and [trust boundaries](../SECURITY.md). The current desktop target is macOS Apple Silicon; [desktop setup](../DESKTOP.md) and [verification](../TESTING.md) explain signing, platform and input-method verification limits.
