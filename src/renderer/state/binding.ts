import type { SpaceSession } from '../../contracts/app.js';
import type { BoundRequest } from '../../contracts/desktop.js';

export function bound<T>(session: SpaceSession, input: T): BoundRequest<T> {
  return {
    bindingId: session.bindingId,
    spaceId: session.status.spaceId,
    instanceId: session.status.instanceId,
    input,
  };
}

export function sameBinding(a: SpaceSession | null, b: SpaceSession | null): boolean {
  return (
    !!a &&
    !!b &&
    a.bindingId === b.bindingId &&
    a.status.spaceId === b.status.spaceId &&
    a.status.instanceId === b.status.instanceId
  );
}

/** A view-local epoch. A→B→A still invalidates an old A callback. */
export class RequestGate {
  private epoch = 0;
  begin(session: SpaceSession, objectId: string | null = null) {
    const epoch = ++this.epoch;
    return { session, objectId, epoch };
  }
  accepts(
    ticket: ReturnType<RequestGate['begin']>,
    session: SpaceSession | null,
    objectId = ticket.objectId,
  ) {
    return (
      ticket.epoch === this.epoch &&
      sameBinding(ticket.session, session) &&
      ticket.objectId === objectId
    );
  }
  invalidate() {
    this.epoch++;
  }
}
