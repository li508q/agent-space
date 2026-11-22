import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type {
  ChangeSummary,
  DiscoverResult,
  GrantSpec,
  HumanServices,
  ObjectSnapshot,
  OperationStatus,
  ProposalReceipt,
  QueryPage,
  SequencePage,
} from '../../src/contracts/core.js';
import {
  AcceptedChangePageSchema,
  RelationsExpandPageSchema,
  SchemaDescriptionSchema,
  TextSearchPageSchema,
  type AcceptedChangePage,
  type RelationsExpandPage,
  type SchemaDescription,
  type TextSearchPage,
} from '../../src/contracts/context.js';
import type { Result } from '../../src/contracts/errors.js';
import type { ObjectContent, PinnedRef, ReadPage } from '../../src/contracts/schema.js';
import { Space } from '../../src/core/index.js';
import {
  call,
  connect,
  connectAs,
  must,
  protocolFixture,
  toolNames,
  type Connection,
} from './fixtures.js';

const content = (body = '', title = ''): ObjectContent => ({
  title,
  body,
  properties: {},
  relations: [],
});
const pin = (objectId: string, revision: number, locator?: string): PinnedRef => ({
  mode: 'pinned',
  objectId,
  revision,
  ...(locator ? { locator } : {}),
});
const relationId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function create(human: HumanServices, key: string, value: ObjectContent = content()) {
  return must(human.createObject({ operationKey: key, kind: 'document', content: value })).object;
}
function apply(human: HumanServices, proposal: ProposalReceipt, key: string) {
  return must(
    human.reviewProposal({
      operationKey: key,
      proposalId: proposal.id,
      expectedPayloadHash: proposal.payloadHash,
      expectedProposalVersion: proposal.statusVersion,
      decision: 'accept',
      expectedTarget:
        proposal.baseRevision === null
          ? { state: 'absent' }
          : { state: 'revision', revision: proposal.baseRevision },
    }),
  );
}
function bounded<T extends { returnedBytes: number }>(result: Result<T>, maxBytes: number): T {
  const page = must(result);
  assert.equal(
    page.returnedBytes,
    Buffer.byteLength(JSON.stringify(result)),
    'Complete UTF-8 Core Result byte count',
  );
  assert.ok(page.returnedBytes <= maxBytes);
  return page;
}
function denied(result: Result<unknown>, code: string) {
  assert.ok(!result.ok);
  assert.equal(result.error.code, code);
  assert.equal(result.error.retryable, false);
}

