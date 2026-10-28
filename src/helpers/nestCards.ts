import { Board } from 'src/components/types';
import { getEntityFromPath, moveEntity } from 'src/dnd/util/data';

import { pathOf } from './boardIndex';

// Personal build: after a move, nest the card as the last child of the card above it.
export function nestIntoPrevious(board: Board, id: string): Board {
  const path = pathOf(board, id);
  const index = path?.[path.length - 1];
  if (!path || path.length < 2 || !index) return board;
  const above = [...path.slice(0, -1), index - 1];
  return moveEntity(board, path, [...above, getEntityFromPath(board, above).children.length]);
}
