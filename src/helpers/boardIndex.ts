import { Board } from 'src/components/types';
import { Nestable, Path } from 'src/dnd/types';

// Personal build: boards are immutable, so each board state gets one id => path index,
// built on first lookup. Modifiers resolve ids against the state they actually change,
// never against a path captured at render time.
const indexes = new WeakMap<Board, Map<string, Path>>();

function buildIndex(board: Board) {
  const index = new Map<string, Path>();
  const walk = (parent: Nestable, path: Path) => {
    parent.children?.forEach((child, i) => {
      const childPath = [...path, i];
      index.set(child.id, childPath);
      walk(child, childPath);
    });
  };
  walk(board, []);
  return index;
}

/** The current path of a lane or card (at any depth), or null if it no longer exists. */
export function pathOf(board: Board, id: string): Path | null {
  let index = indexes.get(board);
  if (!index) {
    index = buildIndex(board);
    indexes.set(board, index);
  }
  return index.get(id) ?? null;
}
