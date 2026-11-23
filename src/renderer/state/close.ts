import type { Result, ErrorCode } from '../../contracts/errors.js';

export type CloseState = {
  requestId: string;
  stage: 'composition' | 'preparing' | 'blocked' | 'responding';
} | null;
type Hooks = {
  afterComposition: () => Promise<void>;
  lockInput: (locked: boolean) => boolean;
  prepare: () => Promise<boolean>;
  respond: (
    id: string,
    decision: 'ready' | 'discard' | 'cancel',
  ) => Promise<Result<{ closed: boolean }>>;
  changed: (state: CloseState) => void;
  error: (code: ErrorCode) => void;
};

/** A cancelled nonce never regains authority when an old Promise resolves. */
export class CloseCoordinator {
  private attempt: { id: string } | null = null;
  constructor(private readonly hooks: Hooks) {}
  get pendingId() {
    return this.attempt?.id ?? null;
  }
  private current(attempt: { id: string }) {
    return this.attempt === attempt;
  }

  async start(requestId: string) {
    if (this.attempt?.id === requestId) return;
    if (this.attempt) this.cancel(this.attempt.id);
    const attempt = { id: requestId };
    this.attempt = attempt;
    this.hooks.changed({ requestId, stage: 'composition' });
    await this.hooks.afterComposition();
    if (!this.current(attempt)) return;
    if (!this.hooks.lockInput(true)) {
      this.cancel(requestId);
      await this.hooks.respond(requestId, 'cancel');
      return;
    }
    await this.prepare(attempt);
  }
  private async prepare(attempt: { id: string }) {
    this.hooks.changed({ requestId: attempt.id, stage: 'preparing' });
    let safe = false;
    try {
      safe = await this.hooks.prepare();
    } catch {
      this.hooks.error('OPERATION_UNKNOWN');
    }
    if (!this.current(attempt)) return;
    if (!safe) {
      this.hooks.changed({ requestId: attempt.id, stage: 'blocked' });
      return;
    }
    await this.finish(attempt, 'ready');
  }
  private async finish(attempt: { id: string }, decision: 'ready' | 'discard') {
    if (!this.current(attempt)) return;
    this.hooks.changed({ requestId: attempt.id, stage: 'responding' });
    try {
      const result = await this.hooks.respond(attempt.id, decision);
      if (!this.current(attempt)) return;
      if (!result.ok) {
        this.hooks.error(result.error.code);
        this.hooks.changed({ requestId: attempt.id, stage: 'blocked' });
      } else if (!result.value.closed) this.cancel(attempt.id);
    } catch {
      if (this.current(attempt)) {
        this.hooks.error('OPERATION_UNKNOWN');
        this.hooks.changed({ requestId: attempt.id, stage: 'blocked' });
      }
    }
  }
  cancel(requestId: string) {
    if (this.attempt?.id !== requestId) return;
    this.attempt = null;
    this.hooks.lockInput(false);
    this.hooks.changed(null);
  }
  async keepOpen(requestId: string) {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== requestId) return;
    try {
      const result = await this.hooks.respond(requestId, 'cancel');
      if (!this.current(attempt)) return;
      if (result.ok && !result.value.closed) this.cancel(requestId);
      else if (!result.ok) this.hooks.error(result.error.code);
    } catch {
      if (this.current(attempt)) this.hooks.error('OPERATION_UNKNOWN');
    }
  }
  async retry(requestId: string) {
    const attempt = this.attempt;
    if (attempt?.id === requestId) await this.prepare(attempt);
  }
  async discard(requestId: string) {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== requestId) return;
    // Main confirms before closing. Keep the buffer and retained drafts intact
    // so cancellation cannot turn a close request into a destructive edit.
    await this.finish(attempt, 'discard');
  }
}
