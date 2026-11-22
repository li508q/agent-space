import { readFileSync } from 'node:fs';
import { Space } from '../../dist/core/index.js';
const opened = Space.open(process.argv[2]);
if (!opened.ok) throw new Error(opened.error.code);
const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const result = opened.value.human('desktop-installation').commitImportItem(request);
opened.value.close();
if (process.argv[4] !== 'silent') process.stdout.write(JSON.stringify(result));
