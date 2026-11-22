import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type {
  DraftReceipt,
  DraftSnapshot,
  ObjectSnapshot,
  ObjectView,
  SaveDraftInput,
  WriteResult,
} from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import type { ObjectContent } from '../../contracts/schema.js';
import { bound } from './binding.js';
import { OperationTask } from './operation.js';

type EditorApi = Pick<
  DesktopApi,
  'createObject' | 'saveObject' | 'saveDraft' | 'discardDraft' | 'operationStatus'
>;
type SaveState = 'saved' | 'dirty' | 'saving' | 'checking' | 'conflict' | 'error';
type DraftState = 'none' | 'writing' | 'kept' | 'checking' | 'error';
export type EditorSnapshot = Readonly<{
  editorId: string;
  objectId: string | null;
  kind: ObjectSnapshot['kind'];
  revision: number | null;
  object: ObjectSnapshot | null;
  content: ObjectContent;
  generation: number;
  savedGeneration: number;
  saveState: SaveState;
  draftState: DraftState;
  draft: DraftReceipt | null;
  error: ErrorCode | null;
  draftError: ErrorCode | null;
  composing: boolean;
  locked: boolean;
  remote: ObjectView | null;
}>;
type SaveAttempt = { task: OperationTask<WriteResult>; generation: number };
type DraftAttempt = { task: OperationTask<DraftReceipt>; input: SaveDraftInput };
export type InputLockSource = 'close' | 'navigation' | 'space';

const empty = (): ObjectContent => ({ title: '', body: '', properties: {}, relations: [] });
const clone = <T>(value: T): T => structuredClone(value);

/** One immutable binding and one editor. No other editor's callback can change this buffer. */
export class EditorSession {
  private state: EditorSnapshot;
  private listeners = new Set<() => void>();
  private autosave: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private saveLoop: Promise<boolean> | null = null;
  private activeSave: SaveAttempt | null = null;
  private draftTail: Promise<void> = Promise.resolve();
  private draftId: string | null;
  private retired = new Set<string>();
  private draftAttempts = new Map<string, DraftAttempt>();
  private retained = new Map<string, DraftReceipt>();
  private retirements = new Map<string, OperationTask<DraftReceipt>>();
  private compositionWaiters = new Set<() => void>();
  private inputLocks = new Set<InputLockSource>();
  private disposed = false;
  private readonly id: () => string;
  private readonly source: SaveDraftInput['source'];
  private readonly newObjectId: string;

  constructor(
    private readonly api: EditorApi,
    readonly session: SpaceSession,
    view: ObjectView | null,
    private readonly options: {
      draft?: DraftSnapshot;
      content?: ObjectContent;
      kind?: 'document' | 'record';
      source?: SaveDraftInput['source'];
      timers?: boolean;
      id?: () => string;
      onSaved?: (object: ObjectSnapshot) => void;
    } = {},
  ) {
    this.id = options.id ?? (() => crypto.randomUUID());
    this.newObjectId = this.id();
    this.source = options.draft?.source ?? options.source ?? { kind: 'editor' };
    this.draftId = options.draft?.draftId ?? null;
    const target = options.draft?.target;
    const generation = options.draft?.generation ?? (view ? 0 : 1);
    const revision =
      target?.state === 'existing' ? target.baseRevision : (view?.object.revision ?? null);
    this.state = Object.freeze({
      editorId: this.id(),
      objectId: target?.state === 'existing' ? target.objectId : (view?.object.id ?? null),
      kind:
        target?.state === 'new' ? target.kind : (view?.object.kind ?? options.kind ?? 'document'),
      revision,
      object: view?.object ?? null,
      content: clone(options.draft?.content ?? options.content ?? view?.object.content ?? empty()),
      generation,
      savedGeneration: options.draft || !view ? -1 : generation,
      saveState: options.draft || !view ? 'dirty' : 'saved',
      draftState: options.draft?.retained ? 'kept' : 'none',
      draft: options.draft ?? null,
      error: null,
      draftError: null,
      composing: false,
      locked: false,
      remote: view && revision !== view.currentRevision ? view : null,
    });
    if (options.draft?.retained) this.retained.set(options.draft.draftId, options.draft);
  }

