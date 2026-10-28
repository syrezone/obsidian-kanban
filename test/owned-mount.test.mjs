import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';

// Exercise the real mount/save/dispose implementation. DOM, Obsidian events,
// and the Preact renderer are host boundaries; live editor tests remain required.
const built = await build({
  entryPoints: [new URL('../src/KanbanEmbed.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'host-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(obsidian|\.\/KanbanBoard|\.\/helpers)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class Notice { constructor(message) { globalThis.notices.push(message); } }
      export class TFile {}
      export function setIcon() {}
      export function hasFrontmatterKeyRaw(text) { return text.startsWith('kanban:'); }
      export class KanbanBoard {
        events = []; editorCommits = new Set(); rendered = Promise.resolve();
        constructor(plugin, owner) { this.plugin = plugin; this.owner = owner; }
        get file() { return this.owner.file; }
        get isPrimary() { return this.plugin.manager.getAView() === this; }
        get data() { return this.owner.data; } set data(value) { this.owner.data = value; }
        registerEvent(unregister) { this.events.push(unregister); }
        refreshGeometry() { this.refreshed = true; }
        async setViewData(data) { this.data = data; }
        async flush() {
          const manager = this.plugin.manager;
          for (const view of manager.viewSet) for (const commit of view.editorCommits) commit();
          await manager.getAView().owner.save();
        }
      }
    ` }));
  } }],
});
const { mountKanbanBoard } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
globalThis.notices = [];
globalThis.window = globalThis;

class Element {
  isConnected = true; children = []; inert = false;
  ownerDocument = { defaultView: globalThis };
  createDiv() { const child = new Element(); this.children.push(child); return child; }
  createEl() { return this.createDiv(); }
  remove() { this.isConnected = false; }
}

function fixture() {
  const file = { path: 'board.md', extension: 'md' };
  let disk = 'kanban:original';
  const writes = [], listeners = new Map(), children = new Set();
  const manager = { ready: Promise.resolve(), viewSet: new Set(), getAView() { return this.viewSet.values().next().value; }, hasError: () => false };
  const plugin = {
    embeddedCleanups: new Set(), manager,
    app: { vault: {
      getAbstractFileByPath: path => path === file.path ? file : null,
      read: async () => disk,
      modify: async (_file, data) => { disk = data; writes.push(data); },
      on: (event, fn) => {
        const entries = listeners.get(event) ?? new Set(); entries.add(fn); listeners.set(event, entries);
        return () => entries.delete(fn);
      },
    }, workspace: { getLeaf() { throw new Error('Owned mount must not create a leaf'); } } },
    getStateManager: () => manager.viewSet.size ? manager : undefined,
    addChild: child => { children.add(child); return child; },
    removeChild: child => { children.delete(child); child.events.forEach(fn => fn()); },
    async addView(view) { manager.viewSet.add(view); },
    removeView: view => manager.viewSet.delete(view),
    handleViewFileRename() {},
  };
  return { plugin, file, writes, children, listeners, container: new Element(), setDisk: value => { disk = value; } };
}

test('read-only mount creates no leaf or write; disposal releases component, registrations and listeners', async () => {
  const f = fixture();
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  assert.equal(f.children.size, 1); assert.equal(f.plugin.manager.viewSet.size, 1);
  assert.deepEqual(f.writes, []);
  mount.refreshGeometry(); assert.equal(mount.view.refreshed, true);
  await mount.dispose(); await mount.dispose();
  assert.equal(f.children.size, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.equal(f.plugin.embeddedCleanups.size, 0);
  assert.equal([...f.listeners.values()].every(set => set.size === 0), true);
  assert.equal(f.container.children[0].isConnected, false);
  assert.deepEqual(f.writes, []);
  await assert.rejects(mount.flush(), /disposed/);
});

test('disposal commits drafts and awaits a single in-flight native-owned write before removal', async () => {
  const f = fixture(); let finish;
  f.plugin.app.vault.modify = (_file, data) => new Promise(resolve => { f.writes.push(data); finish = resolve; });
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.view.editorCommits.add(() => { mount.view.data = 'kanban:draft'; });
  const closing = mount.dispose();
  assert.equal(mount.dispose(), closing);
  await Promise.resolve();
  assert.equal(f.children.size, 1); assert.equal(f.container.children[0].inert, true);
  assert.deepEqual(f.writes, ['kanban:draft']);
  finish(); await closing;
  assert.equal(f.children.size, 0);
});

test('write failure preserves mounted board and restores interaction', async () => {
  const f = fixture();
  f.plugin.app.vault.modify = async () => { throw new Error('Disk full'); };
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.view.data = 'kanban:changed';
  await assert.rejects(mount.dispose(), /Disk full/);
  assert.equal(f.children.size, 1); assert.equal(f.plugin.manager.viewSet.size, 1);
  assert.equal(f.container.children[0].inert, false);
  f.plugin.embeddedCleanups.forEach(fn => fn());
});

test('abort or plugin shutdown during file read prevents late mount creation', async () => {
  for (const shutdown of [false, true]) {
    const f = fixture(); let finish;
    f.plugin.app.vault.read = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController();
    const mounting = mountKanbanBoard(f.plugin, f.container, f.file, controller.signal);
    if (shutdown) f.plugin.embeddedCleanups.forEach(fn => fn()); else controller.abort();
    finish('kanban:original');
    await assert.rejects(mounting, /aborted|disposed/);
    assert.equal(f.container.children.length, 0); assert.equal(f.children.size, 0);
    assert.equal(f.plugin.embeddedCleanups.size, 0);
  }
});

test('registration failure rolls back the component and partial registry', async () => {
  const f = fixture();
  f.plugin.addView = async view => { f.plugin.manager.viewSet.add(view); throw new Error('Render failed'); };
  await assert.rejects(mountKanbanBoard(f.plugin, f.container, f.file), /Render failed/);
  assert.equal(f.children.size, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.equal(f.container.children[0].isConnected, false);
});

test('abort during pending registration removes the partial board and prevents a late handle', async () => {
  const f = fixture(); let finish, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.plugin.addView = async view => {
    f.plugin.manager.viewSet.add(view);
    entered();
    await new Promise(resolve => { finish = resolve; });
  };
  const controller = new AbortController();
  const mounting = mountKanbanBoard(f.plugin, f.container, f.file, controller.signal);
  await waiting;
  controller.abort(); finish();
  await assert.rejects(mounting, /aborted|disposed/);
  assert.equal(f.children.size, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.deepEqual(f.writes, []);
});

test('invalid Markdown is rejected without creating a component or writing', async () => {
  const f = fixture(); f.setDisk('ordinary note');
  await assert.rejects(mountKanbanBoard(f.plugin, f.container, f.file), /not a Kanban/);
  assert.equal(f.container.children.length, 0); assert.deepEqual(f.writes, []);
});

test('two embeds share state and only the primary owns the save sink', async () => {
  const f = fixture();
  const first = await mountKanbanBoard(f.plugin, f.container, f.file);
  const second = await mountKanbanBoard(f.plugin, new Element(), f.file);
  first.view.data = second.view.data = 'kanban:shared edit';
  await second.dispose();
  assert.deepEqual(f.writes, ['kanban:shared edit']);
  assert.equal(f.plugin.manager.viewSet.size, 1);
  await first.dispose();
  assert.deepEqual(f.writes, ['kanban:shared edit']);
});

test('external non-Kanban conversion prevents later saving over the note', async () => {
  const f = fixture();
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  f.setDisk('ordinary note');
  f.listeners.get('modify').forEach(fn => fn(f.file));
  await new Promise(resolve => setImmediate(resolve));
  mount.view.data = 'kanban:later edit';
  await assert.rejects(mount.dispose(), /no longer a Kanban/);
  assert.deepEqual(f.writes, []);
  f.plugin.embeddedCleanups.forEach(fn => fn());
});

test('the echo of our own write is not a conflict while newer edits are pending', async () => {
  const f = fixture(); let finish;
  globalThis.notices = [];
  f.plugin.app.vault.modify = (_file, data) => new Promise(resolve => {
    f.setDisk(data); f.writes.push(data); finish = resolve;
  });
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.view.data = 'kanban:first edit';
  const saving = mount.flush();
  await new Promise(resolve => setImmediate(resolve));
  mount.view.data = 'kanban:second edit';
  f.listeners.get('modify').forEach(fn => fn(f.file));
  await new Promise(resolve => setImmediate(resolve));
  finish(); await saving;
  const disposing = mount.dispose();
  await new Promise(resolve => setImmediate(resolve));
  finish(); await disposing;
  assert.deepEqual(f.writes, ['kanban:first edit', 'kanban:second edit']);
  assert.deepEqual(globalThis.notices, []);
});

test('a secondary embed leaves external changes to the primary native tab', async () => {
  const f = fixture(); let nativeSaves = 0;
  f.plugin.manager.viewSet.add({ editorCommits: new Set(), owner: { save: async () => { nativeSaves++; } } });
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.view.data = 'kanban:pending edit';
  f.setDisk('kanban:written by the native tab');
  f.listeners.get('modify').forEach(fn => fn(f.file));
  await new Promise(resolve => setImmediate(resolve));
  await mount.flush();
  assert.equal(nativeSaves, 1);
  assert.deepEqual(f.writes, []);
  f.plugin.embeddedCleanups.forEach(fn => fn());
});
