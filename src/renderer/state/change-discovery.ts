import type { SpaceSession, DesktopApi } from '../../contracts/app.js';
import type { ProposalStatus, ProposalSummary, SequencePage } from '../../contracts/core.js';
import type { ErrorCode, Result } from '../../contracts/errors.js';
import { bound } from './binding.js';

export type WindowRequest = { after: number; through: number; limit: number };
export type WindowState<T> = {
  items: T[];
  lower: number | null;
  upper: number | null;
  nextAfter: number | null;
  loading: boolean;
  error: ErrorCode | null;
};

/** One read-only sequence browser. Numerical windows, not filtered rows, advance it. */
export class RecentWindow<T> {
  private state: WindowState<T> = {
    items: [],
    lower: null,
    upper: null,
    nextAfter: null,
    loading: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private active = true;
  private failed: { request: WindowRequest | null; append: boolean; lower: number } | null = null;
  constructor(
    private readonly latest: () => Promise<Result<number>>,
    private readonly read: (request: WindowRequest) => Promise<Result<SequencePage<T>>>,
    private readonly sequence: (item: T) => number,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<WindowState<T>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  activate() {
    this.active = true;
  }
  suspend() {
    this.epoch++;
    this.publish({ loading: false });
  }
  dispose() {
    this.active = false;
    this.epoch++;
  }
  refresh = () => {
    this.suspend();
    return this.load(false);
  };
  earlier = () => this.load(true);
  retry = () => this.load(this.failed?.append ?? false, this.failed ?? undefined);
  async load(
    append = false,
    retry?: { request: WindowRequest | null; append: boolean; lower: number },
  ) {
    if (!this.active || this.state.loading) return;
    if (append && this.state.lower === 0 && this.state.nextAfter === null) return;
    const ticket = ++this.epoch;
    this.publish({ loading: true, error: null });
    let request = retry?.request ?? null;
    let lower = retry?.lower ?? 0;
    try {
      if (!request) {
        if (append && this.state.lower !== null) {
          if (this.state.nextAfter !== null) {
            lower = this.state.lower;
            request = {
              after: this.state.nextAfter,
              through: this.failedWindowThrough(),
              limit: 50,
            };
          } else {
            const through = this.state.lower;
            lower = Math.max(0, through - 50);
            request = { after: lower, through, limit: 50 };
          }
        } else {
          const result = await this.latest();
          if (!this.active || ticket !== this.epoch) return;
          if (!result.ok) {
            this.failed = { request: null, append, lower };
            this.publish({ error: result.error.code });
            return;
          }
          lower = Math.max(0, result.value - 50);
          request = { after: lower, through: result.value, limit: 50 };
        }
      }
      this.failed = { request, append, lower };
      const result = await this.read(request);
      if (!this.active || ticket !== this.epoch) return;
      if (!result.ok) {
        this.publish({ error: result.error.code });
        return;
      }
      const page = result.value;
      const boundary = request;
      if (
        page.through !== request.through ||
        page.items.some(
          (item) => this.sequence(item) <= boundary.after || this.sequence(item) > boundary.through,
        ) ||
        (page.nextAfter !== null &&
          (page.nextAfter <= request.after || page.nextAfter > request.through))
      ) {
        this.publish({ error: 'INTEGRITY_FAILURE' });
        return;
      }
      const items = new Map(
        (append ? this.state.items : []).map((item) => [this.sequence(item), item]),
      );
      page.items.forEach((item) => items.set(this.sequence(item), item));
      this.publish({
        items: [...items.values()].sort((a, b) => this.sequence(b) - this.sequence(a)),
        lower,
        upper: append ? this.state.upper : request.through,
        nextAfter: page.nextAfter,
        error: null,
      });
    } catch {
      if (this.active && ticket === this.epoch) this.publish({ error: 'OPERATION_UNKNOWN' });
    } finally {
      if (this.active && ticket === this.epoch) this.publish({ loading: false });
    }
  }
  private failedWindowThrough() {
    return this.failed?.request?.through ?? this.state.upper ?? 0;
  }
}

export type ReviewCollection = 'unresolved' | 'processed';
export const collectionStatuses = {
  unresolved: ['pending', 'conflicted'],
  processed: ['applied', 'rejected'],
} as const;
export const collectionFor = (status: ProposalStatus): ReviewCollection =>
  status === 'pending' || status === 'conflicted' ? 'unresolved' : 'processed';
export const proposalStatusKey = {
  pending: 'proposal.pending',
  conflicted: 'proposal.conflicted',
  applied: 'proposal.applied',
  rejected: 'proposal.rejected',
} as const;
export type ProposalListState = {
  items: ProposalSummary[];
  nextAfterId: string | null;
  loading: boolean;
  error: ErrorCode | null;
  loaded: boolean;
  invalidated: boolean;
  retryMore: boolean;
};
const emptyList = (): ProposalListState => ({
  items: [],
  nextAfterId: null,
  loading: false,
  error: null,
  loaded: false,
  invalidated: false,
  retryMore: false,
});

/** Four independent Core cursors. A collection never invents a combined cursor or total. */
export class ProposalLists {
  private state = {
    collection: 'unresolved' as ReviewCollection,
    groups: {
      pending: emptyList(),
      conflicted: emptyList(),
      applied: emptyList(),
      rejected: emptyList(),
    },
  };
  private listeners = new Set<() => void>();
  private active = true;
  private epochs: Record<ProposalStatus, number> = {
    pending: 0,
    conflicted: 0,
    applied: 0,
    rejected: 0,
  };
  private known = new Map<string, ProposalSummary>();
  constructor(
    private readonly api: Pick<DesktopApi, 'listProposals'>,
    private readonly session: SpaceSession,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.state = { ...this.state, groups: { ...this.state.groups } };
    this.listeners.forEach((listener) => listener());
  }
  private patch(status: ProposalStatus, patch: Partial<ProposalListState>) {
    this.state = {
      ...this.state,
      groups: { ...this.state.groups, [status]: { ...this.state.groups[status], ...patch } },
    };
    this.publish();
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.cancel();
  }
  private cancel() {
    for (const status of Object.keys(this.epochs) as ProposalStatus[]) {
      this.epochs[status]++;
      if (this.state.groups[status].loading)
        this.patch(status, { loading: false, invalidated: true });
    }
  }
  select(collection: ReviewCollection) {
    this.cancel();
    this.state = { ...this.state, collection };
    this.publish();
    return this.ensure();
  }
  ensure() {
    return Promise.all(
      collectionStatuses[this.state.collection].map((status) => {
        const group = this.state.groups[status];
        return !group.loaded || group.invalidated ? this.load(status) : Promise.resolve();
      }),
    );
  }
  refresh = () => {
    this.cancel();
    for (const status of Object.keys(this.epochs) as ProposalStatus[])
      this.patch(status, { invalidated: true });
    return this.ensure();
  };
  observe(item: ProposalSummary) {
    const old = this.known.get(item.id);
    if (old && old.statusVersion > item.statusVersion) return;
    this.known.set(item.id, item);
    for (const status of Object.keys(this.epochs) as ProposalStatus[]) {
      const group = this.state.groups[status];
      if (group.items.some((entry) => entry.id === item.id))
        this.patch(status, {
          items: group.items.flatMap((entry) =>
            entry.id !== item.id ? [entry] : item.status === status ? [item] : [],
          ),
        });
    }
  }
  async load(status: ProposalStatus, more = false) {
    const group = this.state.groups[status];
    if (!this.active || group.loading || (more && !group.nextAfterId)) return;
    const ticket = ++this.epochs[status];
    this.patch(status, { loading: true, error: null, retryMore: more });
    try {
      const result = await this.api.listProposals(
        bound(this.session, {
          status,
          limit: 50,
          ...(more ? { afterId: group.nextAfterId! } : {}),
        }),
      );
      if (!this.active || ticket !== this.epochs[status]) return;
      if (!result.ok) {
        this.patch(status, { error: result.error.code });
        return;
      }
      const items = new Map(
        (more ? this.state.groups[status].items : []).map((item) => [item.id, item]),
      );
      for (const item of result.value.items) {
        const known = this.known.get(item.id);
        const latest = known && known.statusVersion > item.statusVersion ? known : item;
        this.observe(latest);
        if (latest.status === status) items.set(latest.id, latest);
        else items.delete(latest.id);
      }
      this.patch(status, {
        items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
        nextAfterId: result.value.nextAfterId,
        loaded: true,
        invalidated: false,
        error: null,
      });
    } catch {
      if (this.active && ticket === this.epochs[status])
        this.patch(status, { error: 'OPERATION_UNKNOWN' });
    } finally {
      if (this.active && ticket === this.epochs[status]) this.patch(status, { loading: false });
    }
  }
}
