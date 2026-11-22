import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { OperationStatus } from '../../contracts/core.js';
import type { Result } from '../../contracts/errors.js';
import { bound } from './binding.js';

export class UnknownOutcome extends Error {
  override readonly name = 'UnknownOutcome';
  constructor() {
    super('The original operation result is not confirmed.');
  }
}

/** Retains one exact request/key. A current proposal is never an original receipt. */
export class OperationTask<T> {
  private pending: Promise<Result<T>> | null = null;
  private result: Result<T> | null = null;
  unknown = false;
  receipt: OperationStatus | null = null;
  get isPending() {
    return this.pending !== null;
  }
  get settled() {
    return this.result !== null;
  }

  constructor(
    private readonly api: Pick<DesktopApi, 'operationStatus'>,
    readonly session: SpaceSession,
    readonly operationKey: string,
    private readonly sendOriginal: () => Promise<Result<T>>,
  ) {}

  run(): Promise<Result<T>> {
    if (this.result) return Promise.resolve(this.result);
    if (this.pending) return this.pending;
    this.pending = this.execute().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async execute(): Promise<Result<T>> {
    try {
      if (this.unknown) {
        const status = await this.api.operationStatus(
          bound(this.session, { operationKey: this.operationKey }),
        );
        if (!status.ok) throw new UnknownOutcome();
        this.receipt = status.value;
        // Both recorded and not_found are followed by exact same-key replay.
        // not_found is not proof of failure. business/currentProposal are never conflated.
      }
      const result = await this.sendOriginal();
      if (!result.ok && result.error.code === 'OPERATION_UNKNOWN') throw new UnknownOutcome();
      this.result = result;
      this.unknown = false;
      return result;
    } catch {
      this.unknown = true;
      throw new UnknownOutcome();
    }
  }
}
