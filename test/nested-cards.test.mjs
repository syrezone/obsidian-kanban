import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Nested task items are child cards. The Markdown file stays a plain indented task list, so
// parsing and saving must round-trip it, and a child's metadata must not leak into its parent.
// Obsidian and Dataview are host boundaries and are stubbed.
globalThis.app = { vault: { getConfig: () => false }, plugins: { enabledPlugins: new Set() } };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null };
const stubElement = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} });
globalThis.document ??= {
  createElement: stubElement,
  head: stubElement(),
  body: stubElement(),
  documentElement: stubElement(),
  addEventListener() {},
};
Object.defineProperty(Array.prototype, 'first', { value() { return this[0]; }, configurable: true });
Object.defineProperty(Array.prototype, 'last', { value() { return this[this.length - 1]; }, configurable: true });

const built = await build({
  stdin: {
    contents: `
      export { parseMarkdown } from './src/parsers/parseMarkdown';
      export { astToUnhydratedBoard, boardToMd } from './src/parsers/formats/list';
      export { nestIntoPrevious } from './src/helpers/nestCards';
      export { moveEntity } from './src/dnd/util/data';
    `,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  banner: { js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(process.cwd() + '/');" },
  plugins: [{ name: 'host-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(obsidian|obsidian-dataview)$/ }, ({ path }) => ({ path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      const fn = () => {};
      export const moment = Object.assign(() => ({ locale: fn, isValid: () => false }), { locale: () => 'en' });
      export const parseYaml = () => ({ 'kanban-plugin': 'board' });
      export const stringifyYaml = (value) => Object.entries(value).map(([k, v]) => k + ': ' + v).join('\\n') + '\\n';
      export const getAPI = () => null;
      export class TFile {}
      export class TFolder {}
      export class Component {}
      export class Menu {}
      export class Notice {}
      export class Modal {}
      export class Setting {}
      export class PluginSettingTab {}
      export const Platform = {};
      export const Keymap = { isModEvent: fn };
      export const MarkdownRenderer = { render: fn };
      export const setIcon = fn;
      export const debounce = (f) => f;
      export const htmlToMarkdown = (s) => s;
      export const request = fn;
      export const normalizePath = (s) => s;
      export const getLinkpath = (s) => s;
      export const parseLinktext = (s) => ({ path: s, subpath: '' });
      export const TAbstractFile = class {};
      export const FuzzySuggestModal = class {};
      export const ItemView = class {};
      export const TextFileView = class {};
      export const WorkspaceLeaf = class {};
      export const Plugin = class {};
      export const App = class {};
      export const EditorSuggest = class {};
      export const MarkdownView = class {};
      export const Vault = class {};
    ` }));
  } }],
});
const { parseMarkdown, astToUnhydratedBoard, boardToMd, nestIntoPrevious, moveEntity } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

const settings = new Map(Object.entries({ 'move-tags': false, 'move-dates': false }));
const stateManager = {
  file: { path: 'Board.md' },
  app: { metadataCache: { getFirstLinkpathDest: () => null } },
  getSetting: (key) => settings.get(key),
  getGlobalSetting: () => undefined,
  compileSettings: () => {},
};

const lane = [
  '- [ ] Send fragomen #admin',
  '    - [ ] lumee worming',
  '    - [ ] [[Fill gap]] #child-tag ^childid',
  '        - [x] Xmas calender',
  '- [ ] Cat cave',
].join('\n');
const md = `---\n\nkanban-plugin: board\n---\n\n## Do\n\n${lane}\n\n\n\n`;

function parse(markdown) {
  const { settings: boardSettings, frontmatter, ast } = parseMarkdown(stateManager, markdown);
  return astToUnhydratedBoard(stateManager, boardSettings, frontmatter, ast, markdown);
}

test('indented tasks become child cards at every depth, with their own state', () => {
  const [parent, sibling] = parse(md).children[0].children;
  assert.equal(parent.data.titleRaw, 'Send fragomen #admin');
  assert.deepEqual(parent.children.map((child) => child.data.titleRaw), ['lumee worming', '[[Fill gap]] #child-tag']);
  assert.equal(parent.children[1].children[0].data.titleRaw, 'Xmas calender');
  assert.equal(parent.children[1].children[0].data.checked, true);
  assert.equal(sibling.data.titleRaw, 'Cat cave');
  assert.deepEqual(sibling.children, []);
});

test("a child's tags, links and block id stay with the child", () => {
  const parent = parse(md).children[0].children[0];
  assert.deepEqual(parent.data.metadata.tags, ['#admin']);
  assert.equal(parent.data.blockId, undefined);
  assert.equal(parent.data.metadata.fileAccessor, undefined);
  assert.equal(parent.children[1].data.blockId, 'childid');
  assert.deepEqual(parent.children[1].data.metadata.tags, ['#child-tag']);
});

test('saving writes the same indented task list back', () => {
  assert.ok(boardToMd(parse(md)).includes(lane));
});

test('nested non-task bullets stay part of the card text', () => {
  const card = parse(md.replace('- [ ] Cat cave', '- [ ] Cat cave\n    - plain note')).children[0].children[1];
  assert.equal(card.data.titleRaw, 'Cat cave\n- plain note');
  assert.deepEqual(card.children, []);
});

test('moving a card right nests it as the last child of the card above', () => {
  const board = parse(md);
  const catCave = board.children[0].children[1];
  const nested = nestIntoPrevious(board, catCave.id);
  const parent = nested.children[0].children[0];
  assert.equal(nested.children[0].children.length, 1);
  assert.deepEqual(parent.children.map((child) => child.data.titleRaw), ['lumee worming', '[[Fill gap]] #child-tag', 'Cat cave']);
  assert.ok(boardToMd(nested).includes('    - [ ] Cat cave'));
  // The first card in a list has no card above it and stays where it is.
  assert.equal(nestIntoPrevious(board, board.children[0].children[0].id), board);
});

test('a child card can be moved out to the lane and between parents', () => {
  const board = parse(md);
  const out = moveEntity(board, [0, 0, 1], [0, 2]);
  assert.deepEqual(out.children[0].children.map((card) => card.data.titleRaw), ['Send fragomen #admin', 'Cat cave', '[[Fill gap]] #child-tag']);
  assert.equal(out.children[0].children[2].children[0].data.titleRaw, 'Xmas calender');
  const into = moveEntity(board, [0, 0, 0], [0, 1, 0]);
  assert.deepEqual(into.children[0].children[1].children.map((card) => card.data.titleRaw), ['lumee worming']);
});
