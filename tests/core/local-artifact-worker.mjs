import { readFileSync } from 'node:fs';
import { createBackup } from '../../dist/core/local/artifacts.js';
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
await createBackup(process.argv[2], request, (progress) => {
  // Test process exits after the consistent copy, before artifact publication.
  if (progress.stage === 'validating') process.exit(0);
});
process.exit(2);
