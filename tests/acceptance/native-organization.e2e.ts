import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createAcceptanceFixture, requireSuccess } from './fixtures.js';
import { launchNative } from './native-harness.js';
import { t, type Locale } from '../../src/renderer/i18n/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function eventually(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(50);
  }
  assert.fail(message);
}

test(
  'native project organization and typed records preserve one identity and authored definitions',
  { skip: process.platform !== 'darwin', timeout: 60_000 },
  async () => {
    const fixture = createAcceptanceFixture();
    const native = await launchNative({
      entry: root,
      userData: join(fixture.root, 'Organization'),
    });
    try {
      await native.focus();
      await native.chooseNextFolder(fixture.directory);
      await native.page.getByTestId('open-space').click();
      await native.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1440, height: 900 }),
      );
      const locale = (await native.page.locator('html').getAttribute('lang')) as Locale;
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.sample}`).click();
      await native.page.getByTestId('record-edit-fields').click();
      let form = native.page.getByTestId('properties-editor');
      await form
        .getByTestId('field-attempts')
        .getByTestId('field-label')
        .fill('実施回数 / 执行次数');
      await form.getByTestId('add-field').click();
      const added = form.locator('[data-testid^="field-f_"]').last();
      const fieldId = (await added.getAttribute('data-testid'))!.slice('field-'.length);
      await added.getByTestId('field-label').fill('Outcome / 结果');
      await added.getByTestId('field-type').selectOption('select');
      await added.getByTestId('field-option').first().fill('Keep');
      await added.getByRole('button', { name: t(locale, 'fields.addOption'), exact: true }).click();
      await added.getByTestId('field-option').last().fill('Investigate');
      await added.getByTestId('field-unset').uncheck();
      await added.getByTestId('field-value').selectOption('Keep');
      await form.getByTestId('apply-fields').click();
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.sample })).object.content
            .properties.attempts?.label === '実施回数 / 执行次数',
        'An authored label rename must save without changing the stable field key.',
      );
      let record = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.sample }),
      ).object;
      assert.equal(record.content.properties.attempts!.value, 0);
      assert.equal(record.content.properties.error_rate!.value, null);
      assert.equal(record.content.properties.observation!.value, '');
      assert.equal(record.content.properties.checked!.value, false);
      assert.deepEqual(record.content.properties[fieldId], {
        label: 'Outcome / 结果',
        type: 'select',
        options: ['Keep', 'Investigate'],
        value: 'Keep',
      });

      await native.page.getByTestId('record-edit-fields').click();
      form = native.page.getByTestId('properties-editor');
      await form.getByTestId('field-observed_on').getByTestId('field-value').fill('2026-02-30');
      await form.getByTestId('apply-fields').click();
      await form.getByText(t(locale, 'fields.dateError'), { exact: true }).waitFor();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.sample })).object.revision,
        record.revision,
      );
      await form.getByTestId('field-observed_on').getByTestId('field-value').fill('2026-02-28');
      await form.getByTestId('apply-fields').click();
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(fixture.human.readObject({ objectId: fixture.ids.sample })).object.content
            .properties.observed_on?.value === '2026-02-28',
        'A valid authored calendar date must persist.',
      );
      record = requireSuccess(fixture.human.readObject({ objectId: fixture.ids.sample })).object;

      await native.page.getByTestId('record-reuse-fields').click();
      await eventually(
        () =>
          requireSuccess(
            fixture.human.query({
              filter: { kind: 'record' },
              limit: 10,
              maxBytes: 8192,
            }),
          ).items.some((item) => item.ref.objectId !== record.id),
        'Reusing definitions must create a persisted record before entering its title.',
      );
      await native.page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)?.value ===
          '',
      );
      await native.page.getByTestId('document-title').fill('A second observation');
      await native.page.getByTestId('save-now').click();
      let copiedId = '';
      await eventually(() => {
        const page = requireSuccess(
          fixture.human.query({
            filter: { kind: 'record', text: 'A second observation' },
            limit: 10,
            maxBytes: 8192,
          }),
        );
        copiedId = page.items[0]?.ref.objectId ?? '';
        return !!copiedId;
      }, 'Reusing definitions must create a distinct persisted record.');
      assert.notEqual(copiedId, record.id);
      const copied = requireSuccess(fixture.human.readObject({ objectId: copiedId })).object;
      assert.equal(copied.kind, 'record');
      assert.deepEqual(
        Object.keys(copied.content.properties).sort(),
        Object.keys(record.content.properties).sort(),
      );
      assert.ok(Object.values(copied.content.properties).every((field) => field.value === null));
      assert.deepEqual(copied.content.relations, []);
      assert.equal(copied.content.properties.attempts!.label, '実施回数 / 执行次数');

      await native.page.getByTestId('nav-library').click();
      await native.page
        .getByRole('combobox', { name: t(locale, 'ui.type'), exact: true })
        .selectOption('record');
      await native.page.getByTestId('show-record-table').click();
      const table = native.page.getByTestId('records-table');
      await table.getByTestId('table-reference').selectOption(fixture.ids.sample);
      await table.getByRole('columnheader').filter({ hasText: '実施回数 / 执行次数' }).waitFor();
      assert.ok(
        (await table.getByTestId(`record-row-${fixture.ids.sample}`).innerText()).includes('Keep'),
      );
      assert.ok(
        (await table.getByTestId(`record-row-${copiedId}`).innerText()).includes(
          t(locale, 'record.notSet'),
        ),
      );

      await native.page.getByTestId('nav-projects').click();
      await native.page.getByTestId('new-material').click();
      await native.page.getByTestId('new-project').click();
      await eventually(
        () =>
          requireSuccess(
            fixture.human.query({
              filter: { kind: 'project' },
              limit: 10,
              maxBytes: 8192,
            }),
          ).items.some(
            (item) =>
              item.ref.objectId !== fixture.ids.compass &&
              item.ref.objectId !== fixture.ids.fieldNotes,
          ),
        'The new project identity must exist before editing its title.',
      );
      await native.page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="document-title"]') as HTMLInputElement)?.value ===
          '',
      );
      await native.page.getByTestId('document-title').fill('Investigation');
      await native.page
        .getByTestId('markdown-input')
        .fill('Goal: make the evidence understandable.');
      await native.page.getByTestId('save-now').click();
      let projectId = '';
      await eventually(() => {
        const page = requireSuccess(
          fixture.human.query({
            filter: { kind: 'project', text: 'Investigation' },
            limit: 10,
            maxBytes: 8192,
          }),
        );
        projectId = page.items[0]?.ref.objectId ?? '';
        return !!projectId;
      }, 'A new project must be editable and persisted.');
      await native.page.getByTestId('nav-library').click();
      await native.page.getByTestId(`object-row-${fixture.ids.retryPolicy}`).click();
      await native.page.locator('#details-button').click();
      await native.page.getByTestId('edit-relationships').click();
      const relations = native.page.getByTestId('relations-editor');
      await relations.getByTestId(`relationship-target-${projectId}`).check();
      await relations.getByTestId('add-relationship').click();
      await relations.getByTestId('apply-relationships').click();
      await native.page.getByTestId('save-now').click();
      await eventually(
        () =>
          requireSuccess(
            fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
          ).object.content.relations.filter((relation) => relation.predicate === 'belongs_to')
            .length === 3,
        'One note may belong to multiple projects without copies.',
      );
      const note = requireSuccess(
        fixture.human.readObject({ objectId: fixture.ids.retryPolicy }),
      ).object;
      assert.deepEqual(
        note.content.relations.find((relation) => relation.predicate === 'source')?.target,
        { mode: 'pinned', objectId: fixture.ids.measurements, revision: 1 },
      );
      for (const id of [fixture.ids.compass, fixture.ids.fieldNotes, projectId]) {
        const members = requireSuccess(
          fixture.human.query({ filter: { projectId: id }, limit: 50, maxBytes: 32768 }),
        );
        assert.ok(members.items.some((item) => item.ref.objectId === note.id));
      }
      await native.page.getByTestId('nav-projects').click();
      await native.page.getByTestId(`object-row-${projectId}`).click();
      await native.page
        .getByRole('button', { name: t(locale, 'ui.projectMaterial'), exact: true })
        .click();
      await native.page.getByTestId(`object-row-${note.id}`).waitFor();
      assert.equal(
        requireSuccess(fixture.human.readObject({ objectId: fixture.ids.repository })).object.id,
        fixture.ids.repository,
      );
      assert.deepEqual(native.pageErrors, []);
    } finally {
      await native.close();
      fixture.dispose();
    }
  },
);
