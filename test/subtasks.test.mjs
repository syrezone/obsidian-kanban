import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// A card previews the tasks of the note linked in its first line; ticking one there must
// rewrite only that line of the note.
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/helpers/subtasks.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { readLinkedTasks, toggleTaskLine } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

test('linked tasks follow cache line numbers, so CRLF notes map to the right lines', () => {
  const note = '# Details\r\n- [ ] draft\r\ntext\r\n\t- [x] review';
  assert.deepEqual(readLinkedTasks(note, [1, 3, 2]), [
    { line: 1, text: 'draft', checked: false },
    { line: 3, text: 'review', checked: true },
  ]);
});

test('empty tasks in the note are not previewed', () => {
  assert.deepEqual(readLinkedTasks('- [ ] a\n- [ ] ', [0, 1]), [{ line: 0, text: 'a', checked: false }]);
});

test('toggling a linked task changes only that line and keeps line endings', () => {
  const note = '- [ ] a\r\n- [ ] b\r\n';
  assert.equal(toggleTaskLine(note, 1, 'x'), '- [ ] a\r\n- [x] b\r\n');
  assert.equal(toggleTaskLine('- [x] a', 0, 'x'), '- [ ] a');
  // A stale line number (note edited meanwhile) must not corrupt other text.
  assert.equal(toggleTaskLine('heading\n- [ ] a', 0, 'x'), 'heading\n- [ ] a');
});

const linkBuilt = await build({
  entryPoints: [fileURLToPath(new URL('../src/helpers/detailPane.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', external: ['obsidian'],
});
const {
  wikilinkAt, setFocusedEditorLinkHandler, clearFocusedEditorLinkHandler, runFocusedEditorLinkHandler,
} = await import(
  `data:text/javascript;base64,${Buffer.from(linkBuilt.outputFiles[0].text).toString('base64')}`
);

test('Ctrl+Enter resolves the link under the cursor, including at its brackets', () => {
  const line = 'Call [[Fragomen|agency]] about [[Visa#Docs]]';
  assert.equal(wikilinkAt(line, 5), 'Fragomen');
  assert.equal(wikilinkAt(line, 24), 'Fragomen');
  assert.equal(wikilinkAt(line, 35), 'Visa#Docs');
  // Outside a link, Ctrl+Enter keeps its normal meaning.
  assert.equal(wikilinkAt(line, 27), null);
  assert.equal(wikilinkAt('[[]]', 1), null);
});

test('link commands go to the focused card editor only while it is focused', () => {
  const editorA = () => true;
  const editorB = () => false;
  setFocusedEditorLinkHandler(editorA);
  assert.equal(runFocusedEditorLinkHandler(), true);
  // A late blur from another editor must not unregister the focused one.
  clearFocusedEditorLinkHandler(editorB);
  assert.equal(runFocusedEditorLinkHandler(), true);
  clearFocusedEditorLinkHandler(editorA);
  // Nothing focused: Obsidian's own command runs.
  assert.equal(runFocusedEditorLinkHandler(), false);
});
