import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopApi, SpaceSession } from '../../src/contracts/app.js';
import type {
  ProposalPage,
  ProposalStatus,
  ProposalSummary,
  SequencePage,
} from '../../src/contracts/core.js';
import type { Result } from '../../src/contracts/errors.js';
import {
  RecentWindow,
  ProposalLists,
  type WindowRequest,
} from '../../src/renderer/state/change-discovery.js';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const failure = {
  ok: false as const,
  error: { code: 'OPERATION_UNKNOWN' as const, retryable: true },
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const session = (bindingId = 'A'): SpaceSession => ({
  bindingId,
  locationLabel: 'Synthetic',
  status: {
    spaceId: 'space',
    instanceId: 'instance',
    title: 'Synthetic',
    example: true,
    formatVersion: 2,
    coreContractVersion: 2,
    authoritySequence: 120,
    activitySequence: 120,
  },
});
const proposal = (id: string, status: ProposalStatus, statusVersion = 1): ProposalSummary => ({
  id,
  action: 'update',
  targetId: 'target',
  kind: 'document',
  baseRevision: 1,
  payloadHash: 'a'.repeat(64),
  grantId: 'grant',
  status,
  statusVersion,
  resultRevision: status === 'applied' ? 2 : null,
  createdAt: '2026-11-23T00:00:00Z',
  resolvedAt: status === 'applied' || status === 'rejected' ? '2026-11-23T01:00:00Z' : null,
  conflictCode: null,
  purpose: id,
  seen: false,
});
const page = (items: ProposalSummary[], nextAfterId: string | null = null): Result<ProposalPage> =>
  ok({ items, nextAfterId, truncated: nextAfterId !== null });

test('recent changes use contiguous descending windows; failed append retries its exact bounds', async () => {
  const calls: WindowRequest[] = [];
  let fail = false;
  const browser = new RecentWindow(
    async () => ok(120),
    async (request) => {
      calls.push(request);
      if (fail) {
        fail = false;
        return failure;
      }
      return ok({
        items: Array.from(
          { length: request.through - request.after },
          (_, i) => request.after + i + 1,
        ),
        through: request.through,
        nextAfter: null,
        truncated: false,
      });
    },
    (item) => item,
  );
  await browser.load();
  assert.equal(browser.getSnapshot().items[0], 120);
  assert.equal(browser.getSnapshot().items.at(-1), 71);
  fail = true;
  await browser.earlier();
  assert.equal(browser.getSnapshot().error, 'OPERATION_UNKNOWN');
  assert.equal(browser.getSnapshot().lower, 70);
  assert.equal(browser.getSnapshot().items.length, 50);
  await browser.retry();
  await browser.earlier();
  assert.deepEqual(calls, [
    { after: 70, through: 120, limit: 50 },
    { after: 20, through: 70, limit: 50 },
    { after: 20, through: 70, limit: 50 },
    { after: 0, through: 20, limit: 50 },
  ]);
  assert.equal(browser.getSnapshot().items.length, 120);
  assert.equal(new Set(browser.getSnapshot().items).size, 120);
  assert.equal(browser.getSnapshot().lower, 0);
});

test('an empty prepared window advances by bounds, and continuation stays in its original window', async () => {
  const calls: WindowRequest[] = [];
  const browser = new RecentWindow(
    async () => ok(120),
    async (request) => {
      calls.push(request);
      return ok({
        items: request.through === 120 ? [] : [request.after + 1],
        through: request.through,
        nextAfter: request.after === 20 ? 21 : null,
        truncated: request.after === 20,
      });
    },
    (item) => item,
  );
  await browser.load();
  await browser.earlier();
  await browser.earlier();
  assert.deepEqual(
    calls.map(({ after, through }) => [after, through]),
    [
      [70, 120],
      [20, 70],
      [21, 70],
    ],
  );
  assert.equal(browser.getSnapshot().lower, 20);
  await browser.earlier();
  assert.deepEqual(calls.at(-1), { after: 0, through: 20, limit: 50 });
});

test('refresh, tab suspension and a disposed binding cannot publish a delayed window or loading result', async () => {
  const held = deferred<Result<SequencePage<number>>>();
  let count = 0;
  const browser = new RecentWindow(
    async () => ok(120),
    async (request) =>
      ++count === 1
        ? held.promise
        : ok({ items: [120], through: request.through, nextAfter: null, truncated: false }),
    (item) => item,
  );
  const old = browser.load();
  await tick();
  await browser.refresh();
  held.resolve(failure);
  await old;
  assert.deepEqual(browser.getSnapshot().items, [120]);
  assert.equal(browser.getSnapshot().error, null);
  const pending = deferred<Result<SequencePage<number>>>();
  const oldBinding = new RecentWindow(
    async () => ok(10),
    () => pending.promise,
    (item) => item,
  );
  const request = oldBinding.load();
  await tick();
  oldBinding.dispose();
  pending.resolve(ok({ items: [10], through: 10, nextAfter: null, truncated: false }));
  await request;
  assert.deepEqual(oldBinding.getSnapshot().items, []);
  browser.suspend();
  assert.equal(browser.getSnapshot().loading, false);
});

test('processed statuses page independently, keep successful data and retry only the failed cursor', async () => {
  const calls: [ProposalStatus | undefined, string | undefined][] = [];
  let fail = true;
  const api: Pick<DesktopApi, 'listProposals'> = {
    async listProposals(request) {
      const { status, afterId } = request.input;
      calls.push([status, afterId]);
      if (status === 'applied')
        return afterId ? page([proposal('z', 'applied')]) : page([proposal('a', 'applied')], 'a');
      if (status === 'rejected' && fail) {
        fail = false;
        return failure;
      }
      return page(status === 'rejected' ? [proposal('r', 'rejected')] : []);
    },
  };
  const lists = new ProposalLists(api, session());
  await lists.select('processed');
  assert.equal(lists.getSnapshot().groups.applied.items.length, 1);
  assert.equal(lists.getSnapshot().groups.rejected.error, 'OPERATION_UNKNOWN');
  await lists.load('rejected', lists.getSnapshot().groups.rejected.retryMore);
  await lists.load('applied', true);
  assert.deepEqual(calls, [
    ['applied', undefined],
    ['rejected', undefined],
    ['rejected', undefined],
    ['applied', 'a'],
  ]);
  assert.deepEqual(
    lists.getSnapshot().groups.applied.items.map((p) => p.id),
    ['a', 'z'],
  );
});

test('older proposal status versions cannot revive pending membership after a decision', async () => {
  const lists = new ProposalLists(
    {
      listProposals: async (r) =>
        page(r.input.status === 'pending' ? [proposal('a', 'pending', 1)] : []),
    },
    session(),
  );
  await lists.ensure();
  lists.observe(proposal('a', 'applied', 2));
  assert.equal(lists.getSnapshot().groups.pending.items.length, 0);
  await lists.refresh();
  assert.equal(lists.getSnapshot().groups.pending.items.length, 0);
  assert.equal(
    lists.getSnapshot().groups.applied.items.length,
    0,
    'A directly observed detail must not inflate the loaded list count.',
  );
});

test('collection A→B→A and binding disposal ignore old replies including errors', async () => {
  const held = deferred<Result<ProposalPage>>();
  let count = 0;
  const api: Pick<DesktopApi, 'listProposals'> = {
    async listProposals(r) {
      if (r.input.status === 'pending' && count++ === 0) return held.promise;
      return page([]);
    },
  };
  const lists = new ProposalLists(api, session('binding-A'));
  const old = lists.ensure();
  await tick();
  await lists.select('processed');
  await lists.select('unresolved');
  held.resolve(failure);
  await old;
  assert.equal(lists.getSnapshot().collection, 'unresolved');
  assert.equal(lists.getSnapshot().groups.pending.error, null);
  assert.equal(lists.getSnapshot().groups.pending.loading, false);
  const slow = deferred<Result<ProposalPage>>();
  const previous = new ProposalLists({ listProposals: () => slow.promise }, session('old-binding'));
  const pending = previous.ensure();
  previous.dispose();
  const next = new ProposalLists(
    {
      listProposals: async (r) => {
        assert.equal(r.bindingId, 'new-binding');
        return page([]);
      },
    },
    session('new-binding'),
  );
  await next.ensure();
  slow.resolve(page([proposal('old', 'pending')]));
  await pending;
  assert.equal(previous.getSnapshot().groups.pending.items.length, 0);
  assert.equal(next.getSnapshot().groups.pending.items.length, 0);
});