for (const era of ['legacy', 'modern'] as const) {
  test(
    `${era}: independent MCP agents discover accepted reasons and exact old evidence without the originating opkey`,
    { timeout: 30_000 },
    async () => {
      const f = protocolFixture();
      const second = must(Space.open(f.directory));
      const human = second.human('protocol-tests:person');
      const sources: ObjectSnapshot[] = [];
      for (let n = 0; n < 12; n++)
        sources.push(
          create(human, `source:${n}`, {
            ...content(
              '项目連携 지식 CAFÉ e\u0301 "OR" -literal · original evidence',
              '证据'.repeat(100),
            ),
            properties: {
              field:
                n % 2
                  ? { label: '数値', type: 'number', value: 0 }
                  : { label: '다른 값', type: 'text', value: '' },
            },
          }),
        );
      for (const revision of [2, 3])
        sources[0] = must(
          human.saveObject({
            operationKey: `source:0:r${revision}`,
            targetId: sources[0]!.id,
            expectedRevision: revision - 1,
            content: {
              ...sources[0]!.content,
              body: `项目連携 지식 CAFÉ e\u0301 "OR" -literal · original evidence at revision ${revision}`,
            },
          }),
        ).object;
      const bSpec: GrantSpec = {
        label: 'Independent context B',
        scope: { mode: 'objects', objectIds: [f.visible.id, ...sources.map((s) => s.id)] },
        capabilities: { read: true, propose: false },
      };
      const bGrant = must(human.createGrant({ operationKey: 'grant:context:B', spec: bSpec }));
      let a: Connection | null = await connect(f, era);
      const b = await connectAs(f, era, bGrant);
      const targetOnly = await connect(f, era, true);
      try {
        assert.equal(b.client.getProtocolEra(), era);
        assert.deepEqual(
          (await b.client.listTools()).tools.map((tool) => tool.name).sort(),
          toolNames,
        );
        const discoverResult = await call<DiscoverResult>(b, 'space_discover', {});
        const discover = must(discoverResult);
        assert.equal(discover.implementedTools.length, 10);
        assert.ok(Buffer.byteLength(JSON.stringify(discoverResult)) <= 8_192);
        assert.ok(!JSON.stringify(discover).includes(sources[0]!.id));
        const catalog = bounded(
          await call<SchemaDescription>(b, 'schema_describe', { kind: 'record', maxBytes: 16_384 }),
          16_384,
        );
        SchemaDescriptionSchema.parse(catalog);
        assert.equal(catalog.propertyModel, 'per-object');
        assert.deepEqual(catalog.kinds, ['record']);
        assert.ok(!JSON.stringify(catalog).includes('数値'));
        for (const text of [
          '项',
          '项目',
          '项目連',
          '連携',
          '지식',
          'CAFÉ',
          'e\u0301',
          '"OR"',
          '-literal',
        ]) {
          const input = { filter: { text }, limit: 50, maxBytes: 65_536 };
          const search = bounded(
            await call<TextSearchPage>(b, 'text_search', input),
            input.maxBytes,
          );
          TextSearchPageSchema.parse(search);
          const query = must(await call<QueryPage>(b, 'objects_query', input));
          assert.deepEqual(search.items, query.items);
          assert.ok(search.items.length >= 12);
        }
        const searchInput = { filter: { text: 'original evidence' }, limit: 50, maxBytes: 4_096 };
        let searchPage = bounded(
          await call<TextSearchPage>(b, 'text_search', searchInput),
          searchInput.maxBytes,
        );
        const searchPins = [...searchPage.items.map((item) => item.ref)];
        assert.ok(searchPage.nextCursor);
        denied(
          await call(b, 'objects_query', { ...searchInput, cursor: searchPage.nextCursor }),
          'INVALID_CURSOR',
        );
        while (searchPage.nextCursor) {
          searchPage = bounded(
            await call<TextSearchPage>(b, 'text_search', {
              ...searchInput,
              cursor: searchPage.nextCursor,
            }),
            searchInput.maxBytes,
          );
          assert.ok(searchPage.items.length > 0);
          searchPins.push(...searchPage.items.map((item) => item.ref));
        }
        assert.equal(searchPins.length, 12);
        assert.equal(new Set(searchPins.map((ref) => ref.objectId)).size, 12);
        const graphPage = bounded(
          await call<RelationsExpandPage>(b, 'relations_expand', {
            seedId: f.visible.id,
            direction: 'outgoing',
            predicates: ['related'],
            maxDepth: 1,
            maxNodes: 10,
            maxEdges: 10,
            maxBytes: 4_096,
          }),
          4_096,
        );
        RelationsExpandPageSchema.parse(graphPage);
        assert.deepEqual(graphPage.edges, []);
        for (const [tool, input] of [
          ['schema_describe', { maxBytes: 16_384 }],
          ['text_search', { filter: { text: '项目' }, limit: 10, maxBytes: 4_096 }],
          [
            'relations_expand',
            {
              seedId: f.visible.id,
              direction: 'outgoing',
              predicates: ['related'],
              maxDepth: 1,
              maxNodes: 10,
              maxEdges: 10,
              maxBytes: 4_096,
            },
          ],
          ['accepted_change_read', { changeId: randomUUID(), section: 'summary', maxBytes: 4_096 }],
        ] as const)
          denied(
            await call(b, tool, { ...input, actor: 'human', sql: 'SELECT 1' }),
            'INVALID_INPUT',
          );
        denied(
          await call(b, 'text_search', { filter: { text: '  ' }, limit: 10, maxBytes: 4_096 }),
          'INVALID_INPUT',
        );
        const candidate = must(
          await call<ProposalReceipt>(a, 'proposal_create', {
            operationKey: 'A-private-opkey-not-given-to-B',
            action: 'update',
            targetId: f.visible.id,
            baseRevision: 1,
            patch: { body: 'Accepted output, relations unchanged.' },
            purpose: 'Continue shared work',
            reason: 'Declared justification retained independently of agent chat',
            sources: [
              ...sources.map((s) => pin(s.id, s.revision, '位'.repeat(240))),
              pin(f.hidden.id, 1, 'PRIVATE_LOCATOR'),
            ],
          }),
        );
        const accepted = apply(human, candidate, 'context:accept');
        sources[0] = must(
          human.saveObject({
            operationKey: 'source:0:r4',
            targetId: sources[0]!.id,
            expectedRevision: 3,
            content: { ...sources[0]!.content, title: 'New head title', body: 'Source revision 4' },
          }),
        ).object;
        await a.close();
        a = null;
        must(
          human.updateGrant({
            operationKey: 'context:revoke:A',
            grantId: f.full.grant.id,
            expectedGeneration: 1,
            spec: f.fullSpec,
            revoked: true,
          }),
        );
        const changes = must(
          await call<SequencePage<ChangeSummary>>(b, 'changes_list', { limit: 50 }),
        ).items;
        assert.deepEqual(
          changes.filter((c) => c.acceptedChangeReadable).map((c) => c.id),
          [accepted.changeId],
        );
        const earlier = changes.find(
          (c) => c.proposalId === candidate.id && !c.acceptedChangeReadable,
        )!;
        assert.ok(earlier);
        denied(
          await call(b, 'accepted_change_read', {
            changeId: earlier.id,
            section: 'summary',
            maxBytes: 8_192,
          }),
          'NOT_FOUND',
        );
        const unknownOp = must(
          await call<OperationStatus>(b, 'operation_status', {
            operationKey: 'A-private-opkey-not-given-to-B',
          }),
        );
        assert.equal(unknownOp.state, 'not_found');
        const summary = bounded(
          await call<AcceptedChangePage>(b, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'summary',
            maxBytes: 32_768,
          }),
          32_768,
        );
        AcceptedChangePageSchema.parse(summary);
        assert.ok(summary.section === 'summary');
        assert.deepEqual(summary.target, pin(f.visible.id, 2));
        assert.deepEqual(summary.base, pin(f.visible.id, 1));
        assert.equal(
          summary.declared.reason,
          'Declared justification retained independently of agent chat',
        );
        assert.equal(summary.evidenceStatus, 'partly-unavailable');
        assert.ok(!JSON.stringify(summary).includes('A-private-opkey'));
        const beforeEvidence = must(human.status()).activitySequence;
        const first = bounded(
          await call<AcceptedChangePage>(b, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'evidence',
            maxBytes: 4_096,
          }),
          4_096,
        );
        AcceptedChangePageSchema.parse(first);
        assert.ok(first.section === 'evidence' && first.nextCursor && first.items.length > 0);
        const tooSmall = await call(b, 'accepted_change_read', {
          changeId: accepted.changeId,
          section: 'evidence',
          maxBytes: 1_024,
        });
        denied(tooSmall, 'LIMIT_EXCEEDED');
        if (!tooSmall.ok) assert.ok(Number(tooSmall.error.params?.requiredBytes) > 1_024);
        const audit = must(human.activity({ after: beforeEvidence, limit: 10 })).items[0]!;
        assert.equal(audit.tool, 'accepted_change_read');
        assert.equal(audit.details.resultKind, 'reference-metadata');
        assert.deepEqual(
          audit.delivered.map((item) => item.ref),
          [first.target, ...first.items.map((item) => item.ref)],
        );
        assert.ok(audit.delivered.every((item) => !item.section));
        const evidence = [...first.items];
        let cursor: string | null = first.nextCursor;
        let end = first.range.endExclusive;
        while (cursor) {
          const page: AcceptedChangePage = bounded(
            await call<AcceptedChangePage>(b, 'accepted_change_read', { cursor, maxBytes: 4_096 }),
            4_096,
          );
          AcceptedChangePageSchema.parse(page);
          assert.ok(page.section === 'evidence' && page.items.length > 0);
          assert.equal(page.range.start, end);
          assert.ok(!('total' in page.range));
          evidence.push(...page.items);
          cursor = page.nextCursor;
          end = page.range.endExclusive;
        }
        assert.equal(evidence.length, 12);
        assert.deepEqual(
          evidence.map((item) => item.ref),
          sources.map((s, n) => pin(s.id, n === 0 ? 3 : 1, '位'.repeat(240))),
        );
        assert.equal(evidence[0]?.currentRevision, 4);
        assert.equal(evidence[0]?.title, '证据'.repeat(100));
        const old = must(
          await call<ReadPage>(b, 'object_read', {
            ref: evidence[0]!.ref,
            section: 'body',
            maxBytes: 4_096,
          }),
        );
        assert.ok(old.section === 'body');
        assert.ok(old.text.includes('evidence at revision 3'));
        const onlyTarget = bounded(
          await call<AcceptedChangePage>(targetOnly, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'evidence',
            maxBytes: 4_096,
          }),
          4_096,
        );
        assert.ok(onlyTarget.section === 'evidence');
        assert.deepEqual(onlyTarget.items, []);
        assert.equal(onlyTarget.unavailableReferences, true);
        for (const secret of [
          sources[0]!.id,
          evidence[0]!.digest,
          evidence[0]!.title,
          'PRIVATE_LOCATOR',
          f.hidden.id,
          f.hidden.content.title,
          f.hidden.digest,
        ]) {
          assert.ok(!JSON.stringify(onlyTarget).includes(secret));
          assert.ok(!JSON.stringify(first).includes(f.hidden.id));
        }
        const targetReason = must(
          await call<AcceptedChangePage>(targetOnly, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'summary',
            maxBytes: 32_768,
          }),
        );
        assert.ok(targetReason.section === 'summary');
        assert.equal(targetReason.evidenceStatus, 'unavailable');
        denied(
          await call(targetOnly, 'object_read', {
            ref: evidence[0]!.ref,
            section: 'body',
            maxBytes: 4_096,
          }),
          'FORBIDDEN',
        );
        denied(
          await call(b, 'relations_expand', { cursor: first.nextCursor, maxBytes: 4_096 }),
          'INVALID_CURSOR',
        );
        denied(
          await call(b, 'accepted_change_read', {
            cursor: first.nextCursor + '!',
            maxBytes: 4_096,
          }),
          'INVALID_CURSOR',
        );
        must(
          human.saveObject({
            operationKey: 'source:1:r2',
            targetId: sources[1]!.id,
            expectedRevision: 1,
            content: content('Newer source'),
          }),
        );
        denied(
          await call(b, 'accepted_change_read', { cursor: first.nextCursor, maxBytes: 4_096 }),
          'CURSOR_STALE',
        );
        const fresh = must(
          await call<AcceptedChangePage>(b, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'evidence',
            maxBytes: 4_096,
          }),
        );
        assert.ok(fresh.section === 'evidence' && fresh.nextCursor);
        assert.equal(fresh.items[0]?.ref.revision, 3);
        const narrowedSpec: GrantSpec = {
          ...bSpec,
          scope: { mode: 'objects', objectIds: [f.visible.id] },
        };
        const narrowed = must(
          human.updateGrant({
            operationKey: 'context:narrow:B',
            grantId: bGrant.grant.id,
            expectedGeneration: 1,
            spec: narrowedSpec,
            revoked: false,
          }),
        );
        denied(
          await call(b, 'accepted_change_read', { cursor: fresh.nextCursor, maxBytes: 4_096 }),
          'CURSOR_STALE',
        );
        const noSources = must(
          await call<AcceptedChangePage>(b, 'accepted_change_read', {
            changeId: accepted.changeId,
            section: 'evidence',
            maxBytes: 4_096,
          }),
        );
        assert.ok(noSources.section === 'evidence');
        assert.deepEqual(noSources.items, []);
        must(
          human.updateGrant({
            operationKey: 'context:revoke:B',
            grantId: bGrant.grant.id,
            expectedGeneration: narrowed.generation,
            spec: narrowedSpec,
            revoked: true,
          }),
        );
        for (const [tool, input] of [
          ['schema_describe', { maxBytes: 16_384 }],
          ['text_search', searchInput],
          [
            'relations_expand',
            {
              seedId: f.visible.id,
              direction: 'outgoing',
              predicates: ['related'],
              maxDepth: 1,
              maxNodes: 10,
              maxEdges: 10,
              maxBytes: 4_096,
            },
          ],
          ['accepted_change_read', { cursor: fresh.nextCursor, maxBytes: 4_096 }],
        ] as const)
          denied(await call(b, tool, input), 'FORBIDDEN');
      } finally {
        await a?.close();
        await b.close();
        await targetOnly.close();
        second.close();
        f.close();
      }
    },
  );
}

