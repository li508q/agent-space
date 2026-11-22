// Real compiled core, independent SQLite connection. Only the crash barrier instruments COMMIT.
import { DatabaseSync } from 'node:sqlite';
import { Space } from '../../dist/core/index.js';
const [directory, encoded] = process.argv.slice(2);
const options = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
const opened = Space.open(directory);
if (!opened.ok) throw new Error(JSON.stringify(opened));
const human = opened.value.human('desktop-installation');
let armed = false;
const original = DatabaseSync.prototype.exec;
if (options.mode === 'before-commit')
  DatabaseSync.prototype.exec = function (sql) {
    if (armed && sql === 'COMMIT') {
      process.send({ phase: 'before-commit' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    }
    return original.call(this, sql);
  };
process.send({ phase: 'ready' });
process.once('message', () => {
  armed = true;
  const result = human.saveObject(options.input);
  if (options.mode === 'after-commit') {
    process.send({ phase: 'committed-without-result' });
    opened.value.close();
    process.exit(0);
  }
  process.send({ phase: 'result', result });
  opened.value.close();
  process.exit(0);
});