  getSnapshot = (): EditorSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get dirty() {
    return this.state.generation !== this.state.savedGeneration;
  }

  private publish(patch: Partial<EditorSnapshot>) {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }

  edit(content: ObjectContent) {
    if (
      this.disposed ||
      this.state.locked ||
      this.state.object?.lifecycle === 'archived' ||
      JSON.stringify(content) === JSON.stringify(this.state.content)
    )
      return;
    this.publish({
      content: clone(content),
      generation: this.state.generation + 1,
      saveState: this.activeSave?.task.unknown ? 'checking' : 'dirty',
      error: this.activeSave?.task.unknown ? 'OPERATION_UNKNOWN' : null,
    });
    this.schedule();
  }
  setTitle(title: string) {
    this.edit({ ...this.state.content, title });
  }
  setBody(body: string) {
    this.edit({ ...this.state.content, body });
  }

  setComposing(composing: boolean) {
    if (composing && this.state.locked) return;
    this.publish({ composing });
    if (composing) this.clearTimers();
    else {
      for (const resolve of this.compositionWaiters) resolve();
      this.compositionWaiters.clear();
      this.schedule();
    }
  }
  afterComposition(): Promise<void> {
    if (!this.state.composing) return Promise.resolve();
    return new Promise((resolve) => this.compositionWaiters.add(resolve));
  }
  lockInput(locked: boolean, source: InputLockSource = 'close'): boolean {
    if (locked && this.state.composing) return false;
    if (locked) this.inputLocks.add(source);
    else this.inputLocks.delete(source);
    this.publish({ locked: this.inputLocks.size > 0 });
    return true;
  }
  private clearTimers() {
    if (this.autosave) clearTimeout(this.autosave);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.autosave = this.draftTimer = null;
  }
  private schedule() {
    this.clearTimers();
    if (!this.dirty || this.state.composing || this.disposed || this.options.timers === false)
      return;
    this.draftTimer = setTimeout(() => {
      void this.keepDraft();
    }, 250);
    if (!this.activeSave?.task.unknown && this.state.saveState !== 'conflict') {
      this.autosave = setTimeout(() => {
        void this.saveNow();
      }, 800);
    }
  }

  observe(view: ObjectView) {
    if (
      view.object.id !== this.state.objectId ||
      view.object.spaceId !== this.session.status.spaceId ||
      view.object.instanceId !== this.session.status.instanceId ||
      view.object.revision < (this.state.revision ?? 0)
    )
      return;
    if (this.dirty || this.state.composing || this.activeSave) {
      if (view.currentRevision !== this.state.revision) this.publish({ remote: view });
      return;
    }
    if (view.object.revision === this.state.revision) {
      this.publish({ object: view.object });
      return;
    }
    const generation = this.state.generation + 1;
    this.publish({
      object: view.object,
      content: clone(view.object.content),
      revision: view.object.revision,
      generation,
      savedGeneration: generation,
      saveState: 'saved',
      error: null,
      remote: null,
    });
  }

  async saveNow(): Promise<boolean> {
    await this.afterComposition();
    if (this.disposed) return false;
    if (this.autosave) clearTimeout(this.autosave);
    if (this.saveLoop) return this.saveLoop;
    this.saveLoop = this.drainSaves().finally(() => {
      this.saveLoop = null;
    });
    return this.saveLoop;
  }