for (const era of ['legacy', 'modern'] as const) {
  test(
    `${era}: real MCP relation BFS uses current owners, terminal pins, scoped incoming and one capped paged walk`,
    { timeout: 30_000 },
    async () => {
      const f = protocolFixture();
      const h = f.human;
      const b = create(h, 'graph:B', content('', 'Same name'));
      const c = create(h, 'graph:C', content('', 'Same name'));
      const s = create(h, 'graph:S', content('Old source body', 'Old pinned title'));
      const leaves = Array.from({ length: 12 }, (_, n) =>
        create(h, `graph:leaf:${n}`, content('', '長い名前'.repeat(40))),
      );
      const related = (n: number, objectId: string): ObjectContent['relations'][number] => ({
        id: relationId(n),
        predicate: 'related',
        target: { mode: 'current', objectId },
      });
      const source = (n: number, ref: PinnedRef): ObjectContent['relations'][number] => ({
        id: relationId(n),
        predicate: 'source',
        target: ref,
      });
      must(
        h.saveObject({
          operationKey: 'graph:seed:links',
          targetId: f.visible.id,
          expectedRevision: 1,
          content: {
            ...f.visible.content,
            relations: [
              related(100, b.id),
              source(101, pin(s.id, 1)),
              ...leaves.map((leaf, n) => source(110 + n, pin(leaf.id, 1, '位'.repeat(200)))),
              related(999, f.hidden.id),
            ],
          },
        }),
      );
      must(
        h.saveObject({
          operationKey: 'graph:B:links',
          targetId: b.id,
          expectedRevision: 1,
          content: { ...b.content, relations: [related(200, f.visible.id), related(201, c.id)] },
        }),
      );
      must(
        h.saveObject({
          operationKey: 'graph:S:links',
          targetId: s.id,
          expectedRevision: 1,
          content: { ...s.content, title: 'Source current title', relations: [related(300, c.id)] },
        }),
      );
      must(
        h.saveObject({
          operationKey: 'graph:hidden:links',
          targetId: f.hidden.id,
          expectedRevision: 1,
          content: {
            ...f.hidden.content,
            relations: [related(400, f.visible.id), related(401, c.id)],
          },
        }),
      );
      const spec: GrantSpec = {
        label: 'Scoped graph client',
        scope: {
          mode: 'objects',
          objectIds: [f.visible.id, b.id, c.id, s.id, ...leaves.map((leaf) => leaf.id)],
        },
        capabilities: { read: true, propose: false },
      };
      const issued = must(h.createGrant({ operationKey: 'grant:graph', spec }));
      const connection = await connectAs(f, era, issued);
      const input = {
        seedId: f.visible.id,
        direction: 'outgoing',
        predicates: ['related', 'source'],
        maxDepth: 2,
        maxNodes: 50,
        maxEdges: 50,
        maxBytes: 65_536,
      };
      try {
        const one = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            maxDepth: 1,
          }),
          65_536,
        );
        const two = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', input),
          65_536,
        );
        RelationsExpandPageSchema.parse(two);
        assert.equal(one.edges.length, 14);
        assert.equal(two.edges.length, 16);
        assert.ok(
          two.edges.some(
            (edge) => edge.owner.objectId === b.id && edge.resolvedTarget.objectId === f.visible.id,
          ),
        );
        assert.ok(
          !two.edges.some((edge) => edge.owner.objectId === s.id),
          'Pinned source stays terminal',
        );
        assert.deepEqual(
          two.edges.find((edge) => edge.relation.id === relationId(101))?.resolvedTarget,
          pin(s.id, 1),
        );
        assert.equal(two.unavailableReferences, true);
        for (const secret of [
          f.hidden.id,
          f.hidden.content.title,
          f.hidden.digest,
          relationId(400),
        ])
          assert.ok(!JSON.stringify(two).includes(secret));
        const incoming = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            direction: 'incoming',
            maxDepth: 1,
          }),
          65_536,
        );
        assert.deepEqual(
          incoming.edges.map((edge) => edge.owner.objectId),
          [b.id],
        );
        assert.equal(
          incoming.unavailableReferences,
          false,
          'Hidden incoming owners do not reveal their existence',
        );
        const oldIdentity = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            seedId: s.id,
            direction: 'incoming',
            maxDepth: 1,
          }),
          65_536,
        );
        assert.deepEqual(oldIdentity.seed.ref, pin(s.id, 2));
        assert.deepEqual(oldIdentity.edges[0]?.resolvedTarget, pin(s.id, 1));
        const incomingTwo = must(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            seedId: s.id,
            direction: 'incoming',
          }),
        );
        assert.deepEqual(
          incomingTwo.edges.map((edge) => edge.relation.id),
          [relationId(101), relationId(200)],
        );
        assert.deepEqual(
          incomingTwo.edges.map((edge) => edge.depth),
          [1, 2],
        );
        const before = must(h.status()).activitySequence;
        const first = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            maxEdges: 10,
            maxBytes: 4_096,
          }),
          4_096,
        );
        assert.ok(first.nextCursor && first.edges.length > 0 && first.edges.length < 10);
        assert.deepEqual(first.stopReasons, ['max-edges']);
        assert.equal(first.traversalCompleteWithinScope, false);
        const audit = must(h.activity({ after: before, limit: 1 })).items[0]!;
        assert.deepEqual(
          audit.delivered.map((item) => item.ref),
          first.nodes.map((node) => node.ref),
        );
        assert.ok(audit.delivered.every((item) => !item.section));
        const edges = [...first.edges];
        let cursor: string | null = first.nextCursor;
        while (cursor) {
          const page: RelationsExpandPage = bounded(
            await call<RelationsExpandPage>(connection, 'relations_expand', {
              cursor,
              maxBytes: 4_096,
            }),
            4_096,
          );
          RelationsExpandPageSchema.parse(page);
          assert.ok(page.edges.length > 0);
          assert.equal(page.traversalCompleteWithinScope, false);
          edges.push(...page.edges);
          cursor = page.nextCursor;
        }
        assert.equal(edges.length, 10);
        assert.equal(new Set(edges.map((edge) => edge.relation.id)).size, 10);
        const capped = bounded(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            maxNodes: 2,
          }),
          65_536,
        );
        assert.equal(capped.nodes.length, 2);
        assert.deepEqual(capped.stopReasons, ['max-nodes']);
        const tiny = await call(connection, 'relations_expand', { ...input, maxBytes: 1_024 });
        denied(tiny, 'LIMIT_EXCEEDED');
        if (!tiny.ok) assert.ok(Number(tiny.error.params?.requiredBytes) > 1_024);
        denied(
          await call(connection, 'accepted_change_read', {
            cursor: first.nextCursor,
            maxBytes: 4_096,
          }),
          'INVALID_CURSOR',
        );
        denied(
          await call(connection, 'relations_expand', {
            cursor: first.nextCursor + '!',
            maxBytes: 4_096,
          }),
          'INVALID_CURSOR',
        );
        const expandedSpec: GrantSpec = { ...spec, scope: { mode: 'space' } };
        must(
          h.updateGrant({
            operationKey: 'graph:expand-scope',
            grantId: issued.grant.id,
            expectedGeneration: 1,
            spec: expandedSpec,
            revoked: false,
          }),
        );
        denied(
          await call(connection, 'relations_expand', { cursor: first.nextCursor, maxBytes: 4_096 }),
          'CURSOR_STALE',
        );
        const expanded = must(
          await call<RelationsExpandPage>(connection, 'relations_expand', input),
        );
        assert.ok(expanded.nodes.some((node) => node.ref.objectId === f.hidden.id));
        const fresh = must(
          await call<RelationsExpandPage>(connection, 'relations_expand', {
            ...input,
            maxBytes: 4_096,
          }),
        );
        assert.ok(fresh.nextCursor);
        create(h, 'graph:authority-change');
        denied(
          await call(connection, 'relations_expand', { cursor: fresh.nextCursor, maxBytes: 4_096 }),
          'CURSOR_STALE',
        );
      } finally {
        await connection.close();
        f.close();
      }
    },
  );
}

