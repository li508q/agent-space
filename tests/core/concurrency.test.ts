import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { Result } from '../../src/contracts/errors.js';
import type { WriteResult } from '../../src/contracts/core.js';
import { content, fixture, id, ok } from './helpers.js';

type Message = { phase: string; result?: Result<WriteResult> };
function writer(directory: string, input: unknown, mode = 'normal') {
  const child = fork(
    fileURLToPath(new URL('./worker.mjs', import.meta.url)),
    [directory, Buffer.from(JSON.stringify({ mode, input })).toString('base64url')],
    { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const messages: Message[] = [];
  child.on('message', (m) => messages.push(m as Message));
  const waitFor = async (phase: string): Promise<Message> => {
    for (;;) {
      const present = messages.find((m) => m.phase === phase);
      if (present) return present;
      if (child.exitCode !== null) throw new Error(`Child exited: ${stderr}`);
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw new Error(`Child exited waiting for ${phase}: ${stderr}`);
        }),
      ]);
    }
  };
  return {
    child,
    waitFor,
    go() {
      child.send('go');
    },
  };
}

test(
  'two real processes preserve CAS, canonical idempotency, and crash/response-loss recovery',
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t);
    const h = f.human;
    ok(
      h.createObject({
        operationKey: 'note',
        id: id(1),
        kind: 'document',
        content: content('Initial'),
      }),
    );
    const input = (operationKey: string, expectedRevision: number, body: string) => ({
      operationKey,
      targetId: id(1),
      expectedRevision,
      content: content(body),
      generation: expectedRevision,
    });
    const a = writer(f.directory, input('race:a', 1, 'Writer A'));
    const b = writer(f.directory, input('race:b', 1, 'Writer B'));
    t.after(() => {
      a.child.kill();
      b.child.kill();
    });
    await Promise.all([a.waitFor('ready'), b.waitFor('ready')]);
    a.go();
    b.go();
    const raced = await Promise.all([a.waitFor('result'), b.waitFor('result')]);
    assert.equal(raced.filter((r) => r.result?.ok).length, 1);
    const stale = raced.find((r) => r.result && !r.result.ok)!.result!;
    if (!stale.ok) assert.equal(stale.error.code, 'STALE_REVISION');
    assert.equal(ok(h.readObject({ objectId: id(1) })).object.revision, 2);
    const same = input('same-key', 2, 'Single accepted result');
    const c = writer(f.directory, same);
    const d = writer(f.directory, Object.fromEntries(Object.entries(same).reverse()));
    t.after(() => {
      c.child.kill();
      d.child.kill();
    });
    await Promise.all([c.waitFor('ready'), d.waitFor('ready')]);
    c.go();
    d.go();
    const duplicates = await Promise.all([c.waitFor('result'), d.waitFor('result')]);
    assert.deepEqual(duplicates[0]!.result, duplicates[1]!.result);
    assert.equal(ok(h.readObject({ objectId: id(1) })).object.revision, 3);
    const e = writer(f.directory, input('different-payload', 3, 'First possible payload'));
    const g = writer(f.directory, input('different-payload', 3, 'Different possible payload'));
    t.after(() => {
      e.child.kill();
      g.child.kill();
    });
    await Promise.all([e.waitFor('ready'), g.waitFor('ready')]);
    e.go();
    g.go();
    const different = await Promise.all([e.waitFor('result'), g.waitFor('result')]);
    assert.equal(different.filter((r) => r.result?.ok).length, 1);
    const reused = different.find((r) => r.result && !r.result.ok)!.result!;
    if (!reused.ok) assert.equal(reused.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(ok(h.readObject({ objectId: id(1) })).object.revision, 4);
    const before = ok(h.status());
    const beforeInput = input('killed-before-commit', 4, 'Must roll back');
    const killed = writer(f.directory, beforeInput, 'before-commit');
    t.after(() => killed.child.kill());
    await killed.waitFor('ready');
    killed.go();
    await killed.waitFor('before-commit');
    const exited = once(killed.child, 'exit');
    killed.child.kill('SIGKILL');
    await exited;
    assert.deepEqual(ok(h.status()), before);
    assert.equal(
      ok(h.operationStatus({ operationKey: beforeInput.operationKey })).state,
      'not_found',
    );
    assert.equal(ok(h.readObject({ objectId: id(1) })).object.revision, 4);
    assert.equal(
      ok(h.query({ filter: { text: 'Must roll back' }, limit: 50, maxBytes: 10000 })).items.length,
      0,
    );
    const lostInput = input('committed-no-response', 4, 'Committed before reply');
    const lost = writer(f.directory, lostInput, 'after-commit');
    t.after(() => lost.child.kill());
    await lost.waitFor('ready');
    lost.go();
    await lost.waitFor('committed-without-result');
    const retry = f.open().human('desktop-installation');
    const after = ok(retry.status());
    const receipt = ok(retry.operationStatus({ operationKey: lostInput.operationKey }));
    assert.equal(receipt.state, 'recorded');
    if (receipt.state === 'recorded') {
      assert.equal(receipt.receipt.business?.kind, 'object');
      if (receipt.receipt.business?.kind === 'object') {
        assert.equal(receipt.receipt.business.ref.revision, 5);
        assert.equal(receipt.receipt.business.generation, 4);
      }
    }
    const recovered = ok(retry.saveObject(lostInput));
    assert.equal(recovered.object.revision, 5);
    assert.deepEqual(ok(retry.status()), after);
    assert.equal(ok(h.history({ objectId: id(1), limit: 50 })).items.length, 5);
  },
);