  private async drainSaves(): Promise<boolean> {
    while ((this.dirty || this.activeSave) && !this.state.composing && !this.disposed) {
      if (!this.activeSave) {
        const generation = this.state.generation;
        const operationKey = `save-${this.id()}`;
        const content = clone(this.state.content);
        let task: OperationTask<WriteResult>;
        if (this.state.objectId && this.state.revision) {
          const input = {
            operationKey,
            targetId: this.state.objectId,
            expectedRevision: this.state.revision,
            content,
            generation,
          };
          task = new OperationTask(this.api, this.session, operationKey, () =>
            this.api.saveObject(bound(this.session, input)),
          );
        } else {
          const input = {
            operationKey,
            id: this.newObjectId,
            kind: this.state.kind,
            content,
            generation,
          };
          task = new OperationTask(this.api, this.session, operationKey, () =>
            this.api.createObject(bound(this.session, input)),
          );
        }
        this.activeSave = { task, generation };
      }
      const attempt = this.activeSave;
      this.publish({ saveState: attempt.task.unknown ? 'checking' : 'saving', error: null });
      let result;
      try {
        result = await attempt.task.run();
      } catch {
        this.publish({ saveState: 'checking', error: 'OPERATION_UNKNOWN' });
        return false;
      }
      if (!result.ok) {
        this.activeSave = null;
        this.publish({
          saveState: result.error.code === 'STALE_REVISION' ? 'conflict' : 'error',
          error: result.error.code,
        });
        return false;
      }
      const value = result.value;
      if (
        value.generation !== attempt.generation ||
        value.object.spaceId !== this.session.status.spaceId ||
        value.object.instanceId !== this.session.status.instanceId
      ) {
        this.publish({ saveState: 'error', error: 'INTEGRITY_FAILURE' });
        return false;
      }
      this.activeSave = null;
      const laterInput = this.state.generation !== attempt.generation;
      // Rebasing a later retained draft changes its digest. Give it a NEW generation.
      const generation = this.state.generation + (laterInput ? 1 : 0);
      this.publish({
        object: value.object,
        objectId: value.object.id,
        revision: value.object.revision,
        generation,
        savedGeneration: attempt.generation,
        saveState: laterInput ? 'dirty' : 'saved',
        error: null,
      });
      if (laterInput) await this.keepDraft();
      else await this.cleanupSavedDraft();
      this.options.onSaved?.(value.object);
    }
    return !this.dirty;
  }

  private draftTarget(): SaveDraftInput['target'] {
    return this.state.objectId && this.state.revision
      ? { state: 'existing', objectId: this.state.objectId, baseRevision: this.state.revision }
      : { state: 'new', kind: this.state.kind === 'record' ? 'record' : 'document' };
  }

  private enqueueDraft(): Promise<void> {
    if (this.disposed || !this.dirty || this.state.composing) return Promise.resolve();
    if (!this.draftId) this.draftId = this.id();
    const draftId = this.draftId;
    const generation = this.state.generation;
    const key = `${draftId}:${generation}`;
    let attempt = this.draftAttempts.get(key);
    if (!attempt) {
      const input: SaveDraftInput = {
        operationKey: `draft-${draftId}-${generation}`,
        draftId,
        generation,
        target: this.draftTarget(),
        source: this.source,
        content: clone(this.state.content),
      };
      attempt = {
        input,
        task: new OperationTask(this.api, this.session, input.operationKey, () =>
          this.api.saveDraft(bound(this.session, input)),
        ),
      };
      this.draftAttempts.set(key, attempt);
    }
    const captured = attempt;
    const write = this.draftTail.then(async () => {
      if (this.retired.has(draftId)) return;
      if (this.draftId === draftId) this.publish({ draftState: 'writing', draftError: null });
      try {
        const result = await captured.task.run();
        if (result.ok) {
          this.retained.set(draftId, result.value);
          if (this.draftId === draftId && !this.retired.has(draftId)) {
            this.publish({
              draft: result.value,
              draftState: result.value.generation === this.state.generation ? 'kept' : 'writing',
              draftError: null,
            });
          }
        } else if (this.draftId === draftId) {
          this.publish({ draftState: 'error', draftError: result.error.code });
        }
      } catch {
        if (this.draftId === draftId)
          this.publish({ draftState: 'checking', draftError: 'OPERATION_UNKNOWN' });
      }
    });
    this.draftTail = write;
    return write;
  }

