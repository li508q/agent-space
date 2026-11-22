import { copyFileSync } from 'node:fs';

// Independent test process: replace one synthetic snapshot with another.
copyFileSync(process.argv[2], process.argv[3]);
