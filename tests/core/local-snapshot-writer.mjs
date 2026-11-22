import { Space } from '../../dist/core/index.js';
import { writeFileSync } from 'node:fs';
const opened = Space.open(process.argv[2]);
if (!opened.ok) throw new Error(opened.error.code);
const human = opened.value.human('concurrent-backup-writer');
process.on('message', () => {
  const read = human.readObject({ objectId: process.argv[3] });
  if (!read.ok) throw new Error(read.error.code);
  const result = human.saveObject({
    operationKey: 'during-backup',
    targetId: read.value.object.id,
    expectedRevision: read.value.object.revision,
    content: { ...read.value.object.content, body: 'Written by another process during backup' },
  });
  if (!result.ok) throw new Error(result.error.code);
  writeFileSync(process.argv[4], 'committed');
  opened.value.close();
  process.exit(0);
});
process.send('ready');
