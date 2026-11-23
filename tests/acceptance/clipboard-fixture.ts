import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeHarness } from './native-harness.js';

type ClipboardWrite = { text: string; type: string | null };
type Cleanup = {
  sinkOwnedAtRestore: boolean;
  writeTextRestored: boolean;
  handlerUnchangedByCleanup: boolean;
  handlerSameAsInstalled: boolean;
  hookRemoved: boolean;
  writesCleared: boolean;
  writes: number;
};
type MainSink = {
  readText(): string;
  snapshot(): ClipboardWrite[];
  restore(): Cleanup & { handlerSource: string };
};
export type ClipboardFixture = {
  evidenceDirectory: string;
  readText(): Promise<string>;
  restore(): Promise<Cleanup>;
};

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = process.env.AGENTSPACE_CLIPBOARD_RUN ?? randomUUID();
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw new Error('Invalid clipboard evidence directory.');
const sha256 = (source: string) => createHash('sha256').update(source).digest('hex');

// Only the device changes. Real copyText validation, binding and replies still execute.
const probe = `
const registry = ipcMain._invokeHandlers, channel = 'agentspace:method:copyText';
const handler = registry?.get(channel), originalWriteText = clipboard.writeText;
if (!(registry instanceof Map) || typeof handler !== 'function' || typeof originalWriteText !== 'function')
  throw new Error('The actual copyText handler and clipboard device are required');
if (Function.prototype.toString.call(handler) !== expected.handlerSource ||
    Function.prototype.toString.call(originalWriteText) !== expected.writeTextSource)
  throw new Error('The actual Main boundary changed before device installation');
if (globalThis.__acceptanceClipboardSink) throw new Error('Clipboard sink already installed');
const writes = [], sink = (text, type) => { writes.push({ text, type: type ?? null }); };
clipboard.writeText = sink;
if (clipboard.writeText !== sink || registry.get(channel) !== handler) {
  clipboard.writeText = originalWriteText;
  throw new Error('Clipboard device installation did not preserve the real handler');
}
globalThis.__acceptanceClipboardSink = {
  readText() { return writes.at(-1)?.text ?? ''; },
  snapshot() { return writes.map((write) => ({ ...write })); },
  restore() {
    const currentHandler = registry.get(channel), count = writes.length;
    const sinkOwnedAtRestore = clipboard.writeText === sink;
    clipboard.writeText = originalWriteText;
    writes.length = 0;
    delete globalThis.__acceptanceClipboardSink;
    return { sinkOwnedAtRestore, writeTextRestored: clipboard.writeText === originalWriteText,
      handlerUnchangedByCleanup: registry.get(channel) === currentHandler,
      handlerSameAsInstalled: currentHandler === handler,
      handlerSource: Function.prototype.toString.call(currentHandler),
      hookRemoved: !Object.hasOwn(globalThis, '__acceptanceClipboardSink'),
      writesCleared: writes.length === 0, writes: count };
  }
};
return { handlerUnchangedByInstallation: registry.get(channel) === handler };
`;

export async function readClipboardSink(n: NativeHarness) {
  return n.application.evaluate(() =>
    (
      globalThis as unknown as { __acceptanceClipboardSink: MainSink }
    ).__acceptanceClipboardSink.readText(),
  );
}

export async function snapshotClipboardSink(n: NativeHarness) {
  return n.application.evaluate(() =>
    (
      globalThis as unknown as { __acceptanceClipboardSink: MainSink }
    ).__acceptanceClipboardSink.snapshot(),
  );
}

export async function installClipboardFixture(
  n: NativeHarness,
  label: string,
): Promise<ClipboardFixture> {
  if (!/^[A-Za-z0-9_-]+$/.test(label)) throw new Error('Invalid clipboard fixture label.');
  const original = await n.application.evaluate(({ clipboard, ipcMain }) => {
    const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })
      ._invokeHandlers;
    const handler = registry?.get('agentspace:method:copyText');
    if (typeof handler !== 'function' || typeof clipboard.writeText !== 'function')
      throw new Error('The actual Main copyText boundary is required.');
    return {
      handlerSource: Function.prototype.toString.call(handler),
      writeTextSource: Function.prototype.toString.call(clipboard.writeText),
    };
  });
  const parent = join(root, '.coordination/7D/clipboard-isolation', run);
  mkdirSync(parent, { recursive: true });
  const evidenceDirectory = join(parent, label);
  mkdirSync(evidenceDirectory);
  writeFileSync(join(evidenceDirectory, 'device-probe.js'), probe);
  writeFileSync(
    join(evidenceDirectory, 'provenance.json'),
    JSON.stringify(
      {
        recordedBeforeInstallation: true,
        mainProcessId: n.application.process().pid,
        fixtureSource: 'tests/acceptance/clipboard-fixture.ts',
        fixtureSha256: sha256(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
        probeSha256: sha256(probe),
        copyTextHandlerSha256: sha256(original.handlerSource),
        originalWriteTextSha256: sha256(original.writeTextSource),
        substitution: 'Main clipboard.writeText memory sink; registered handler preserved',
        payloadPersistence: 'memory only',
        systemClipboardReadWriteOrClear: false,
      },
      null,
      2,
    ),
  );
  const installed = await n.application.evaluate(
    ({ clipboard, ipcMain }, input) => {
      return new Function('clipboard', 'ipcMain', 'expected', input.probe)(
        clipboard,
        ipcMain,
        input.original,
      ) as { handlerUnchangedByInstallation: boolean };
    },
    { probe, original },
  );
  try {
    assert.equal(installed.handlerUnchangedByInstallation, true);
    writeFileSync(join(evidenceDirectory, 'installation.json'), JSON.stringify(installed, null, 2));
  } catch (error) {
    await n.application.evaluate(() =>
      (
        globalThis as unknown as { __acceptanceClipboardSink: MainSink }
      ).__acceptanceClipboardSink.restore(),
    );
    throw error;
  }
  return {
    evidenceDirectory,
    readText: () => readClipboardSink(n),
    async restore() {
      const { handlerSource, ...cleanup } = await n.application.evaluate(() =>
        (
          globalThis as unknown as { __acceptanceClipboardSink: MainSink }
        ).__acceptanceClipboardSink.restore(),
      );
      writeFileSync(
        join(evidenceDirectory, 'cleanup.json'),
        JSON.stringify({ ...cleanup, handlerAtCleanupSha256: sha256(handlerSource) }, null, 2),
      );
      assert.equal(cleanup.sinkOwnedAtRestore, true);
      assert.equal(cleanup.writeTextRestored, true);
      assert.equal(cleanup.handlerUnchangedByCleanup, true);
      assert.equal(cleanup.hookRemoved, true);
      assert.equal(cleanup.writesCleared, true);
      return cleanup;
    },
  };
}
