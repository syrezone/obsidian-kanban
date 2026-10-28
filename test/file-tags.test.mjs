import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The file explorer and Obsidian events are host boundaries; this exercises the
// badge decision and cleanup against stubbed explorer items.
const built = await build({
  stdin: {
    contents: "export * from './src/fileExplorerTags'; export { TFile } from 'obsidian';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'host-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(obsidian|\.\/parsers\/common)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class TFile { constructor(path, extension) { this.path = path; this.extension = extension; } }
      export function debounce(fn) { const run = () => fn(); run.cancel = () => {}; return run; }
      export const frontmatterKey = 'kanban-plugin';
    ` }));
  } }],
});
const { registerKanbanFileTags, TFile } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

class El {
  children = [];
  constructor(cls = '', text = '') { this.cls = cls; this.text = text; }
  createDiv({ cls, text }) { const child = new El(cls, text); child.parent = this; this.children.push(child); return child; }
  querySelector(selector) {
    const cls = selector.replace(':scope > .', '');
    return this.children.find((child) => child.cls.split(' ').includes(cls)) ?? null;
  }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
}

function fixture() {
  const frontmatter = new Map();
  const items = {};
  const handlers = [], cleanups = [];
  let ready;
  const app = {
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file) }), on: (_, fn) => handlers.push(fn) },
    vault: { on: (_, fn) => handlers.push(fn) },
    workspace: {
      onLayoutReady: (fn) => { ready = fn; },
      on: (_, fn) => handlers.push(fn),
      getLeavesOfType: (type) => (type === 'file-explorer' ? [{ view: { fileItems: items } }] : []),
    },
  };
  registerKanbanFileTags({ app, registerEvent() {}, register: (fn) => cleanups.push(fn) });
  const add = (path, file, kanban = false) => {
    if (kanban) frontmatter.set(file, { 'kanban-plugin': 'board' });
    return (items[path] = { file, selfEl: new El('nav-file-title') });
  };
  return { add, frontmatter, ready: () => ready(), refresh: () => handlers.forEach((fn) => fn()), unload: () => cleanups.forEach((fn) => fn()) };
}

const tags = (item) => item.selfEl.children.filter((child) => child.cls.includes('kanban-plugin__file-tag'));

test('only Kanban Markdown files get a single kanban badge', () => {
  const f = fixture();
  const board = f.add('Tasks.md', new TFile('Tasks.md', 'md'), true);
  const note = f.add('Note.md', new TFile('Note.md', 'md'));
  const canvas = f.add('Canvas.board', new TFile('Canvas.board', 'board'), true);
  const folder = f.add('Folder', { path: 'Folder' });
  f.ready();
  f.refresh();
  assert.deepEqual(tags(board).map((tag) => [tag.cls, tag.text]), [['nav-file-tag kanban-plugin__file-tag', 'kanban']]);
  assert.equal(tags(note).length, 0);
  assert.equal(tags(canvas).length, 0);
  assert.equal(tags(folder).length, 0);
});

test('badges follow frontmatter changes and are removed on unload', () => {
  const f = fixture();
  const file = new TFile('Tasks.md', 'md');
  const item = f.add('Tasks.md', file, true);
  f.ready();
  assert.equal(tags(item).length, 1);
  f.frontmatter.delete(file);
  f.refresh();
  assert.equal(tags(item).length, 0);
  f.frontmatter.set(file, { 'kanban-plugin': 'board' });
  f.refresh();
  assert.equal(tags(item).length, 1);
  f.unload();
  assert.equal(tags(item).length, 0);
});
