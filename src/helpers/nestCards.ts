import { Board } from 'src/components/types';
import { getEntityFromPath, moveEntity } from 'src/dnd/util/data';
import { Nestable, Path } from 'src/dnd/types';

// Personal build: after a move, nest the card as the last child of the card above it.
export function nestIntoPrevious(board: Board, id: string): Board {
  const find = (parent: Nestable, path: Path): Path | null => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (child.id === id) return [...path, i];
      const found = child.children ? find(child, [...path, i]) : null;
      if (found) return found;
    }
    return null;
  };

  const path = find(board, []);
  const index = path?.[path.length - 1];
  if (!path || path.length < 2 || !index) return board;
  const above = [...path.slice(0, -1), index - 1];
  return moveEntity(board, path, [...above, getEntityFromPath(board, above).children.length]);
}
