# Test strategy and evidence

Status: 3A/3B product-core checks executed, 2026-11-23. Native UI, actual product MCP/CLI and complete PRD acceptance remain pending. Tests trace to the reported/stated scenarios SC-01–SC-09 and targets AS-01–AS-15 in [PRD.md](PRD.md). Races and response loss are engineering risk cases, not invented interview events.

## Current commands and evidence

```sh
npm ci
npm run check
npm run test:core
npm run build:core
npm run format:check
```

`check` runs strict TypeScript, ESLint with zero allowed warnings, a real ESM/declaration core build, six boundary-schema tests and twelve product-core integration groups. The core subset is in `tests/core/`; the concurrency worker imports `dist/core/index.js` in independently spawned Node processes. Tests use private temporary file-backed spaces and synthetic material. No browser, protocol mock or phase 2 probe substitutes for these core checks. Node 22 emits its documented experimental SQLite warning; that is distinct from lint warnings.

| Actual core check              | Observed result                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation/reopen/direct writing | Missing open does not create a database; a nonempty create destination is preserved; private creation permissions, space/instance/example identity, empty titles and saved content survive reopen. Valid no-op saves retain revision/sequence. Replayed keys recover the original fixed result and generation; changed requests fail. UUID case cannot bypass identity collisions.                          |
| Versions and typed material    | Old bodies remain readable; paged history points to real revisions. Authored multilingual field labels, null/zero/empty/boolean/date values stay typed. Date equality includes date fields. Current project links resolve renamed metadata; pinned evidence still resolves the cited old source. Invalid target kinds and agent definition changes fail.                                                    |
| Grants/new-object proposals    | Only token hashes persist. Same-key grant recovery returns the same summary without reissuing the token. Scope/propose/independent creation/kind permissions and live revocation are enforced. Pending creation IDs are reserved, absent from current objects/search and never reused after rejection. Acceptance creates revision 1 once.                                                                  |
| Review and original results    | Payload/status mismatches fail. A new human head makes an old candidate conflict without overwriting it. Rejection works after later edits and grant revocation. Original conflict receipt/replay remains conflict after another key rejects the proposal, without adding another change. The current proposal status is separate. Candidate payload/revisions reject direct update attempts.               |
| Conditional recovery           | Normal undo creates a new inverse revision. A→B→A and later policy edits prevent old undo. Creation undo archives a new revision while retaining identity/history; the archive can be conditionally undone. Human knowledge review remains a distinct pinned record.                                                                                                                                        |
| Drafts/activity                | Recovery drafts keep source/base/generation independently of accepted heads, survive another head/reopen, reject stale generations and cannot be resurrected by a late save after discard. Agent reads create independently polled prepared records with exact pins/ranges; authority sequence stays unchanged. Human polling/seen/draft saves do not manufacture agent work or invalidate content cursors. |
| Bounded reads/query            | Mixed CJK/emoji/decomposed accents reconstruct from fixed-revision code-point pages after a later head save. Actual UTF-8 JSON Result bytes match `returnedBytes` and the requested budget. Scope/grant changes invalidate continuation; tampering fails. Short-query fallback, literal text/typed filters, null-versus-missing and scope redaction work without changing source text.                      |
| Format/input/capacity          | Unsupported/newer format is refused by an open client and by reopen without migration. Invalid header is preserved. Undefined, BigInt, cyclic/accessor/non-JSON/malformed Unicode input is rejected before serialization; excessive depth has a limit result. Induced real SQLite capacity failure returns `LIMIT_EXCEEDED` and leaves no accepted revision/head/change.                                    |
| Real process failure/races     | Two compiled-core processes race on one file: one old-base write succeeds, one is stale. Same-key requests, including different JSON key order, recover one identical result. SIGKILL immediately before COMMIT leaves no accepted head/change/receipt/search text; exit after COMMIT without returning the API result is recovered by another process under the original key.                              |

These observations establish only the checked core boundary. Suppressing a direct review result tests the public recovery contract; it is not a network/protocol-delivery test. The separate process test actually terminates a writer. SQLite page-cap failure is not a host disk-full or power-cut experiment. Large-library latency, retention growth and arbitrary external database writers are unverified.

The coordinator independently repeated the complete 18-group check and format check. A separate `npx tsx --test tests/ui/i18n.test.ts` passes ten localization-foundation checks: exact five-language key/placeholder parity, strict lookup, authored-text preservation, counts, date/instant distinctions and clock-range validation, stable error coverage and initial language choice. This is not native layout, IME or full translated-product acceptance.

## Earlier runtime feasibility

