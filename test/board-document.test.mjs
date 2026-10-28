import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// One BoardDocument per file owns its text, saving and external changes for every view.
// The vault and the board host are stubbed; live saving remains a manual check.
const built = await build({
  stdin: {
    contents: `
      export { merge3 } from './src/helpers/merge3';
      export { BoardDocument } from './src/BoardDocument';
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'host-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(obsidian|\.\/helpers)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class Notice { constructor(message) { globalThis.notices.push(message); } }
      export function debounce(fn) {
        const run = () => { run.pending = true; };
        run.cancel = () => { run.pending = false; };
        run.fire = () => { if (run.pending) { run.pending = false; fn(); } };
        return run;
      }
      export function hasFrontmatterKeyRaw(text) { return text.startsWith('kanban'); }
    ` }));
  } }],
});
const { merge3, BoardDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

const lines = (...l) => l.join('\n');

test('merge keeps changes from both sides to different lines', () => {
  const base = lines('a', 'b', 'c', 'd');
  assert.equal(merge3(base, lines('a', 'B', 'c', 'd'), lines('a', 'b', 'c', 'D')), lines('a', 'B', 'c', 'D'));
  assert.equal(merge3(base, lines('a', 'c', 'd'), lines('a', 'b', 'c', 'd', 'e')), lines('a', 'c', 'd', 'e'));
});

test('cards added at the same place on both sides are both kept, ours first', () => {
  const base = lines('## Do', '- [ ] a', '');
  const ours = lines('## Do', '- [ ] a', '- [ ] mine', '');
  const theirs = lines('## Do', '- [ ] a', '- [ ] synced', '');
  assert.equal(merge3(base, ours, theirs), lines('## Do', '- [ ] a', '- [ ] mine', '- [ ] synced', ''));
});

test('the same line changed differently on both sides keeps ours', () => {
  assert.equal(merge3(lines('x', 'a', 'y'), lines('x', 'mine', 'y'), lines('x', 'theirs', 'y')), lines('x', 'mine', 'y'));
  assert.equal(merge3('a', 'a', 'b'), 'b');
  assert.equal(merge3('a', 'b', 'a'), 'b');
});

function fixture(initial = 'kanban\n- [ ] a') {
  globalThis.notices = [];
  const file = { path: 'board.md', basename: 'board' };
  let disk = initial;
  const writes = [];
  const listeners = new Map();
  const vault = {
    getAbstractFileByPath: (path) => (path === file.path && !file.deleted ? file : null),
    read: async () => disk,
    process: async (_file, fn) => {
      if (vault.failNext) { vault.failNext = false; throw new Error('Disk full'); }
      disk = fn(disk);
      writes.push(disk);
      listeners.get('modify')?.forEach((fn) => fn(file));
      return disk;
    },
    on: (event, fn) => {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return { event, fn };
    },
    offref: ({ event, fn }) => listeners.get(event).delete(fn),
  };
  const host = {
    applied: [],
    lost: [],
    async applyText(text, save) { this.applied.push([text, save]); },
    sourceLost(error) { this.lost.push(error.message); },
  };
  const doc = new BoardDocument({ vault }, file, initial, host);
  const external = async (text) => {
    disk = text;
    listeners.get('modify')?.forEach((fn) => fn(file));
    await doc.settled();
  };
  return { doc, host, vault, file, writes, listeners, external, disk: () => disk };
}

test('edits are saved once after the save delay, and the echo of our write is ignored', async () => {
  const f = fixture();
  f.doc.update('kanban\n- [ ] a\n- [ ] b');
  assert.deepEqual(f.writes, []);
  f.doc.requestSave.fire();
  await f.doc.settled();
  assert.deepEqual(f.writes, ['kanban\n- [ ] a\n- [ ] b']);
  assert.deepEqual(f.host.applied, []);
  assert.equal(f.doc.isDirty, false);
});

test('an external change reloads the board when nothing is pending', async () => {
  const f = fixture();
  await f.external('kanban\n- [ ] a\n- [ ] synced');
  assert.deepEqual(f.host.applied, [['kanban\n- [ ] a\n- [ ] synced', false]]);
  assert.equal(f.doc.text, 'kanban\n- [ ] a\n- [ ] synced');
  assert.deepEqual(f.writes, []);
});

test('an external change merges into pending edits, which are then saved', async () => {
  const f = fixture('kanban\n- [ ] a\n- [ ] b');
  f.doc.update('kanban\n- [ ] A\n- [ ] b');
  await f.external('kanban\n- [ ] a\n- [ ] b\n- [ ] synced');
  assert.deepEqual(f.host.applied, [['kanban\n- [ ] A\n- [ ] b\n- [ ] synced', true]]);
  assert.equal(globalThis.notices.length, 1);
  // The host re-serializes the merged board through update(); it differs from disk, so it saves.
  f.doc.update('kanban\n- [ ] A\n- [ ] b\n- [ ] synced');
  await f.doc.save();
  assert.equal(f.disk(), 'kanban\n- [ ] A\n- [ ] b\n- [ ] synced');
});

test('a change on disk not yet seen as an event is merged when saving', async () => {
  const f = fixture('kanban\n- [ ] a\n- [ ] b');
  f.doc.update('kanban\n- [ ] A\n- [ ] b');
  // Written without an event reaching the board yet (e.g. sync wrote just before our save).
  const modify = f.listeners.get('modify');
  f.listeners.delete('modify');
  await f.vault.process(f.file, () => 'kanban\n- [ ] a\n- [ ] b\n- [ ] synced');
  f.listeners.set('modify', modify);
  f.writes.length = 0;
  await f.doc.save();
  assert.deepEqual(f.writes, ['kanban\n- [ ] A\n- [ ] b\n- [ ] synced']);
  assert.deepEqual(f.host.applied, [['kanban\n- [ ] A\n- [ ] b\n- [ ] synced', false]]);
});

test('a source converted away from Kanban or deleted stops saving', async () => {
  const f = fixture();
  f.doc.update('kanban\n- [ ] edit');
  await f.external('ordinary note');
  assert.deepEqual(f.host.lost, ['Source is no longer a Kanban board.']);
  await assert.rejects(f.doc.save(), /no longer a Kanban board/);
  assert.deepEqual(f.writes, []);

  const g = fixture();
  g.doc.update('kanban\n- [ ] edit');
  g.file.deleted = true;
  g.listeners.get('delete').forEach((fn) => fn(g.file));
  assert.deepEqual(g.host.lost, ['Kanban source was deleted.']);
  await assert.rejects(g.doc.save(), /deleted/);
});

test('a failed write is reported, keeps the edits pending and does not block later saves', async () => {
  const f = fixture();
  f.doc.update('kanban\n- [ ] edit');
  f.vault.failNext = true;
  await assert.rejects(f.doc.save(), /Disk full/);
  assert.equal(f.doc.isDirty, true);
  await f.doc.save();
  assert.deepEqual(f.writes, ['kanban\n- [ ] edit']);
});

test('disposal starts a pending save and stops listening', async () => {
  const f = fixture();
  f.doc.update('kanban\n- [ ] last edit');
  f.doc.dispose();
  f.doc.dispose();
  await f.doc.settled();
  assert.deepEqual(f.writes, ['kanban\n- [ ] last edit']);
  assert.equal([...f.listeners.values()].every((set) => set.size === 0), true);
});
