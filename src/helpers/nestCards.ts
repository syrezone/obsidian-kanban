import { Board } from 'src/components/types';
import { Nestable, Path } from 'src/dnd/types';
import { getEntityFromPath, moveEntity } from 'src/dnd/util/data';

// Personal build: the current path of a card at any depth, or null if it is gone.
export function findItemPath(board: Board, id: string): Path | null {
  const find = (parent: Nestable, path: Path): Path | null => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (child.id === id) return [...path, i];
      const found = child.children ? find(child, [...path, i]) : null;
      if (found) return found;
    }
    return null;
  };
  return find(board, []);
}

// Personal build: after a move, nest the card as the last child of the card above it.
export function nestIntoPrevious(board: Board, id: string): Board {
  const path = findItemPath(board, id);
  const index = path?.[path.length - 1];
  if (!path || path.length < 2 || !index) return board;
  const above = [...path.slice(0, -1), index - 1];
  return moveEntity(board, path, [...above, getEntityFromPath(board, above).children.length]);
}
