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
  assert.equal(toggleTaskLine(note, { line: 1, text: 'b' }, 'x'), '- [ ] a\r\n- [x] b\r\n');
  assert.equal(toggleTaskLine('- [x] a', { line: 0, text: 'a' }, 'x'), '- [ ] a');
  // A stale line number (note edited meanwhile) must not corrupt other text.
  assert.equal(toggleTaskLine('heading\n- [ ] a', { line: 0, text: 'a' }, 'x'), 'heading\n- [ ] a');
});

test('a stale preview never ticks a different task that moved onto its line', () => {
  const edited = '- [ ] inserted\n- [ ] a';
  assert.equal(toggleTaskLine(edited, { line: 0, text: 'a' }, 'x'), edited);
});

const linkBuilt = await build({
  entryPoints: [fileURLToPath(new URL('../src/helpers/detailPane.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', external: ['obsidian'],
});
const {
  linkAt, cardNoteLink, setFocusedEditorLinkHandler, clearFocusedEditorLinkHandler, runFocusedEditorLinkHandler,
} = await import(
  `data:text/javascript;base64,${Buffer.from(linkBuilt.outputFiles[0].text).toString('base64')}`
);

test('Ctrl+Enter resolves the link under the cursor, including at its brackets', () => {
  const line = 'Call [[Fragomen|agency]] about [[Visa#Docs]]';
  assert.equal(linkAt(line, 5), 'Fragomen');
  assert.equal(linkAt(line, 24), 'Fragomen');
  assert.equal(linkAt(line, 35), 'Visa#Docs');
  // Outside a link, Ctrl+Enter keeps its normal meaning.
  assert.equal(linkAt(line, 27), null);
  assert.equal(linkAt('[[]]', 1), null);
});

test('Markdown links count as card links; external URLs do not', () => {
  const line = 'See [Visa notes](Visa%20notes.md) and [site](https://example.com)';
  assert.equal(linkAt(line, 6), 'Visa notes.md');
  assert.equal(linkAt(line, 45), null);
  assert.equal(linkAt('[x](<My Note.md#Docs>)', 2), 'My Note.md#Docs');
});

test("a card's note is the first internal link of its first line, in either link style", () => {
  assert.equal(cardNoteLink('[[Trip|holiday]] then [[Other]]'), 'Trip');
  assert.equal(cardNoteLink('[site](https://example.com) [Trip](Trip.md)'), 'Trip.md');
  assert.equal(cardNoteLink('Plan the trip\n[[Not the first line]]'), null);
  assert.equal(cardNoteLink('No link here'), null);
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
