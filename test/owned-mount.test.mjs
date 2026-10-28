import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';

// Exercise the real mount/flush/dispose implementation. DOM, Obsidian events, the Preact
// renderer and the file's BoardDocument (tested in board-document.test.mjs) are host
// boundaries; live editor tests remain required. The Component stub follows Obsidian's
// order: children unload first, then registered events, then onunload.
const hosts = {
  obsidian: `
    export class Notice { constructor(message) { globalThis.notices.push(message); } }
    export class TFile {}
    export function setIcon() {}
    export class Component {
      _loaded = false; _children = []; _events = [];
      load() { if (this._loaded) return; this._loaded = true; this.onload(); this._children.forEach(child => child.load()); }
      onload() {}
      unload() {
        if (!this._loaded) return;
        this._loaded = false;
        while (this._children.length) this._children.pop().unload();
        while (this._events.length) this._events.pop()();
        this.onunload();
      }
      onunload() {}
      addChild(child) { this._children.push(child); if (this._loaded) child.load(); return child; }
      removeChild(child) { const index = this._children.indexOf(child); if (index !== -1) { this._children.splice(index, 1); child.unload(); } return child; }
      registerEvent(unregister) { this._events.push(unregister); }
      registerDomEvent() {}
    }
  `,
  './KanbanBoard': `
    import { Component } from 'obsidian';
    export class KanbanBoard extends Component {
      editorCommits = new Set(); rendered = Promise.resolve();
      constructor(plugin, owner) { super(); this.plugin = plugin; this.owner = owner; }
      get file() { return this.owner.file; }
      onunload() { this.plugin.removeView(this); }
      refreshGeometry() { this.refreshed = true; }
      async flush() {
        const manager = this.plugin.manager;
        for (const view of manager.viewSet) for (const commit of view.editorCommits) commit();
        await manager.document.save();
      }
    }
  `,
  './helpers': `export function hasFrontmatterKeyRaw(text) { return text.startsWith('kanban:'); }`,
};
const built = await build({
  entryPoints: [new URL('../src/KanbanEmbed.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'host-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(obsidian|\.\/KanbanBoard|\.\/helpers)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: hosts[path], resolveDir: '.' }));
  } }],
});
const exports = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\nexport { Component };').toString('base64')}`);
const { mountKanbanBoard, Component } = exports;
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
  const writes = [], listeners = new Map();
  // The file's shared document: writes its text when it differs from the last save.
  const document = {
    text: disk, saved: disk,
    async save() { if (this.text !== this.saved) { writes.push(this.text); this.saved = this.text; } },
  };
  const manager = { ready: Promise.resolve(), viewSet: new Set(), document, hasError: () => false };
  const plugin = Object.assign(new Component(), {
    manager,
    app: { vault: {
      getAbstractFileByPath: path => path === file.path ? file : null,
      read: async () => disk,
      on: (event, fn) => {
        const entries = listeners.get(event) ?? new Set(); entries.add(fn); listeners.set(event, entries);
        return () => entries.delete(fn);
      },
    }, workspace: { getLeaf() { throw new Error('Owned mount must not create a leaf'); } } },
    getStateManager: () => manager.viewSet.size ? manager : undefined,
    async addView(view) { manager.viewSet.add(view); },
    removeView: view => manager.viewSet.delete(view),
    handleViewFileRename() {},
  });
  plugin.load();
  return { plugin, file, writes, listeners, document, container: new Element(), setDisk: value => { disk = value; } };
}