test(
  'modern MCP accepted event binding covers creation/undo and excludes earlier, conflict and rejection events',
  { timeout: 20_000 },
  async () => {
    const f = protocolFixture();
    const connection = await connect(f, 'modern');
    try {
      const creation = must(
        await call<ProposalReceipt>(connection, 'proposal_create', {
          operationKey: 'event:create',
          action: 'create',
          purpose: 'Capture',
          reason: 'New independent note',
          sources: [],
          newObject: { id: randomUUID(), kind: 'document', content: content('Candidate') },
        }),
      );
      const created = apply(f.human, creation, 'event:apply-create');
      const first = must(
        await call<AcceptedChangePage>(connection, 'accepted_change_read', {
          changeId: created.changeId,
          section: 'summary',
          maxBytes: 8_192,
        }),
      );
      assert.ok(first.section === 'summary');
      assert.equal(first.base, null);
      assert.equal(first.target.revision, 1);
      must(
        f.human.undoChange({
          operationKey: 'event:undo',
          changeId: created.changeId,
          expectedRevision: 1,
        }),
      );
      const after = must(
        await call<AcceptedChangePage>(connection, 'accepted_change_read', {
          changeId: created.changeId,
          section: 'summary',
          maxBytes: 8_192,
        }),
      );
      assert.ok(after.section === 'summary');
      assert.deepEqual(after.target, first.target);
      assert.equal(after.currentTargetRevision, 2);
      const stale = must(
        await call<ProposalReceipt>(connection, 'proposal_create', {
          operationKey: 'event:stale',
          action: 'update',
          targetId: f.visible.id,
          baseRevision: 1,
          patch: { body: 'Stale' },
          purpose: 'Purpose',
          reason: 'Reason',
          sources: [],
        }),
      );
      must(
        f.human.saveObject({
          operationKey: 'event:human-save',
          targetId: f.visible.id,
          expectedRevision: 1,
          content: { ...f.visible.content, body: 'Human later edit' },
        }),
      );
      const conflict = apply(f.human, stale, 'event:conflict');
      assert.equal(conflict.outcome, 'conflicted');
      must(
        f.human.reviewProposal({
          operationKey: 'event:reject',
          proposalId: stale.id,
          expectedPayloadHash: stale.payloadHash,
          expectedProposalVersion: conflict.proposal.statusVersion,
          decision: 'reject',
        }),
      );
      const changes = must(
        await call<SequencePage<ChangeSummary>>(connection, 'changes_list', { limit: 50 }),
      ).items;
      assert.deepEqual(
        changes.filter((change) => change.acceptedChangeReadable).map((change) => change.id),
        [created.changeId],
      );
      for (const change of changes.filter((change) => !change.acceptedChangeReadable))
        denied(
          await call(connection, 'accepted_change_read', {
            changeId: change.id,
            section: 'summary',
            maxBytes: 8_192,
          }),
          'NOT_FOUND',
        );
    } finally {
      await connection.close();
      f.close();
    }
  },
);

