import type { DesktopApi, SpaceSession } from '../../contracts/app.js';
import type { ObjectSummary } from '../../contracts/core.js';
import type { ErrorCode } from '../../contracts/errors.js';
import { deriveKnowledgeReview } from '../../contracts/knowledge-review.js';
import { bound } from './binding.js';

type Position = { objectId: string; lastOpenedAt: number };
export type RecentItem = Position & {
  summary: ObjectSummary | null;
  error: ErrorCode | null;
  missing: boolean;
  fresh: boolean;
};
type RecentState = { items: RecentItem[]; loading: boolean; storageUnavailable: boolean };
type PositionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);

/** Optional instance-local UI positions. Content authority remains entirely in Core. */
export class RecentWork {
  private positions: Position[] = [];
  private state: RecentState = { items: [], loading: false, storageUnavailable: false };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private active = true;
  private inFlight = 0;
  private slots: (() => void)[] = [];
  private readonly key: string;
  constructor(
    private readonly api: Pick<DesktopApi, 'readObject'>,
    private readonly session: SpaceSession,
    private readonly storage: PositionStorage,
  ) {
    this.key = `agentspace.recent.${session.status.spaceId}.${session.status.instanceId}`;
    try {
      const raw: unknown = JSON.parse(storage.getItem(this.key) ?? 'null');
      if (
        raw &&
        typeof raw === 'object' &&
        'version' in raw &&
        raw.version === 1 &&
        'items' in raw &&
        Array.isArray(raw.items)
      ) {
        for (const item of raw.items.slice(0, 10)) {
          if (
            item &&
            typeof item === 'object' &&
            validId(item.objectId) &&
            Number.isFinite(item.lastOpenedAt) &&
            item.lastOpenedAt >= 0 &&
            Number.isFinite(new Date(item.lastOpenedAt).getTime()) &&
            !this.positions.some((entry) => entry.objectId === item.objectId)
          )
            this.positions.push({ objectId: item.objectId, lastOpenedAt: item.lastOpenedAt });
        }
      }
      if (!raw) {
        const last = storage.getItem(
          `agentspace.position.${session.status.spaceId}.${session.status.instanceId}`,
        );
        if (validId(last)) this.positions.push({ objectId: last, lastOpenedAt: 0 });
      }
    } catch {
      this.state.storageUnavailable = true;
      // Position storage is optional; it never changes the space or retained drafts.
    }
    this.state.items = this.positions.map((position) => this.pending(position));
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private pending(position: Position): RecentItem {
    return { ...position, summary: null, error: null, missing: false, fresh: false };
  }
  private publish(patch: Partial<RecentState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private persist() {
    try {
      this.storage.setItem(this.key, JSON.stringify({ version: 1, items: this.positions }));
    } catch {
      this.publish({ storageUnavailable: true });
      // No authored content, credentials or title is persisted here.
    }
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.epoch++;
    this.slots.splice(0).forEach((resolve) => resolve());
  }
  invalidate() {
    this.epoch++;
    this.publish({
      loading: false,
      items: this.state.items.map((item) => ({ ...item, fresh: false })),
    });
  }
  remember(objectId: string, now = Date.now()) {
    if (!validId(objectId)) return;
    this.invalidate();
    this.positions = [
      { objectId, lastOpenedAt: now },
      ...this.positions.filter((item) => item.objectId !== objectId),
    ].slice(0, 10);
    this.persist();
    const previous = new Map(this.state.items.map((item) => [item.objectId, item]));
    this.publish({
      items: this.positions.map((position) => ({
        ...(previous.get(position.objectId) ?? this.pending(position)),
        ...position,
        fresh: false,
      })),
    });
  }
  remove(objectId: string) {
    this.invalidate();
    this.positions = this.positions.filter((item) => item.objectId !== objectId);
    this.persist();
    this.publish({ items: this.state.items.filter((item) => item.objectId !== objectId) });
  }
  async refresh() {
    const ticket = ++this.epoch;
    const positions = [...this.positions];
    this.publish({ loading: true });
    const items = positions.map((position) => this.pending(position));
    let next = 0;
    const current = () => this.active && ticket === this.epoch;
    const worker = async () => {
      while (current()) {
        const index = next++;
        const position = positions[index];
        if (!position) return;
        while (this.inFlight >= 2 && current())
          await new Promise<void>((resolve) => this.slots.push(resolve));
        if (!current()) return;
        this.inFlight++;
        try {
          const result = await this.api.readObject(
            bound(this.session, { objectId: position.objectId }),
          );
          if (!current()) return;
          if (!result.ok) {
            items[index] = {
              ...this.pending(position),
              error: result.error.code,
              missing: result.error.code === 'NOT_FOUND',
              fresh: true,
            };
            continue;
          }
          const { object, currentRevision } = result.value;
          const review = deriveKnowledgeReview(
            currentRevision,
            object.knowledgeReview?.reviewedRevision ?? null,
          );
          if (
            object.id !== position.objectId ||
            object.spaceId !== this.session.status.spaceId ||
            object.instanceId !== this.session.status.instanceId ||
            !review
          ) {
            items[index] = { ...this.pending(position), error: 'INTEGRITY_FAILURE', fresh: true };
            continue;
          }
          // Keep only the bounded current summary; the temporary full read is not retained.
          items[index] = {
            ...position,
            summary: {
              ref: { mode: 'pinned', objectId: object.id, revision: object.revision },
              title: object.content.title,
              kind: object.kind,
              lifecycle: object.lifecycle,
              digest: object.digest,
              updatedAt: object.createdAt,
              ...review,
            },
            error: null,
            missing: false,
            fresh: true,
          };
        } catch {
          if (!current()) return;
          items[index] = { ...this.pending(position), error: 'OPERATION_UNKNOWN', fresh: true };
        } finally {
          this.inFlight--;
          this.slots.splice(0).forEach((resolve) => resolve());
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, positions.length) }, worker));
    if (current()) this.publish({ items, loading: false });
  }
}