test('read-only mount creates no leaf or write; disposal releases component, registrations and listeners', async () => {
  const f = fixture();
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  assert.equal(f.plugin._children.length, 1); assert.equal(f.plugin.manager.viewSet.size, 1);
  assert.deepEqual(f.writes, []);
  mount.refreshGeometry(); assert.equal(mount.board.refreshed, true);
  let closed = false; void mount.closed.then(() => { closed = true; });
  await mount.dispose(); await mount.dispose();
  assert.equal(closed, true);
  assert.equal(f.plugin._children.length, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.equal([...f.listeners.values()].every(set => set.size === 0), true);
  assert.equal(f.container.children[0].isConnected, false);
  assert.deepEqual(f.writes, []);
  await assert.rejects(mount.flush(), /disposed/);
});

test('disposal commits drafts and awaits the document save before removal', async () => {
  const f = fixture(); let finish;
  f.document.save = function () { f.writes.push(this.text); return new Promise(resolve => { finish = resolve; }); };
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.board.editorCommits.add(() => { f.document.text = 'kanban:draft'; });
  const closing = mount.dispose();
  assert.equal(mount.dispose(), closing);
  await Promise.resolve();
  assert.equal(f.plugin._children.length, 1); assert.equal(f.container.children[0].inert, true);
  assert.deepEqual(f.writes, ['kanban:draft']);
  finish(); await closing;
  assert.equal(f.plugin._children.length, 0);
});

test('save failure preserves the mounted board and restores interaction', async () => {
  const f = fixture();
  f.document.save = async () => { throw new Error('Disk full'); };
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  await assert.rejects(mount.dispose(), /Disk full/);
  assert.equal(f.plugin._children.length, 1); assert.equal(f.plugin.manager.viewSet.size, 1);
  assert.equal(f.container.children[0].inert, false);
  f.plugin.unload();
});

test('plugin unload closes a mounted embed without awaiting a save', async () => {
  const f = fixture();
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  f.plugin.unload();
  await mount.closed;
  assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.equal(f.container.children[0].isConnected, false);
  assert.equal([...f.listeners.values()].every(set => set.size === 0), true);
  await assert.rejects(mount.flush(), /disposed/);
});

test('abort or plugin shutdown during file read prevents late mount creation', async () => {
  for (const shutdown of [false, true]) {
    const f = fixture(); let finish;
    f.plugin.app.vault.read = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController();
    const mounting = mountKanbanBoard(f.plugin, f.container, f.file, controller.signal);
    if (shutdown) f.plugin.unload(); else controller.abort();
    finish('kanban:original');
    await assert.rejects(mounting, /aborted|disposed/);
    assert.equal(f.container.children.length, 0); assert.equal(f.plugin._children.length, 0);
  }
});

test('registration failure rolls back the component and partial registry', async () => {
  const f = fixture();
  f.plugin.addView = async view => { f.plugin.manager.viewSet.add(view); throw new Error('Render failed'); };
  await assert.rejects(mountKanbanBoard(f.plugin, f.container, f.file), /Render failed/);
  assert.equal(f.plugin._children.length, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
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
  assert.equal(f.plugin._children.length, 0); assert.equal(f.plugin.manager.viewSet.size, 0);
  assert.deepEqual(f.writes, []);
});

test('invalid Markdown is rejected without creating a component or writing', async () => {
  const f = fixture(); f.setDisk('ordinary note');
  await assert.rejects(mountKanbanBoard(f.plugin, f.container, f.file), /not a Kanban/);
  assert.equal(f.container.children.length, 0); assert.deepEqual(f.writes, []);
  assert.equal(f.plugin._children.length, 0);
});

test('two embeds of one file share its document; each disposal flushes it', async () => {
  const f = fixture();
  const first = await mountKanbanBoard(f.plugin, f.container, f.file);
  const second = await mountKanbanBoard(f.plugin, new Element(), f.file);
  f.document.text = 'kanban:shared edit';
  await second.dispose();
  assert.deepEqual(f.writes, ['kanban:shared edit']);
  assert.equal(f.plugin.manager.viewSet.size, 1);
  await first.dispose();
  assert.deepEqual(f.writes, ['kanban:shared edit']);
});

test('a lost source is reported in the embed', async () => {
  const f = fixture();
  globalThis.notices = [];
  const mount = await mountKanbanBoard(f.plugin, f.container, f.file);
  mount.board.owner.onSourceLost(new Error('Source is no longer a Kanban board.'));
  assert.deepEqual(globalThis.notices, ['Kanban embed: Source is no longer a Kanban board.']);
  f.plugin.unload();
});
