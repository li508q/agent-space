import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { t, type Locale } from '../../src/renderer/i18n/index.js';

type FaultControl = {
  arm(method: string): void;
  snapshot(): { method: string; lost: number; calls: string[] };
};
type TestMain = { __agentSpaceTestFault: FaultControl };
const root = fileURLToPath(new URL('../../', import.meta.url));

test(
  'actual preload structured unknown replays the original committed save before saving newer input',
  {
    skip: process.platform !== 'darwin',
    timeout: 30_000,
  },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Response loss profile'),
      mainRequire: fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url)),
    });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      assert.equal(
        await native.page.evaluate(
          () => typeof (globalThis as unknown as TestMain).__agentSpaceTestFault,
        ),
        'undefined',
      );
      await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.arm('saveObject'),
      );
      const first = 'First human text; the transaction succeeds before its response is lost.';
      const newer = 'Newer human text must remain visible while the original save is checked. 中文';
      await input.fill(first);
      await native.page.getByTestId('save-now').click();
      await native.page
        .getByTestId('save-state')
        .getByText(t(locale, 'editor.checking'), { exact: true })
        .waitFor();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
          .content.body,
        first,
      );
      await input.fill(newer);
      await native.page.getByTestId('save-now').click();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
            .content.body === newer
        )
          break;
        await delay(50);
      }
      const saved = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      assert.equal(saved.content.body, newer);
      assert.equal(saved.revision, 3);
      const observed = await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.snapshot(),
      );
      assert.equal(observed.lost, 1);
      assert.ok(observed.calls.length >= 3);
      assert.equal(
        observed.calls[0],
        observed.calls[1],
        'Recover the original key before creating a request for newer input.',
      );
      assert.notEqual(observed.calls[1], observed.calls[2]);
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy, revision: 2 }))
          .object.content.body,
        first,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);
