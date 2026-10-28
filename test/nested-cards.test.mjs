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
      export { moveToTarget, targetPath } from './src/helpers/dropTarget';
      export { SortManager } from './src/dnd/managers/SortManager';
      export { moveEntity } from './src/dnd/util/data';
      export { getBoardModifiers } from './src/helpers/boardModifiers';
      export { pathOf } from './src/helpers/boardIndex';
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
      export class Notice { constructor(message) { globalThis.notices.push(message); } }
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
const {
  parseMarkdown, astToUnhydratedBoard, boardToMd, moveToTarget, targetPath, SortManager, moveEntity,
  getBoardModifiers, pathOf,
} = await import(
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

const titles = (cards) => cards.map((card) => card.data.titleRaw);

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

test('nested lists mixing tasks with plain or numbered items stay card text', () => {
  const mixed = '- [ ] Cat cave\n    - [ ] a task\n    - plain note';
  const card = parse(md.replace('- [ ] Cat cave', mixed)).children[0].children[1];
  assert.equal(card.data.titleRaw, 'Cat cave\n- [ ] a task\n- plain note');
  assert.deepEqual(card.children, []);
  assert.ok(boardToMd(parse(md.replace('- [ ] Cat cave', mixed))).includes(mixed));

  const numbered = '- [ ] Cat cave\n    1. [ ] first';
  const ordered = parse(md.replace('- [ ] Cat cave', numbered)).children[0].children[1];
  assert.equal(ordered.data.titleRaw, 'Cat cave\n1. [ ] first');
  assert.deepEqual(ordered.children, []);
});

// A drop is decided once, as a DropTarget, by the SortManager that owns the target; its
// preview shows that target and the drop performs it. The DOM side is stubbed here.
function sortFixture(cards, { hidden = [] } = {}) {
  const manager = new SortManager({ dragManager: { emitter: { on() {}, off() {} } } }, 'vertical');
  const entity = (id, index, type = 'item') => ({
    entityId: 'scope-' + id,
    getPath: () => [0, index],
    getData: () => ({ id, type }),
    getParentId: () => 'lane',
  });
  const entities = cards.map((id, index) => entity(id, index));
  entities.push(entity('placeholder', cards.length, 'placeholder'));
  for (const e of entities) manager.sortables.set(e.entityId, [e, {}, { id: e.getData().id }]);
  hidden.forEach((id) => manager.hidden.add('scope-' + id));
  const byId = (id) => entities.find((e) => e.getData().id === id);
  const drop = (dragId, targetId, nest) => manager.getDropTarget(byId(dragId) ?? entity(dragId, 9), byId(targetId), nest);
  return { drop };
}

test('a drop goes before the card under the gap, or at the end on the list placeholder', () => {
  const { drop } = sortFixture(['a', 'b', 'c']);
  assert.deepEqual(drop('a', 'c', false).target, { parentId: 'lane', position: { before: 'c' } });
  assert.deepEqual(drop('a', 'placeholder', false).target, { parentId: 'lane', position: 'end' });
  assert.equal(drop('b', 'b', false), null);
});

test('a nesting drop goes into the nearest shown card above the gap, as its last child', () => {
  const { drop } = sortFixture(['a', 'b', 'c', 'd'], { hidden: ['c'] });
  // 'c' is the dragged card (hidden while dragging); the preview outlines 'b'.
  const nested = drop('c', 'd', true);
  assert.deepEqual(nested.target, { parentId: 'b', position: 'end' });
  assert.deepEqual(nested.nestParent, { id: 'b' });
  assert.deepEqual(drop('c', 'placeholder', true).target, { parentId: 'd', position: 'end' });
  // The first card has no card above it: the drop stays a sibling drop.
  assert.deepEqual(drop('c', 'a', true).target, { parentId: 'lane', position: { before: 'a' } });
});

test('a card drop on a collapsed lane goes where the lane puts new cards', () => {
  const collapsed = { entityId: 'scope-area', getPath: () => [1], getParentId: () => null,
    getData: () => ({ id: 'lane-2', type: 'lane', acceptsSort: ['lane'] }) };
  const manager = new SortManager({ dragManager: { emitter: { on() {}, off() {} } } }, 'horizontal');
  manager.sortables.set(collapsed.entityId, [collapsed, {}, {}]);
  const card = { entityId: 'scope-card', getData: () => ({ id: 'card', type: 'item' }) };
  assert.deepEqual(manager.getDropTarget(card, collapsed, true).target, { parentId: 'lane-2', position: 'new-card' });
});

const keep = (entity) => ({ next: entity });

test('moving to a target lands exactly there, at any depth', () => {
  const board = parse(md);
  const [parent, catCave] = board.children[0].children;
  const nested = moveToTarget(board, catCave.id, { parentId: parent.id, position: 'end' }, false, keep).board;
  assert.equal(nested.children[0].children.length, 1);
  assert.deepEqual(titles(nested.children[0].children[0].children), ['lumee worming', '[[Fill gap]] #child-tag', 'Cat cave']);
  assert.ok(boardToMd(nested).includes('    - [ ] Cat cave'));

  // Moving down the same list lands right before the target card, after removal.
  const lumee = parent.children[0];
  const down = moveToTarget(board, lumee.id, { parentId: board.children[0].id, position: { before: catCave.id } }, false, keep);
  assert.deepEqual(titles(down.board.children[0].children), ['Send fragomen #admin', 'lumee worming', 'Cat cave']);
  assert.deepEqual(down.from, [0, 0, 0]);
  assert.deepEqual(down.to, [0, 1]);
});

test('a drop into the dragged card itself, or onto a vanished target, changes nothing', () => {
  const board = parse(md);
  const [parent] = board.children[0].children;
  const fillGap = parent.children[1];
  assert.equal(moveToTarget(board, parent.id, { parentId: fillGap.id, position: 'end' }, false, keep), null);
  assert.equal(moveToTarget(board, parent.id, { parentId: parent.id, position: 'end' }, false, keep), null);
  assert.equal(moveToTarget(board, fillGap.id, { parentId: 'gone', position: 'end' }, false, keep), null);
  assert.equal(moveToTarget(board, fillGap.id, { parentId: parent.id, position: { before: fillGap.id } }, false, keep), null);
});

test('lanes move by id, and a new-card drop follows the insertion setting', () => {
  const board = parse(md + '## Done\n\n- [ ] Shipped\n\n');
  const [doLane, done] = board.children;
  const moved = moveToTarget(board, done.id, { parentId: null, position: { before: doLane.id } }, false, keep);
  assert.deepEqual(moved.board.children.map((lane) => lane.data.title), ['Done', 'Do']);
  assert.deepEqual([moved.from, moved.to], [[1], [0]]);
  assert.deepEqual(targetPath(board, { parentId: done.id, position: 'new-card' }, true), [1, 0]);
  assert.deepEqual(targetPath(board, { parentId: done.id, position: 'new-card' }, false), [1, 1]);
});

test('a child card can be moved out to the lane and between parents', () => {
  const board = parse(md);
  const out = moveEntity(board, [0, 0, 1], [0, 2]);
  assert.deepEqual(out.children[0].children.map((card) => card.data.titleRaw), ['Send fragomen #admin', 'Cat cave', '[[Fill gap]] #child-tag']);
  assert.equal(out.children[0].children[2].children[0].data.titleRaw, 'Xmas calender');
  const into = moveEntity(board, [0, 0, 0], [0, 1, 0]);
  assert.deepEqual(into.children[0].children[1].children.map((card) => card.data.titleRaw), ['lumee worming']);
});

// Modifiers address cards and lists by id and resolve it against the state they change, so
// an action captured before the board changed still lands on the same card.
function modifierFixture() {
  globalThis.notices = [];
  let collapse = [false, true];
  const manager = {
    state: parse(md),
    getSetting: () => false,
    setState(change) { this.state = typeof change === 'function' ? change(this.state) : change; },
    setError(error) { throw error; },
    updateItemContent: (item, titleRaw) => ({ ...item, data: { ...item.data, titleRaw } }),
  };
  const view = {
    getViewState: () => collapse,
    setViewState(_key, _value, op) { collapse = op(collapse); },
  };
  return { manager, modifiers: getBoardModifiers(view, manager), collapse: () => collapse };
}
test('pathOf finds lists and cards at any depth in the current board', () => {
  const board = parse(md);
  const [parent] = board.children[0].children;
  assert.deepEqual(pathOf(board, board.children[0].id), [0]);
  assert.deepEqual(pathOf(board, parent.children[1].children[0].id), [0, 0, 1, 0]);
  assert.equal(pathOf(board, 'missing'), null);
  const moved = moveEntity(board, [0, 1], [0, 0]);
  assert.deepEqual(pathOf(moved, parent.id), [0, 1]);
});

test('an update captured before the board changed edits the same card, as it is now', () => {
  const { manager, modifiers } = modifierFixture();
  const child = manager.state.children[0].children[0].children[0];
  // Another view moves the card out of its parent before the edit lands.
  manager.setState((board) => moveEntity(board, [0, 0, 0], [0, 2]));
  manager.setState((board) => ({ ...board }));
  modifiers.updateItem(child.id, (current) => ({ ...current, data: { ...current.data, titleRaw: current.data.titleRaw + ' done' } }));
  assert.deepEqual(titles(manager.state.children[0].children), ['Send fragomen #admin', 'Cat cave', 'lumee worming done']);
  assert.deepEqual(titles(manager.state.children[0].children[0].children), ['[[Fill gap]] #child-tag']);
});

test('a card removed meanwhile is not replaced by whatever took its place', () => {
  const { manager, modifiers } = modifierFixture();
  const catCave = manager.state.children[0].children[1];
  manager.setState((board) => moveEntity(board, [0, 1], [0, 0]));
  modifiers.deleteEntity(catCave.id);
  const before = manager.state;
  modifiers.updateItem(catCave.id, () => { throw new Error('must not run'); });
  assert.equal(manager.state, before);
  assert.deepEqual(titles(manager.state.children[0].children), ['Send fragomen #admin']);
  assert.equal(globalThis.notices.length, 1);
});

test('insert, move and split work relative to the card, including nested cards', () => {
  const { manager, modifiers } = modifierFixture();
  const [parent, catCave] = manager.state.children[0].children;
  const [, fillGap] = parent.children;
  const card = (title) => ({ ...catCave, id: title, children: [], data: { ...catCave.data, titleRaw: title } });

  modifiers.insertItems(fillGap.id, [card('before gap')], 'before');
  modifiers.insertItems(fillGap.id, [card('after gap')], 'after');
  assert.deepEqual(titles(manager.state.children[0].children[0].children), ['lumee worming', 'before gap', '[[Fill gap]] #child-tag', 'after gap']);

  modifiers.moveItemToTop(fillGap.id);
  modifiers.moveItemToBottom('before gap');
  assert.deepEqual(titles(manager.state.children[0].children[0].children), ['[[Fill gap]] #child-tag', 'lumee worming', 'after gap', 'before gap']);

  modifiers.replaceItem(catCave.id, (current) => [card(current.data.titleRaw + ' 1'), card('Cat cave 2')]);
  assert.deepEqual(titles(manager.state.children[0].children), ['Send fragomen #admin', 'Cat cave 1', 'Cat cave 2']);
});

test('list actions resolve the list by id and keep collapse state aligned', () => {
  const { manager, modifiers, collapse } = modifierFixture();
  const lane = manager.state.children[0];
  const newLane = { ...lane, id: 'new lane', children: [], data: { ...lane.data, title: 'Later' } };
  modifiers.insertLane(lane.id, newLane, 'before');
  assert.deepEqual(manager.state.children.map((l) => l.data.title), ['Later', 'Do']);
  assert.deepEqual(collapse(), [false, false, true]);
  modifiers.updateLane(lane.id, (current) => ({ ...current, data: { ...current.data, title: 'Doing' } }));
  modifiers.deleteEntity('new lane');
  assert.deepEqual(manager.state.children.map((l) => l.data.title), ['Doing']);
  assert.deepEqual(collapse(), [false, true]);
});
