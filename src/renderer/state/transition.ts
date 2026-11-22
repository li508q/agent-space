import type { EditorSession, InputLockSource } from './editor.js';

export type TransitionStage = 'preparing' | 'opening' | 'creating';
export type TransitionTicket = { readonly identity: number; claimed: boolean };
type Hooks = {
  current: () => EditorSession | null;
  invalidateReads: () => void;
  changed: (stage: TransitionStage | null) => void;
};

/** Keeps the checked editor paused through replacement. Other lock owners remain independent. */
export class EditorTransitions {
  private active: TransitionTicket | null = null;
  private sequence = 0;
  private locks = new Set<InputLockSource>();
  private idle = new Set<() => void>();
  private disposed = false;
  private stage: TransitionStage | null = null;
  constructor(
    private readonly hooks: Hooks,
    initial: InputLockSource[] = [],
  ) {
    for (const source of initial) this.locks.add(source);
  }
  get pending() {
    return this.active !== null;
  }
  activate() {
    this.disposed = false;
  }
  get locked() {
    return this.locks.size > 0;
  }
  get cancellable() {
    return this.stage === 'opening' && !!this.active && !this.active.claimed;
  }
  isCurrent(ticket: TransitionTicket) {
    return !this.disposed && ticket === this.active;
  }

  setLock(source: 'close' | 'space', locked: boolean): boolean {
    if (this.locks.has(source) === locked) return true;
    const editor = this.hooks.current();
    if (locked && editor && !editor.lockInput(true, source)) return false;
    if (locked) {
      this.locks.add(source);
      this.hooks.invalidateReads();
    } else {
      this.locks.delete(source);
      editor?.lockInput(false, source);
    }
    return true;
  }
  inherit(editor: EditorSession) {
    for (const source of this.locks) editor.lockInput(true, source);
  }
  claimInstall(ticket?: TransitionTicket): boolean {
    if (this.disposed) return false;
    if (ticket) {
      if (!this.isCurrent(ticket) || ticket.claimed) return false;
      ticket.claimed = true;
    } else if (this.active || this.hooks.current() !== null) return false;
    this.hooks.invalidateReads();
    return true;
  }
  whenIdle(): Promise<void> {
    return this.active ? new Promise((resolve) => this.idle.add(resolve)) : Promise.resolve();
  }
  private release(ticket: TransitionTicket, original: EditorSession | null) {
    if (this.active !== ticket) return;
    this.active = null;
    this.locks.delete('navigation');
    original?.lockInput(false, 'navigation');
    this.hooks.current()?.lockInput(false, 'navigation');
    this.stage = null;
    this.hooks.changed(null);
    for (const resolve of this.idle) resolve();
    this.idle.clear();
  }
  cancelOpening() {
    if (!this.cancellable || !this.active) return;
    this.hooks.invalidateReads();
    this.release(this.active, this.hooks.current());
  }
  async run(
    stage: 'opening' | 'creating',
    prepare: () => Promise<boolean>,
    action: (ticket: TransitionTicket) => Promise<void>,
    blocked: () => void,
  ): Promise<void> {
    if (this.disposed || this.active || this.locked) return;
    const ticket: TransitionTicket = { identity: ++this.sequence, claimed: false };
    const original = this.hooks.current();
    this.active = ticket;
    this.hooks.invalidateReads();
    this.stage = 'preparing';
    this.hooks.changed(this.stage);
    try {
      await original?.afterComposition();
      if (!this.isCurrent(ticket) || this.hooks.current() !== original || this.locked) return;
      if (original && !original.lockInput(true, 'navigation')) return;
      this.locks.add('navigation');
      if (!(await prepare())) {
        if (this.isCurrent(ticket)) blocked();
        return;
      }
      if (!this.isCurrent(ticket) || this.hooks.current() !== original) return;
      this.stage = stage;
      this.hooks.changed(stage);
      await action(ticket);
    } finally {
      this.release(ticket, original);
    }
  }
  dispose() {
    this.disposed = true;
    this.hooks.invalidateReads();
    if (this.active) this.release(this.active, this.hooks.current());
  }
}