Phase 2 separately ran actual macOS arm64 Node 22.22.3 / SQLite 3.51.3 and Electron 45.4.1 / bundled Node 24.22.3 / SQLite 3.54.1 probes. Both supported the selected `DatabaseSync`, WAL/FULL/foreign-key settings, FTS5 and online backup; backed-up rows/integrity matched on reopen. Ten five-language search fixtures per runtime demonstrated the short-trigram limitation and literal fallback with unchanged originals.

An official split SDK 2.4.0 stdio client/server probe exercised legacy and pinned `2026-07-28` modern openings, nested Unicode and strict unknown-field rejection. It exposed a labeled probe tool, not a product space or proposal. These earlier ignored probe artifacts are not product-core, native UI, packaging or real-host acceptance evidence. This stage's production core was tested on system Node; native Electron integration remains the next assignment.

## Acceptance mapping

| PRD ID | Current evidence                                                                  | Still required                                                                              |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AS-01  | Real core create/open/example/persist/reopen without provider credentials         | Native direct-use flow                                                                      |
| AS-02  | No import pipeline implemented                                                    | Folder preview/grouping, originals, retry/results and native references in phase 4          |
| AS-03  | Direct save/no-op/generation, durable draft/base recovery and failure guards      | Actual editor/IME, navigation/close, async response relevance and 800ms autosave            |
| AS-04  | Stable identity, current/pinned relations, independent object kinds               | Project organization/continuation/accumulation UI                                           |
| AS-05  | Real typed labels/values and equality, including dates                            | Record editor/view and export/restore round-trip                                            |
| AS-06  | Budgeted fixed reads, scoped literal/typed query, signed cursor/sequence behavior | Protocol invocation, description/expansion and accepted-evidence continuation               |
| AS-07  | Restricted live-authorized AgentServices; SDK transport feasibility only          | Actual built product MCP/CLI and native review of the same proposal                         |
| AS-08  | Core creation/update/review/CAS/receipt/hash/status/conflict tests                | Readable diff/source/status experience in Electron                                          |
| AS-09  | Durable authority/proposal/receipt/prepared activity and independent polling      | Real adapter calls and truthful native activity presentation                                |
| AS-10  | Conditional undo/ABA/policy protection, archive/history foundation                | Native readable old-version/new-draft recovery path                                         |
| AS-11  | Earlier engine backup feasibility only                                            | Consistent product backup, independent restore validation and readable export               |
| AS-12  | Core strict inputs, grant/scope and private creation permissions                  | Native renderer/preload/sender/CSP/Markdown/link enforcement and real tool surface          |
| AS-13  | Five-language dictionary/error/date/count foundation; authored text preserved     | Five-language native flows, focus, composition and layout                                   |
| AS-14  | Reproducible core build and independent compiled worker                           | Desktop build, moved packaged macOS app and bundled-runtime agent entry                     |
| AS-15  | Technical/API/test material reflects the implemented subset                       | Five-language publication, real screenshots/license/contribution/CI and remote verification |

No complete native/product AS row is claimed passed by this core milestone.

## Next blocking checks

The next assignment must connect the exact [Core API](CORE_API.md), not invent a separate mutation path. Exercise an actual SDK client and Electron app: receive/review/apply a real create/update proposal, refresh clean material from another process, preserve a dirty/composing buffer, read a cited version and return to review, reject conflicts, conditionally recover, then close/reopen. Verify sandbox/isolation/no Node in renderer, sender and request bounds, safe Markdown, navigation/links and no raw IPC/fs/SQL/process exposure.

Only prepared activity is implemented: `ActivityEntry.stage='prepared'` means “material prepared to return.” It does not establish stdout emission, host receipt, understanding or task completion. Stage `committed-change` is a local domain event, which may be a pending proposal rather than an applied body. The six phase 3 agent methods retain actual entry names; separate search/description/expansion remain unadvertised. Adapter exit before response belongs to subsequent protocol testing.

Phase 4 must provide a bounded accepted-change/evidence read for another grant: find the reason and exact cited source revision through a change pointer, retain that pin after the source advances, and deny unauthorized source details. Keep the original proposal envelope; do not silently append unreviewed relations/body. Folder import, backup/export/restore, broader organization and typed views follow their bounded implementation slices.

Phase 5 checks five-language controls/long conflict text, CJK composition, focus/source return, keyboard navigation, 980px/zoom, realistic data performance, interrupted storage operations and a moved macOS app using its bundled agent runtime. Power-cut durability, actual full disk, unsupported/network filesystems, signing/notarization, Windows/Linux and arbitrary native-file synchronization remain unverified until separately exercised. Runtime/driver/SDK updates reopen relevant compatibility checks.
