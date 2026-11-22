import { restoreBackup } from '../../dist/core/local/artifacts.js';
import { Space } from '../../dist/core/index.js';
import { randomUUID } from 'node:crypto';

const value = (result) => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const receipt = value(
  await restoreBackup(process.argv[2], {
    operationId: randomUUID(),
    destination: process.argv[3],
    expectedBackupDigest: process.argv[5],
  }),
);
const space = value(Space.open(process.argv[3]));
try {
  const object = value(
    space.human('runtime-check').readObject({ objectId: process.argv[4] }),
  ).object;
  process.stdout.write(
    JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      body: object.content.body,
      snapshot: receipt.snapshot,
      counts: receipt.counts,
    }),
  );
} finally {
  space.close();
}
