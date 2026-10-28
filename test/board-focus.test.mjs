import { build } from 'esbuild';
import assert from 'node:assert/strict';
import test from 'node:test';

// Commands find "the focused board" through BoardFocus. DOM containment is stubbed with a
// parent chain; Obsidian's workspace is a host boundary.
const built = await build({
  entryPoints: [new URL('../src/helpers/boardFocus.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { BoardFocus } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

class Node {
  constructor(parent) { this.parent = parent; }
  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
}

function fixture() {
  const workspace = new Node();
  const canvas = new Node(workspace);
  const otherTab = new Node(workspace);
  const embedded = { containerEl: new Node(canvas) };
  const tab = { containerEl: new Node(otherTab) };
  const focus = new BoardFocus(() => [embedded, tab]);
  const click = (target) => focus.track({ target });
  return { canvas, otherTab, embedded, tab, focus, click };
}

test('a click inside an embedded board focuses it for commands in its view', () => {
  const { canvas, otherTab, embedded, focus, click } = fixture();
  click(new Node(new Node(embedded.containerEl)));
  assert.equal(focus.within(canvas), embedded);
  // Another view is active: the canvas card's board is not the target.
  assert.equal(focus.within(otherTab), null);
  assert.equal(focus.within(undefined), null);
});

test('clicking outside every board, or the board going away, clears the focus', () => {
  const { canvas, embedded, focus, click } = fixture();
  click(embedded.containerEl);
  click(new Node(canvas));
  assert.equal(focus.within(canvas), null);
  click(embedded.containerEl);
  focus.forget(embedded);
  assert.equal(focus.within(canvas), null);
});
