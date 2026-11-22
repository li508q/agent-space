import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { bound } from '../../src/renderer/state/binding.js';
import { t, type Locale } from '../../src/renderer/i18n/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
type TestMain = {
  __agentSpaceTestFault: {
    hold(method: string, objectId?: string): void;
    release(): void;
    snapshot(): { held: boolean };
  };
};

test(
  'a delayed native creation cannot silently discard typing in the previous document',
  { skip: process.platform !== 'darwin', timeout: 30_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Navigation'),
      mainRequire: fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url)),
    });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      const input = native.page.getByTestId('markdown-input');
      await input.waitFor();
      const baseline = 'Keep every human word when changing documents.';
      await input.fill(baseline);
      await native.page.getByTestId('save-now').click();
      await native.page.waitForFunction(() =>
        document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
      );
      const original = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      assert.equal(original.content.body, baseline);
      await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.hold('createObject'),
      );
      await native.page.getByTestId('new-note').click();
      let held = false;
      for (let i = 0; i < 100 && !held; i++) {
        held = await native.application.evaluate(
          () => (globalThis as unknown as TestMain).__agentSpaceTestFault.snapshot().held,
        );
        if (!held) await delay(20);
      }
      assert.equal(held, true);
      // A single logical line makes DOM text identical to the authored body;
      // multi-line CodeMirror textContent omits line separators.
      const inputVisible = await input.isVisible();
      if (inputVisible) await input.pressSequentially(' late human input');
      const visible = inputVisible ? (await input.textContent())! : baseline;
      await native.application.evaluate(() =>
        (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
      );
      await native.page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)?.value ===
          '',
      );
      const current = requireSuccess(fixture.human.readObject({ objectId: original.id })).object;
      const session = requireSuccess(await native.bootstrap()).activeSpace!;
      const drafts = requireSuccess(
        await native.page.evaluate(
          (request) => window.agentSpace.listDrafts(request),
          bound(session, { limit: 50 }),
        ),
      );
      let retained = false;
      for (const receipt of drafts.items) {
        if (receipt.target.state !== 'existing' || receipt.target.objectId !== original.id)
          continue;
        const draft = requireSuccess(
          await native.page.evaluate(
            (request) => window.agentSpace.readDraft(request),
            bound(session, { draftId: receipt.draftId }),
          ),
        );
        if (draft.content.body === visible) retained = true;
      }
      if (visible !== original.content.body)
        assert.ok(
          current.content.body === visible || retained,
          'Visible input accepted during navigation must be saved or retained before replacing its editor.',
        );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.application
        .evaluate(() => (globalThis as unknown as TestMain).__agentSpaceTestFault.release())
        .catch(() => {});
      await native.close();
      fixture.dispose();
    }
  },
);

for (const cancel of [false, true]) {
  test(
    cancel
      ? 'cancelled native opening restores editing and rejects its obsolete reply'
      : 'delayed native opening protects the previous editor and unlocks the selected document',
    { skip: process.platform !== 'darwin', timeout: 30_000 },
    async () => {
      const fixture = createAcceptanceFixture();
      const native = await launchNative({
        entry: root,
        userData: join(fixture.root, cancel ? 'Cancelled opening' : 'Delayed opening'),
        mainRequire: fileURLToPath(new URL('./native-ipc-fault.cjs', import.meta.url)),
      });
      try {
        await native.focus();
        await native.chooseNextFolder(fixture.directory);
        await native.page.getByTestId('open-space').click();
        await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
        const input = native.page.getByTestId('markdown-input');
        const baseline = 'A saved one-line note before opening another item.';
        await input.fill(baseline);
        await native.page.getByTestId('save-now').click();
        await native.page.waitForFunction(() =>
          document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
        );
        await native.application.evaluate(
          (_electron, id) =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.hold('readObject', id),
          fixture.ids.measurements,
        );
        await native.page.getByTestId(`object-row-${fixture.ids.measurements}`).click();
        let held = false;
        for (let i = 0; i < 100 && !held; i++) {
          held = await native.application.evaluate(
            () => (globalThis as unknown as TestMain).__agentSpaceTestFault.snapshot().held,
          );
          if (!held) await delay(20);
        }
        assert.equal(held, true);
        const notice = native.page.getByTestId('editor-transition');
        await notice.waitFor();
        if (cancel) {
          const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
          await notice
            .getByRole('button', { name: t(locale, 'common.cancel'), exact: true })
            .click();
          await notice.waitFor({ state: 'hidden' });
          const correction = 'Continue writing after cancelling the pending opening.';
          await input.fill(correction);
          await native.page.getByTestId('save-now').click();
          await native.page.waitForFunction(() =>
            document.querySelector('[data-testid="save-state"]')?.classList.contains('saved'),
          );
          await native.application.evaluate(() =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
          );
          await delay(100);
          assert.equal(
            await native.page.getByTestId('document-title').inputValue(),
            'Retry policy',
          );
          assert.equal(await input.textContent(), correction);
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
              .content.body,
            correction,
          );
        } else {
          if (await input.isVisible()) {
            assert.equal(await input.isEditable(), false);
            await input.pressSequentially(' should not enter');
            assert.equal(await input.textContent(), baseline);
          }
          await native.application.evaluate(() =>
            (globalThis as unknown as TestMain).__agentSpaceTestFault.release(),
          );
          await native.page.waitForFunction(
            () =>
              (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)
                ?.value === 'Measurements',
          );
          await notice.waitFor({ state: 'hidden' });
          assert.equal(await input.isEditable(), true);
          assert.equal(
            requireSuccess(fixture.human.readObject({ objectId: fixture.ids.retryPolicy })).object
              .content.body,
            baseline,
          );
        }
        assert.deepEqual(native.pageErrors, []);
      } finally {
        await native.application
          .evaluate(() => (globalThis as unknown as TestMain).__agentSpaceTestFault.release())
          .catch(() => {});
        await native.close();
        fixture.dispose();
      }
    },
  );
}