  async keepDraft(): Promise<boolean> {
    await this.afterComposition();
    await this.draftTail;
    if (!this.dirty) return true;
    const attempt = this.draftId
      ? this.draftAttempts.get(`${this.draftId}:${this.state.generation}`)
      : null;
    if (attempt?.task.settled && this.state.draftError && !this.draftIsCurrent()) {
      // A known failed operation is terminal. A retry gets a new generation/key.
      this.publish({ generation: this.state.generation + 1 });
    }
    if (!this.draftIsCurrent()) await this.enqueueDraft();
    return this.draftIsCurrent();
  }
  private draftIsCurrent() {
    return (
      !!this.draftId &&
      this.state.draft?.draftId === this.draftId &&
      this.state.draft.retained &&
      this.state.draft.generation === this.state.generation
    );
  }

  private async retireDraft(id: string, receipt: DraftReceipt): Promise<boolean> {
    this.retired.add(id);
    if (this.draftId === id) {
      this.draftId = null;
      this.publish({ draft: null, draftState: 'none' });
    }
    const input = {
      operationKey: `discard-${this.id()}`,
      draftId: id,
      expectedGeneration: receipt.generation,
    };
    let task = this.retirements.get(id);
    if (!task) {
      task = new OperationTask(this.api, this.session, input.operationKey, () =>
        this.api.discardDraft(bound(this.session, input)),
      );
      this.retirements.set(id, task);
    }
    try {
      const result = await task.run();
      if (!result.ok || result.value.retained) {
        this.publish({ draftError: result.ok ? 'STALE_REVISION' : result.error.code });
        return false;
      }
      return true;
    } catch {
      this.publish({ draftError: 'OPERATION_UNKNOWN' });
      return false;
    }
  }
  private async cleanupSavedDraft() {
    await this.draftTail;
    if (this.dirty || this.state.composing || !this.draftId) return;
    const receipt = this.retained.get(this.draftId);
    if (receipt?.retained) await this.retireDraft(this.draftId, receipt);
  }

  async prepareToLeave(): Promise<boolean> {
    await this.afterComposition();
    for (let pass = 0; pass < 3; pass++) {
      await this.saveNow();
      if (!this.dirty && !this.state.composing) return true;
      await this.keepDraft();
      if (this.draftIsCurrent() && !this.state.composing) return true;
    }
    return false;
  }

  async discardEdits(): Promise<boolean> {
    await this.afterComposition();
    this.clearTimers();
    const capturedGeneration = this.state.generation;
    await this.saveLoop;
    await this.draftTail;
    if (this.state.generation !== capturedGeneration || this.activeSave) return false;
    for (const task of this.retirements.values()) {
      if (task.unknown) {
        try {
          const result = await task.run();
          if (!result.ok || result.value.retained) return false;
        } catch {
          return false;
        }
      }
    }
    const id = this.draftId;
    if (id) {
      // Resolve an uncertain write before retiring exactly its confirmed generation.
      for (const attempt of this.draftAttempts.values()) {
        if (attempt.input.draftId === id && attempt.task.unknown) {
          try {
            const result = await attempt.task.run();
            if (result.ok) this.retained.set(id, result.value);
            else if (result.error.code !== 'NOT_FOUND') return false;
          } catch {
            return false;
          }
        }
      }
      const receipt = this.retained.get(id);
      if (receipt?.retained && !(await this.retireDraft(id, receipt))) return false;
      this.retired.add(id);
      this.draftId = null;
    }
    const object = this.state.remote?.object ?? this.state.object;
    const generation = this.state.generation + 1;
    this.publish({
      content: clone(object?.content ?? empty()),
      object,
      objectId: object?.id ?? null,
      revision: object?.revision ?? null,
      generation,
      savedGeneration: generation,
      saveState: 'saved',
      error: null,
      draft: null,
      draftState: 'none',
      draftError: null,
      remote: null,
    });
    return true;
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
    for (const resolve of this.compositionWaiters) resolve();
    this.compositionWaiters.clear();
  }
}