test(
  'modern MCP controlled source-loss fault is aggregate unavailable; corrupt retained JSON is an integrity error',
  { timeout: 20_000 },
  async () => {
    const f = protocolFixture();
    const missing = create(
      f.human,
      'fault:missing',
      content('Retained bytes', 'FAULT_MISSING_TITLE'),
    );
    const available = create(f.human, 'fault:available', content('Other bytes'));
    const connection = await connect(f, 'modern');
    const fault = new DatabaseSync(join(f.directory, 'space.sqlite'));
    try {
      const candidate = must(
        await call<ProposalReceipt>(connection, 'proposal_create', {
          operationKey: 'fault:proposal',
          action: 'update',
          targetId: f.visible.id,
          baseRevision: 1,
          patch: { body: 'Accepted' },
          purpose: 'Purpose',
          reason: 'Reason',
          sources: [pin(missing.id, 1, 'FAULT_LOCATOR'), pin(available.id, 1)],
        }),
      );
      const accepted = apply(f.human, candidate, 'fault:accept');
      must(
        f.human.saveObject({
          operationKey: 'fault:head',
          targetId: missing.id,
          expectedRevision: 1,
          content: content('New head'),
        }),
      );
      // Deliberately bypass immutable-revision protection only in this isolated synthetic fault DB.
      fault.exec(
        'PRAGMA foreign_keys=OFF; DROP TRIGGER immutable_revision_delete; DROP TRIGGER immutable_revision_update;',
      );
      fault.prepare('DELETE FROM revisions WHERE object_id=? AND revision=1').run(missing.id);
      const summary = must(
        await call<AcceptedChangePage>(connection, 'accepted_change_read', {
          changeId: accepted.changeId,
          section: 'summary',
          maxBytes: 8_192,
        }),
      );
      assert.ok(summary.section === 'summary');
      assert.equal(summary.evidenceStatus, 'partly-unavailable');
      const evidence = bounded(
        await call<AcceptedChangePage>(connection, 'accepted_change_read', {
          changeId: accepted.changeId,
          section: 'evidence',
          maxBytes: 8_192,
        }),
        8_192,
      );
      assert.ok(evidence.section === 'evidence');
      assert.equal(evidence.unavailableReferences, true);
      assert.deepEqual(
        evidence.items.map((item) => item.ref),
        [pin(available.id, 1)],
      );
      for (const hidden of [missing.id, missing.digest, missing.content.title, 'FAULT_LOCATOR'])
        assert.ok(!JSON.stringify(evidence).includes(hidden));
      fault
        .prepare(
          "UPDATE revisions SET content_json='invalid json' WHERE object_id=? AND revision=1",
        )
        .run(available.id);
      denied(
        await call(connection, 'accepted_change_read', {
          changeId: accepted.changeId,
          section: 'evidence',
          maxBytes: 8_192,
        }),
        'INTEGRITY_FAILURE',
      );
    } finally {
      fault.close();
      await connection.close();
      f.close();
    }
  },
);
