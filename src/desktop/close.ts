import { randomUUID } from 'node:crypto';
import type { CloseRequest } from '../contracts/app.js';

/** Nonce/binding correlation only; it never guesses that a buffer was saved. */
export class CloseHandshake {
  #pending: { requestId: string; bindingId: string | null } | null = null;
  begin(bindingId: string | null): CloseRequest {
    if (!this.#pending) this.#pending = { requestId: randomUUID(), bindingId };
    return { requestId: this.#pending.requestId };
  }
  valid(requestId: string, bindingId: string | null): boolean {
    return this.#pending?.requestId === requestId && this.#pending.bindingId === bindingId;
  }
  get request(): CloseRequest | null {
    return this.#pending ? { requestId: this.#pending.requestId } : null;
  }
  cancel(): CloseRequest | null {
    const request = this.request;
    this.#pending = null;
    return request;
  }
}
