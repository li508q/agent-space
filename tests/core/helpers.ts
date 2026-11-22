import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Result } from '../../src/contracts/errors.js';
import type { GrantSpec, HumanServices } from '../../src/contracts/core.js';
import type { ObjectContent } from '../../src/contracts/schema.js';
import { Space } from '../../src/core/index.js';

export function ok<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(JSON.stringify(result));
  return result.value;
}
export function error(result: Result<unknown>, code: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.error.code, code);
}
export const id = (n: number): string =>
  '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
export const content = (body = '', title = ''): ObjectContent => ({
  title,
  body,
  properties: {},
  relations: [],
});
export function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'agentspace-core-'));
  const directory = join(root, 'space');
  const space = ok(Space.create(directory, { title: 'Synthetic test space' }));
  const spaces = [space];
  t.after(() => {
    for (const s of spaces) {
      try {
        s.close();
      } catch {
        /* Already closed by a restart check. */
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    directory,
    space,
    human: space.human('desktop-installation'),
    open() {
      const s = ok(Space.open(directory));
      spaces.push(s);
      return s;
    },
  };
}
export function agent(
  space: Space,
  human: HumanServices,
  key: string,
  partial: Partial<GrantSpec> = {},
) {
  const spec: GrantSpec = {
    label: 'Configured test client',
    scope: { mode: 'space' },
    capabilities: { read: true, propose: true },
    ...partial,
  };
  const issued = ok(human.createGrant({ operationKey: key, spec }));
  assert.ok(issued.token);
  return {
    api: ok(
      space.agent({
        grantId: issued.grant.id,
        token: issued.token,
        instanceId: ok(human.status()).instanceId,
      }),
    ),
    grant: issued.grant,
    token: issued.token,
    spec,
  };
}
