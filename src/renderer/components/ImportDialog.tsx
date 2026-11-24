import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSummary } from '../../contracts/core.js';
import type {
  ConfirmImportInput,
  ImportItemResult,
  ImportPreviewPage,
  ImportRunPage,
  ImportRunSummary,
  ImportResumeSession,
  PreviewSession,
} from '../../contracts/local.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectRef } from '../../contracts/schema.js';
import type { OperationTask } from '../state/operation.js';
import { bound } from '../state/binding.js';
import {
  defaultImportChoice,
  loadImportPreview,
  loadImportRun,
  type ImportChoice,
} from '../state/local.js';
import { t, titleText } from '../i18n/index.js';
import { ErrorNotice, Modal, newKey, Time, useLocale, useTaskFactory } from '../ui.js';

type GroupChoice = ConfirmImportInput['groups'][number];
export function ImportDialog({
  api,
  session,
  onOpen,
  onChanged,
  onClose,
}: {
  api: DesktopApi;
  session: SpaceSession;
  onOpen: (ref: ObjectRef) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const locale = useLocale(),
    makeTask = useTaskFactory(),
    gate = useRef(0),
    live = useRef(true);
  const [profile, setProfile] = useState<PreviewSession['page']['profileId']>(
    'knowledge-project-repos/v1',
  );
  const [preview, setPreview] = useState<PreviewSession | null>(null),
    [page, setPage] = useState<ImportPreviewPage | null>(null);
  const [choices, setChoices] = useState<ImportChoice[]>([]),
    [groups, setGroups] = useState<GroupChoice[]>([]),
    [loaded, setLoaded] = useState(0);
  const [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [busy, setBusy] = useState(false);
  const [formComposing, setFormComposing] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [projects, setProjects] = useState<ObjectSummary[]>([]),
    [assets, setAssets] = useState<ObjectSummary[]>([]);
  const [projectNext, setProjectNext] = useState<string | null>(null),
    [assetNext, setAssetNext] = useState<string | null>(null);
  const [runs, setRuns] = useState<ImportRunSummary[]>([]),
    [runNext, setRunNext] = useState<string | null>(null);
  const [run, setRun] = useState<ImportRunPage | null>(null),
    [items, setItems] = useState<ImportItemResult[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const confirmTask = useRef<OperationTask<ImportRunSummary> | null>(null);
  const command = useRef<OperationTask<ImportRunSummary> | null>(null);
  const resumeTask = useRef<OperationTask<ImportResumeSession> | null>(null);
  const selectedRun = useRef<string | null>(null),
    runGate = useRef(0),
    visibleItems = useRef(50),
    reading = useRef(false);
  const selectedSummary = useRef<ImportRunSummary | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const uncertain =
    !!confirmTask.current?.unknown || !!command.current?.unknown || !!resumeTask.current?.unknown;
  async function options(kind: 'project' | 'asset', cursor?: string) {
    const result = await api
      .query(
        bound(session, {
          filter: { kind },
          limit: 50,
          maxBytes: 65_536,
          ...(cursor ? { cursor } : {}),
        }),
      )
      .catch(() => null);
    if (!live.current) return;
    if (result?.ok) {
      (kind === 'project' ? setProjects : setAssets)((old) =>
        cursor ? [...old, ...result.value.items] : result.value.items,
      );
      (kind === 'project' ? setProjectNext : setAssetNext)(result.value.nextCursor);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  async function history(beforeId?: string) {
    const result = await api
      .listImports(bound(session, { limit: 20, ...(beforeId ? { beforeId } : {}) }))
      .catch(() => null);
    if (!live.current) return;
    if (result?.ok) {
      setRuns((old) => (beforeId ? [...old, ...result.value.items] : result.value.items));
      setRunNext(result.value.nextBeforeId);
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
  }
  async function attach(initial: PreviewSession) {
    const ticket = ++gate.current;
    selectedRun.current = null;
    selectedSummary.current = null;
    runGate.current++;
    reading.current = false;
    setRunLoading(false);
    setRun(null);
    setItems([]);
    setPreview(initial);
    setPage(null);
    setLoaded(initial.page.entries.length);
    setBusy(true);
    setError(null);
    const result = await loadImportPreview(api, session, initial, (count) => {
      if (ticket === gate.current && live.current) setLoaded(count);
    });
    if (!live.current || ticket !== gate.current) return;
    if (result.ok) {
      setPage(result.value);
      setChoices(
        result.value.entries.filter((entry) => entry.kind !== 'group').map(defaultImportChoice),
      );
      setGroups(result.value.groups.map((group) => ({ groupId: group.id, title: group.title })));
      setDirty(false);
      confirmTask.current = null;
    } else setError(result.error.code);
    setBusy(false);
  }
  async function choose(mode: 'files' | 'folder') {
    if (dirty) {
      setDiscard(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api
      .chooseImport(bound(session, { mode, profileId: profile }))
      .catch(() => null);
    if (!live.current) return;
    if (result?.ok && result.value) {
      selectedRun.current = null;
      runGate.current++;
      setRun(null);
      setItems([]);
      await attach(result.value);
    } else {
      if (!result?.ok) setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
      setBusy(false);
    }
  }
  async function readRun(summary: ImportRunSummary, more = false, quiet = false) {
    if (selectedRun.current !== summary.id) return;
    const ticket = ++runGate.current;
    reading.current = true;
    setRunLoading(true);
    const count = visibleItems.current + (more ? 50 : 0);
    const result = await loadImportRun(api, session, summary.id, count);
    if (!live.current || ticket !== runGate.current || selectedRun.current !== summary.id) return;
    if (result?.ok) {
      setRun(result.value);
      setItems(result.value.items);
      visibleItems.current = Math.max(50, result.value.items.length);
      setError((previous) =>
        !quiet || result.value.coordinatorError || previous === 'CURSOR_STALE'
          ? (result.value.coordinatorError?.code ?? null)
          : previous,
      );
    } else setError(result && !result.ok ? result.error.code : 'OPERATION_UNKNOWN');
    reading.current = false;
    setRunLoading(false);
  }
  async function showRun(summary: ImportRunSummary) {
    selectedRun.current = summary.id;
    selectedSummary.current = summary;
    visibleItems.current = 50;
    setRun(null);
    setItems([]);
    setSelected([]);
    await readRun(summary);
  }
  async function confirm() {
    if (!page || !preview || formComposing) return;
    if (!confirmTask.current) {
      const used = new Set(
        choices
          .filter((choice) => choice.action !== 'skip' && choice.project.mode === 'group')
          .map((choice) => (choice.project.mode === 'group' ? choice.project.groupId : '')),
      );
      const input = {
        handle: preview.handle,
        operationKey: newKey('import'),
        expectedPlanDigest: page.planDigest,
        choices: structuredClone(choices),
        groups: structuredClone(groups.filter((group) => used.has(group.groupId))),
      };
      confirmTask.current = makeTask(input.operationKey, () =>
        api.confirmImport(bound(session, input)),
      );
    }
    setBusy(true);
    setError(null);
    try {
      const result = await confirmTask.current.run();
      if (result.ok) {
        setDirty(false);
        setPage(null);
        setPreview(null);
        await showRun(result.value);
        void history();
        onChanged();
      } else {
        setError(result.error.code);
        confirmTask.current = null;
      }
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  async function changeRun(action: 'pause' | 'retry') {
    if (!run || (!command.current && action === 'retry' && selected.length === 0)) return;
    if (!command.current) {
      const shared = {
        operationKey: newKey(action),
        runId: run.run.id,
        expectedManifestDigest: run.run.manifestDigest,
      };
      command.current =
        action === 'pause'
          ? makeTask(shared.operationKey, () => api.pauseImport(bound(session, shared)))
          : makeTask(shared.operationKey, () =>
              api.retryImport(bound(session, { ...shared, itemIds: [...selected] })),
            );
    }
    setBusy(true);
    setError(null);
    try {
      const result = await command.current.run();
      if (result.ok) {
        await readRun(result.value);
        setSelected([]);
        void history();
        onChanged();
      } else setError(result.error.code);
      command.current = null;
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    if (!run) return;
    setBusy(true);
    setError(null);
    if (!resumeTask.current) {
      const input = {
        operationKey: newKey('resume-import'),
        runId: run.run.id,
        expectedManifestDigest: run.run.manifestDigest,
      };
      resumeTask.current = makeTask(input.operationKey, () =>
        api.resumeImport(bound(session, input)),
      );
    }
    try {
      const result = await resumeTask.current.run();
      if (!live.current) return;
      if (result.ok) {
        if (result.value.state === 'confirmation-required') await attach(result.value.preview);
        else {
          await readRun(result.value.run);
          void history();
        }
      } else setError(result.error.code);
      resumeTask.current = null;
    } catch {
      setError('OPERATION_UNKNOWN');
    } finally {
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    void options('project');
    void options('asset');
    void history();
    return () => {
      live.current = false;
      gate.current++;
      runGate.current++;
    };
  }, [session.bindingId]);
  useEffect(() => {
    if (!run || busy || uncertain || page || !['ready', 'running'].includes(run.run.state)) return;
    const timer = setInterval(() => {
      if (!reading.current) void readRun(run.run, false, true);
    }, 1000);
    return () => clearInterval(timer);
  }, [run?.run.id, run?.run.state, busy, uncertain, !!page]);
  function editChoice(itemId: string, patch: Partial<ImportChoice>) {
    setChoices((old) => {
      const next = old.map((choice) =>
        choice.itemId === itemId ? { ...choice, ...patch } : choice,
      );
      const allowed = new Set([
        ...assets.map((asset) => asset.ref.objectId),
        ...next
          .filter((choice) => choice.action === 'external-reference')
          .map((choice) => choice.itemId),
      ]);
      return next.map((choice) => ({
        ...choice,
        useAssetIds: choice.useAssetIds.filter((id) => allowed.has(id)),
      }));
    });
    setDirty(true);
    setError(null);
  }
  const selectedCount = choices.filter((choice) => choice.action !== 'skip').length;
  const references = [
    ...assets.map((asset) => ({
      id: asset.ref.objectId,
      title: titleText(locale, asset.title, 'asset'),
    })),
    ...(page?.entries
      .filter((entry) =>
        choices.some(
          (choice) => choice.itemId === entry.id && choice.action === 'external-reference',
        ),
      )
      .map((entry) => ({ id: entry.id, title: entry.relativePath })) ?? []),
  ];
  return (
    <Modal
      title={t(locale, 'import.title')}
      testId="import-dialog"
      onComposing={setFormComposing}
      onClose={() => {
        if (busy || uncertain) return;
        if (dirty) setDiscard(true);
        else onClose();
      }}
    >
      <p>{t(locale, 'import.reviewNotice')}</p>
      <fieldset disabled={busy || uncertain || discard || formComposing} className="metadata-form">
        <label>
          {t(locale, 'import.profile')}
          <select
            value={profile}
            data-testid="import-profile"
            onChange={(event) => setProfile(event.target.value as typeof profile)}
          >
            <option value="plain-files/v1">{t(locale, 'import.profilePlain')}</option>
            <option value="knowledge-project-repos/v1">
              {t(locale, 'import.profileKnowledge')}
            </option>
          </select>
        </label>
        <div className="as-actions">
          <button
            data-testid="choose-import-files"
            onClick={() => {
              void choose('files');
            }}
          >
            {t(locale, 'import.chooseFiles')}
          </button>
          <button
            data-testid="choose-import-folder"
            onClick={() => {
              void choose('folder');
            }}
          >
            {t(locale, 'import.chooseFolder')}
          </button>
        </div>
      </fieldset>
      <ErrorNotice
        code={run && error === 'CURSOR_STALE' ? null : error}
        onRetry={() => {
          if (confirmTask.current?.unknown) void confirm();
          else if (command.current?.unknown) void changeRun('pause');
          else if (resumeTask.current?.unknown) void resume();
          else if (preview && !page) void attach(preview);
          else if (selectedSummary.current) void readRun(selectedSummary.current);
          else void history();
        }}
      />
      {runLoading && <p role="status">{t(locale, 'ui.loading')}</p>}
      {preview && (
        <p role="status">
          {t(locale, 'import.loaded', {
            loaded,
            selected: selectedCount,
            roots: preview.page.rootCount,
          })}
        </p>
      )}
      {preview && !page && busy && <p>{t(locale, 'import.loadingPages')}</p>}
      {page && (
        <>
          {page.summary.truncated && (
            <p className="attention">{t(locale, 'import.limitReached')}</p>
          )}
          {page.summary.limitReasons.map((issue) => (
            <p key={issue} className="secondary">
              {t(locale, `importIssue.${issue}`)}
            </p>
          ))}
          <p className="secondary">
            {t(locale, 'import.profileUsed', {
              profile: t(
                locale,
                page.profileId === 'plain-files/v1'
                  ? 'import.profilePlain'
                  : 'import.profileKnowledge',
              ),
            })}
          </p>
          <fieldset disabled={busy || uncertain || discard} className="metadata-form">
            <h3>{t(locale, 'import.projectGrouping')}</h3>
            <p className="secondary" data-testid="import-reuse-notice">
              {t(locale, 'import.reuseNotice')}
            </p>
            {groups.map((group) => (
              <div className="import-group" key={group.groupId}>
                <label>
                  {t(locale, 'object.title')}
                  <input
                    value={group.title}
                    maxLength={240}
                    onChange={(event) => {
                      setGroups((old) =>
                        old.map((value) =>
                          value.groupId === group.groupId
                            ? { ...value, title: event.target.value }
                            : value,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                </label>
                <label>
                  {t(locale, 'import.groupDestination')}
                  <select
                    value={group.existingProjectId ?? ''}
                    onChange={(event) => {
                      const id = event.target.value;
                      setGroups((old) =>
                        old.map((value) =>
                          value.groupId === group.groupId
                            ? {
                                groupId: value.groupId,
                                title: value.title,
                                ...(id ? { existingProjectId: id } : {}),
                              }
                            : value,
                        ),
                      );
                      setDirty(true);
                    }}
                  >
                    <option value="">{t(locale, 'org.newProject')}</option>
                    {projects.map((project) => (
                      <option key={project.ref.objectId} value={project.ref.objectId}>
                        {titleText(locale, project.title, 'project')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            <button
              disabled={formComposing}
              onClick={() => {
                setChoices((old) =>
                  old.map((choice) => ({ ...choice, project: { mode: 'none' } })),
                );
                setDirty(true);
              }}
            >
              {t(locale, 'import.independentAll')}
            </button>
            {projectNext && (
              <button
                onClick={() => {
                  void options('project', projectNext);
                }}
              >
                {t(locale, 'import.moreProjects')}
              </button>
            )}
            <div className="import-entries">
              {page.entries
                .filter((entry) => entry.kind !== 'group')
                .map((entry) => {
                  const choice = choices.find((value) => value.itemId === entry.id)!;
                  return (
                    <section
                      className="import-entry"
                      key={entry.id}
                      data-testid={`import-entry-${entry.id}`}
                    >
                      <h4 className="as-wrap">{entry.relativePath}</h4>
                      {entry.sourceLocation && (
                        <details className="import-source-location">
                          <summary>{t(locale, 'import.sourceLocation')}</summary>
                          <code className="as-wrap">{entry.sourceLocation}</code>
                        </details>
                      )}
                      {entry.issue && (
                        <p className="secondary">{t(locale, `importIssue.${entry.issue}`)}</p>
                      )}
                      <label>
                        {t(locale, 'import.action')}
                        <select
                          data-testid="import-item-action"
                          value={choice.action}
                          onChange={(event) =>
                            editChoice(entry.id, {
                              action: event.target.value as ImportChoice['action'],
                            })
                          }
                        >
                          <option value="skip">{t(locale, 'import.skip')}</option>
                          {entry.kind === 'text' && (
                            <option value="managed-copy">{t(locale, 'import.managedCopy')}</option>
                          )}
                          {entry.kind !== 'skipped' && (
                            <option value="external-reference">
                              {t(locale, 'import.addReference')}
                            </option>
                          )}
                        </select>
                      </label>
                      {choice.action !== 'skip' && (
                        <>
                          {choice.action === 'external-reference' && (
                            <p className="secondary">{t(locale, 'import.refNotice')}</p>
                          )}
                          <label>
                            {t(locale, 'object.title')}
                            <input
                              value={choice.title ?? ''}
                              maxLength={240}
                              data-testid="import-item-title"
                              onChange={(event) =>
                                editChoice(entry.id, { title: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            {t(locale, 'relation.inProject')}
                            <select
                              data-testid="import-item-project"
                              value={
                                choice.project.mode === 'none'
                                  ? ''
                                  : choice.project.mode === 'group'
                                    ? `group:${choice.project.groupId}`
                                    : `existing:${choice.project.objectId}`
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                editChoice(entry.id, {
                                  project: !value
                                    ? { mode: 'none' }
                                    : value.startsWith('group:')
                                      ? { mode: 'group', groupId: value.slice(6) }
                                      : { mode: 'existing', objectId: value.slice(9) },
                                });
                              }}
                            >
                              <option value="">{t(locale, 'import.independent')}</option>
                              {groups.map((group) => (
                                <option key={group.groupId} value={`group:${group.groupId}`}>
                                  {group.title || t(locale, 'object.untitledProject')}
                                </option>
                              ))}
                              {projects.map((project) => (
                                <option
                                  key={project.ref.objectId}
                                  value={`existing:${project.ref.objectId}`}
                                >
                                  {titleText(locale, project.title, 'project')}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {t(locale, 'import.assetReferences')}
                            <select
                              multiple
                              value={choice.useAssetIds}
                              onChange={(event) => {
                                const ids = [...event.target.selectedOptions].map(
                                  (option) => option.value,
                                );
                                if (ids.length > 20) setError('LIMIT_EXCEEDED');
                                else editChoice(entry.id, { useAssetIds: ids });
                              }}
                            >
                              {references
                                .filter((asset) => asset.id !== entry.id)
                                .map((asset) => (
                                  <option key={asset.id} value={asset.id}>
                                    {asset.title}
                                  </option>
                                ))}
                            </select>
                            <small className="secondary">
                              {t(locale, 'import.assetLimit', { count: 20 })}
                            </small>
                          </label>
                        </>
                      )}
                    </section>
                  );
                })}
            </div>
            {assetNext && (
              <button
                onClick={() => {
                  void options('asset', assetNext);
                }}
              >
                {t(locale, 'import.moreAssets')}
              </button>
            )}
            <p>{t(locale, 'import.confirmScope', { count: selectedCount })}</p>
            <p className="secondary">{t(locale, 'import.notLiveSync')}</p>
            <button
              className="primary"
              data-testid="confirm-import"
              disabled={selectedCount === 0 || formComposing}
              onClick={() => {
                void confirm();
              }}
            >
              {t(locale, 'import.confirm')}
            </button>
          </fieldset>
        </>
      )}
      {run && (
        <section data-testid="import-run">
          <h3>{t(locale, 'import.results')}</h3>
          <ErrorNotice
            code={error === 'CURSOR_STALE' ? error : null}
            onRetry={() => {
              void readRun(run.run);
            }}
          />
          <p>{t(locale, `importRun.${run.run.state}`)}</p>
          <p>
            {t(locale, 'import.runCounts', {
              committed: run.run.committed,
              reused: run.run.reused,
              failed: run.run.failed,
              blocked: run.run.blocked,
              total: run.run.total,
            })}
          </p>
          <p className="secondary">{t(locale, 'import.originalsUnchanged')}</p>
          <p className="secondary" role="status">
            {t(locale, 'import.itemsRange', { loaded: items.length, total: run.run.total })}
          </p>
          {items.map((item) => (
            <div className="import-result" key={item.id}>
              {(item.state === 'failed' || item.state === 'blocked') && (
                <input
                  type="checkbox"
                  disabled={busy || uncertain || !!page}
                  checked={selected.includes(item.id)}
                  aria-label={t(locale, 'import.selectRetry', { path: item.relativePath })}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                    )
                  }
                />
              )}
              <span className="as-wrap">{item.relativePath}</span>
              <span>{t(locale, `importItem.${item.state}`)}</span>
              {item.state === 'reused' && (
                <p className="secondary">{t(locale, 'import.reusedNotice')}</p>
              )}
              {item.error && <ErrorNotice code={item.error.code} />}
              {item.originalRef && (
                <button
                  disabled={busy || uncertain || dirty || !!page}
                  onClick={() => onOpen(item.originalRef!)}
                >
                  {item.state === 'reused'
                    ? t(locale, 'import.openExisting')
                    : t(locale, 'common.openNamed', { title: item.title || item.relativePath })}
                </button>
              )}
            </div>
          ))}
          {run.nextAfterItemId && (
            <button
              disabled={busy || uncertain || runLoading}
              onClick={() => {
                void readRun(run.run, true);
              }}
            >
              {t(locale, 'context.nextPage')}
            </button>
          )}
          <div className="as-actions">
            <button
              disabled={busy || uncertain || !!page}
              onClick={() => {
                void changeRun('pause');
              }}
            >
              {t(locale, 'import.pause')}
            </button>
            <button
              disabled={busy || uncertain || !!page}
              onClick={() => {
                void resume();
              }}
            >
              {t(locale, 'import.resume')}
            </button>
            <button
              disabled={busy || uncertain || !!page || selected.length === 0}
              onClick={() => {
                void changeRun('retry');
              }}
            >
              {t(locale, 'import.retryUnfinished')}
            </button>
          </div>
          <p className="secondary">{t(locale, 'import.resumeNotice')}</p>
        </section>
      )}
      <section>
        <h3>{t(locale, 'import.history')}</h3>
        {runs.map((entry) => (
          <button
            className="import-history-row"
            disabled={busy || uncertain || dirty}
            key={entry.id}
            onClick={() => {
              setPage(null);
              setPreview(null);
              setSelected([]);
              command.current = null;
              resumeTask.current = null;
              void showRun(entry);
            }}
          >
            <Time value={entry.createdAt} />
            <span>{t(locale, `importRun.${entry.state}`)}</span>
          </button>
        ))}
        {runNext && (
          <button
            onClick={() => {
              void history(runNext);
            }}
          >
            {t(locale, 'context.nextPage')}
          </button>
        )}
      </section>
      {discard && (
        <div className="discard-prompt">
          <p>{t(locale, 'metadata.discardQuestion')}</p>
          <div className="as-actions">
            <button autoFocus onClick={() => setDiscard(false)}>
              {t(locale, 'metadata.keepEditing')}
            </button>
            <button
              onClick={() => {
                setDirty(false);
                setDiscard(false);
                setPage(null);
                setPreview(null);
              }}
            >
              {t(locale, 'metadata.discard')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
