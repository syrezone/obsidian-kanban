import { Board } from 'src/components/types';
import { DropTarget, Nestable, Path } from 'src/dnd/types';
import { getEntityFromPath, insertEntity, removeEntity } from 'src/dnd/util/data';

import { pathOf } from './boardIndex';

/**
 * Personal build: the path where `target` inserts into `board`, or null when its parent
 * or the sibling it goes before no longer exists. `newCardsFirst` places a 'new-card'
 * drop at the start of the lane instead of its end.
 */
export function targetPath(board: Board, target: DropTarget, newCardsFirst: boolean): Path | null {
  const parentPath = target.parentId === null ? [] : pathOf(board, target.parentId);
  if (!parentPath) return null;
  const siblings = getEntityFromPath(board, parentPath).children;
  const { position } = target;
  if (position === 'end') return [...parentPath, siblings.length];
  if (position === 'new-card') return [...parentPath, newCardsFirst ? 0 : siblings.length];
  const index = siblings.findIndex((sibling) => sibling.id === position.before);
  return index < 0 ? null : [...parentPath, index];
}

/**
 * Moves the lane or card `id` to `target` within one board. `transform` gets the entity
 * with its source path and the destination path in `board`, and returns what to insert
 * and what to leave in its place. Returns null when nothing should change: the entity or
 * target is gone, the target is the entity itself, or it is inside the entity.
 */
export function moveToTarget(
  board: Board,
  id: string,
  target: DropTarget,
  newCardsFirst: boolean,
  transform: (entity: Nestable, from: Path, to: Path) => { next: Nestable; replacement?: Nestable }
): { board: Board; from: Path; to: Path } | null {
  const from = pathOf(board, id);
  const to = targetPath(board, target, newCardsFirst);
  if (!from || !to) return null;
  if (to.length > from.length && from.every((step, i) => to[i] === step)) return null;

  const { next, replacement } = transform(getEntityFromPath(board, from), from, to);
  const removed = removeEntity(board, from, replacement);
  // Resolve again: removing the entity shifts the paths after it.
  const destination = targetPath(removed, target, newCardsFirst);
  if (!destination) return null;
  return { board: insertEntity(removed, destination, [next]), from, to: destination };
}
