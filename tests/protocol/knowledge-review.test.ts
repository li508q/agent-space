import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryPage, SchemaDescription } from '../../src/contracts/core.js';
import type { ReadPage } from '../../src/contracts/schema.js';
import { SchemaDescriptionSchema, TextSearchPageSchema } from '../../src/contracts/context.js';
import { call, connect, connectAs, must, protocolFixture } from './fixtures.js';

for (const era of ['legacy', 'modern'] as const) {
  test(
    `${era}: independent MCP connections share current-head review filters and exact historical summaries`,
    { timeout: 30_000 },
    async () => {
      const f = protocolFixture();
      const pin = (objectId: string, revision: number) => ({
        mode: 'pinned' as const,
        objectId,
        revision,
      });
      const second = must(
        f.human.createObject({
          operationKey: 'review:second',
          kind: 'document',
          content: { ...f.visible.content, title: 'Second reviewed material' },
        }),
      ).object;
      for (const object of [f.visible, second]) {
        must(
          f.human.markKnowledgeReviewed({
            operationKey: `review:${object.id}`,
            ref: pin(object.id, 1),
          }),
        );
        must(
          f.human.saveObject({
            operationKey: `advance:${object.id}`,
            targetId: object.id,
            expectedRevision: 1,
            content: { ...object.content, body: '知识 second revision' },
          }),
        );
      }
      const spec = {
        label: 'Independent review reader',
        scope: { mode: 'objects' as const, objectIds: [f.visible.id, second.id] },
        capabilities: { read: true, propose: false },
      };
      const grant = must(f.human.createGrant({ operationKey: 'grant:review:B', spec }));
      const a = await connect(f, era);
      const b = await connectAs(f, era, grant);
      try {
        const catalogue = must(
          await call<SchemaDescription>(b, 'schema_describe', { maxBytes: 16_384 }),
        );
        SchemaDescriptionSchema.parse(catalogue);
        assert.equal(catalogue.definitionsVersion, 2);
        assert.ok(catalogue.filterKeys.includes('knowledgeReviewStates'));
        const tools = await b.client.listTools();
        assert.ok(
          JSON.stringify(
            tools.tools.find((tool) => tool.name === 'objects_query')?.inputSchema,
          ).includes('knowledgeReviewStates'),
        );
        assert.ok(!tools.tools.some((tool) => tool.name === 'markKnowledgeReviewed'));
        const input = {
          filter: { text: '知', knowledgeReviewStates: ['changed-since-review'] },
          limit: 50,
          maxBytes: 4096,
        };
        for (const connection of [a, b]) {
          const result = await call<QueryPage>(connection, 'objects_query', input);
          const page = must(result);
          assert.equal(page.returnedBytes, Buffer.byteLength(JSON.stringify(result)));
          assert.ok(page.returnedBytes <= input.maxBytes);
          assert.deepEqual(
            new Set(page.items.map((item) => item.ref.objectId)),
            new Set([f.visible.id, second.id]),
          );
          assert.ok(
            page.items.every(
              (item) =>
                item.currentRevision === 2 &&
                item.knowledgeReviewedRevision === 1 &&
                item.knowledgeReviewState === 'changed-since-review',
            ),
          );
          const search = must(await call<QueryPage>(connection, 'text_search', input));
          TextSearchPageSchema.parse(search);
          assert.deepEqual(search.items, page.items);
        }
        const paging = {
          ...input,
          filter: { text: '知', knowledgeReviewStates: ['changed-since-review', 'never-reviewed'] },
          limit: 1,
        };
        const first = must(await call<QueryPage>(b, 'objects_query', paging));
        assert.ok(first.nextCursor);
        const continuation = must(
          await call<QueryPage>(b, 'objects_query', {
            ...paging,
            filter: {
              text: '知',
              knowledgeReviewStates: ['never-reviewed', 'changed-since-review'],
            },
            cursor: first.nextCursor,
          }),
        );
        assert.equal(continuation.items.length, 1);
        const changedSet = await call(b, 'objects_query', {
          ...paging,
          filter: input.filter,
          cursor: first.nextCursor,
        });
        assert.ok(!changedSet.ok && changedSet.error.code === 'INVALID_CURSOR');
        const before = must(f.human.status()).authoritySequence;
        const historical = must(
          await call<ReadPage>(b, 'object_read', {
            ref: pin(f.visible.id, 1),
            section: 'summary',
            maxBytes: 4096,
          }),
        );
        assert.ok(historical.section === 'summary');
        assert.equal(historical.title, f.visible.content.title);
        assert.equal(historical.digest, f.visible.digest);
        assert.equal(historical.ref.revision, 1);
        assert.equal(historical.currentRevision, 2);
        assert.equal(historical.knowledgeReviewState, 'changed-since-review');
        assert.equal(must(f.human.status()).authoritySequence, before);
        must(
          f.human.markKnowledgeReviewed({
            operationKey: 'review:current',
            ref: pin(f.visible.id, 2),
          }),
        );
        const stale = await call(b, 'objects_query', { ...paging, cursor: first.nextCursor });
        assert.ok(!stale.ok && stale.error.code === 'CURSOR_STALE');
        const fresh = must(
          await call<ReadPage>(b, 'object_read', {
            ref: pin(f.visible.id, 1),
            section: 'summary',
            maxBytes: 4096,
          }),
        );
        assert.ok(fresh.section === 'summary');
        assert.equal(fresh.knowledgeReviewState, 'current-reviewed');
        assert.equal(fresh.knowledgeReviewedRevision, 2);
        assert.equal(fresh.digest, historical.digest);
        for (const states of [[], null, ['unknown'], ['never-reviewed', 'never-reviewed']]) {
          const invalid = await call(b, 'objects_query', {
            ...input,
            filter: { knowledgeReviewStates: states },
          });
          assert.ok(!invalid.ok && invalid.error.code === 'INVALID_INPUT');
        }
        const never = must(
          await call<QueryPage>(b, 'objects_query', {
            ...input,
            filter: { knowledgeReviewStates: ['never-reviewed'] },
          }),
        );
        assert.deepEqual(never.items, []);
        must(
          f.human.updateGrant({
            operationKey: 'revoke:review:B',
            grantId: grant.grant.id,
            expectedGeneration: 1,
            spec,
            revoked: true,
          }),
        );
        const denied = await call(b, 'objects_query', input);
        assert.ok(!denied.ok && denied.error.code === 'FORBIDDEN');
      } finally {
        await a.close();
        await b.close();
        f.close();
      }
    },
  );
}
