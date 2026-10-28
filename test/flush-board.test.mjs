import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';

const result = await build({
  entryPoints: [new URL('../src/helpers/flushBoard.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { flushBoard } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture() {
  const events = [];
  const primary = { editorCommits: new Set([() => events.push('commit-primary')]), async save() { events.push('saved'); } };
  const secondary = { editorCommits: new Set([() => events.push('commit-secondary')]), async save() { throw new Error('Second writer used'); } };
  return { events, primary, secondary, manager: {
    viewSet: new Set([primary, secondary]), hasError: () => false,
    getAView: () => primary, saveToDisk: () => events.push('serialize'),
  } };
}

test('all shared editors commit before serialization; only the native primary saves', async () => {
  const { manager, events } = fixture();
  await flushBoard(manager);
  assert.deepEqual(events, ['commit-primary', 'commit-secondary', 'serialize', 'saved']);
});

test('flush remains pending until the native save resolves', async () => {
  const { manager, primary, events } = fixture();
  let finish;
  primary.save = () => new Promise(resolve => { finish = resolve; });
  let done = false;
  const flushing = flushBoard(manager).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(events.at(-1), 'serialize');
  finish(); await flushing;
  assert.equal(done, true);
});

test('native write failures propagate to the owner', async () => {
  const { manager, primary } = fixture();
  primary.save = async () => { throw new Error('Disk full'); };
  await assert.rejects(flushBoard(manager), /Disk full/);
});

test('invalid boards do not commit or write; commit errors do not reach the writer', async () => {
  const { manager, events, primary } = fixture();
  manager.hasError = () => true;
  await assert.rejects(flushBoard(manager), /parse errors/);
  assert.deepEqual(events, []);
  manager.hasError = () => false;
  primary.editorCommits = new Set([() => { throw new Error('Invalid edit'); }]);
  await assert.rejects(flushBoard(manager), /Invalid edit/);
  assert.deepEqual(events, []);
});

test('a missing writer is reported instead of claiming a completed save', async () => {
  const { manager } = fixture();
  manager.getAView = () => undefined;
  await assert.rejects(flushBoard(manager), /without a native writer/);
});
