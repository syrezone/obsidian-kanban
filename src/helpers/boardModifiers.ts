import update from 'immutability-helper';
import { Notice, moment } from 'obsidian';
import { KanbanBoard } from 'src/KanbanBoard';
import { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import {
  appendEntities,
  getEntityFromPath,
  insertEntity,
  moveEntity,
  removeEntity,
  updateEntity,
} from 'src/dnd/util/data';

import { generateInstanceId } from '../components/helpers';
import { Board, DataTypes, Item, Lane } from '../components/types';
import { pathOf } from './boardIndex';

// Personal build: modifiers address lanes and cards by id. Each resolves the id against
// the board state it changes, so actions that run after an await, a re-render or a change
// in another view never land on whatever now sits at an old path. Updates take a function
// of the current entity for the same reason.
export interface BoardModifiers {
  appendItems: (laneId: string, items: Item[]) => void;
  prependItems: (laneId: string, items: Item[]) => void;
  insertItems: (id: string, items: Item[], where: 'before' | 'after') => void;
  replaceItem: (id: string, replace: (item: Item) => Item[]) => void;
  moveItemToTop: (id: string) => void;
  moveItemToBottom: (id: string) => void;
  moveItemToLane: (id: string, laneId: string, where: 'top' | 'bottom') => void;
  addLane: (lane: Lane) => void;
  insertLane: (id: string, lane: Lane, where: 'before' | 'after') => void;
  updateLane: (id: string, change: (lane: Lane) => Lane) => void;
  archiveLane: (id: string) => void;
  archiveLaneItems: (id: string) => void;
  deleteEntity: (id: string) => void;
  updateItem: (id: string, change: (item: Item) => Item) => void;
  archiveItem: (id: string) => void;
  duplicateEntity: (id: string) => void;
}

export function getBoardModifiers(view: KanbanBoard, stateManager: StateManager): BoardModifiers {
  const appendArchiveDate = (item: Item) => {
    const archiveDateFormat = stateManager.getSetting('archive-date-format');
    const archiveDateSeparator = stateManager.getSetting('archive-date-separator');
    const archiveDateAfterTitle = stateManager.getSetting('append-archive-date');

    const newTitle = [moment().format(archiveDateFormat)];

    if (archiveDateSeparator) newTitle.push(archiveDateSeparator);

    newTitle.push(item.data.titleRaw);

    if (archiveDateAfterTitle) newTitle.reverse();

    const titleRaw = newTitle.join(' ');
    return stateManager.updateItemContent(item, titleRaw);
  };

  /** Apply `op` at the entity's current path; a vanished entity leaves the board unchanged. */
  const at = (id: string, op: (boardData: Board, path: Path) => Board) => {
    stateManager.setState((boardData) => {
      const path = pathOf(boardData, id);
      if (!path) {
        new Notice('Kanban: that card or list no longer exists; nothing was changed.');
        return boardData;
      }
      return op(boardData, path);
    });
  };

  const updateCollapseState = (op: (collapseState: boolean[]) => boolean[]) => {
    const collapseState = view.getViewState('list-collapse') || [];
    view.setViewState('list-collapse', undefined, op);
    return op(collapseState);
  };

  const insertCollapseState = (index: number, collapsed: boolean) =>
    updateCollapseState((collapseState) => {
      const newState = [...collapseState];
      newState.splice(index, 0, collapsed);
      return newState;
    });

  const removeCollapseState = (index: number) =>
    updateCollapseState((collapseState) => {
      const newState = [...collapseState];
      newState.splice(index, 1);
      return newState;
    });

  return {
    appendItems: (laneId: string, items: Item[]) => {
      at(laneId, (boardData, path) =>
        updateEntity(boardData, path, { children: { $push: items } })
      );
    },

    prependItems: (laneId: string, items: Item[]) => {
      at(laneId, (boardData, path) =>
        updateEntity(boardData, path, { children: { $unshift: items } })
      );
    },

    insertItems: (id: string, items: Item[], where: 'before' | 'after') => {
      at(id, (boardData, path) => {
        const destination = [...path.slice(0, -1), path.last() + (where === 'after' ? 1 : 0)];
        return insertEntity(boardData, destination, items);
      });
    },

    replaceItem: (id: string, replace: (item: Item) => Item[]) => {
      at(id, (boardData, path) => {
        const items = replace(getEntityFromPath(boardData, path) as Item);
        return insertEntity(removeEntity(boardData, path), path, items);
      });
    },

    // Personal build: nested child cards move within their own parent.
    moveItemToTop: (id: string) => {
      at(id, (boardData, path) => moveEntity(boardData, path, [...path.slice(0, -1), 0]));
    },

    moveItemToBottom: (id: string) => {
      at(id, (boardData, path) => {
        const parentPath = path.slice(0, -1);
        const parent = getEntityFromPath(boardData, parentPath);
        return moveEntity(boardData, path, [...parentPath, parent.children.length]);
      });
    },

    moveItemToLane: (id: string, laneId: string, where: 'top' | 'bottom') => {
      at(id, (boardData, path) => {
        const lanePath = pathOf(boardData, laneId);
        if (!lanePath || lanePath[0] === path[0]) return boardData;
        const index = where === 'top' ? 0 : boardData.children[lanePath[0]].children.length;
        return moveEntity(boardData, path, [lanePath[0], index]);
      });
    },

    addLane: (lane: Lane) => {
      stateManager.setState((boardData) =>
        update<Board>(appendEntities(boardData, [], [lane]), {
          data: {
            settings: {
              'list-collapse': {
                $set: updateCollapseState((collapseState) => [...collapseState, false]),
              },
            },
          },
        })
      );
    },

    insertLane: (id: string, lane: Lane, where: 'before' | 'after') => {
      at(id, (boardData, path) => {
        const index = path.last() + (where === 'after' ? 1 : 0);
        return update<Board>(insertEntity(boardData, [index], [lane]), {
          data: { settings: { 'list-collapse': { $set: insertCollapseState(index, false) } } },
        });
      });
    },

    updateLane: (id: string, change: (lane: Lane) => Lane) => {
      at(id, (boardData, path) =>
        updateEntity(boardData, path, { $set: change(getEntityFromPath(boardData, path) as Lane) })
      );
    },

    archiveLane: (id: string) => {
      at(id, (boardData, path) => {
        const lane = getEntityFromPath(boardData, path);
        const items = lane.children;

        try {
          return update<Board>(removeEntity(boardData, path), {
            data: {
              settings: { 'list-collapse': { $set: removeCollapseState(path.last()) } },
              archive: {
                $unshift: stateManager.getSetting('archive-with-date')
                  ? items.map(appendArchiveDate)
                  : items,
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    archiveLaneItems: (id: string) => {
      at(id, (boardData, path) => {
        const lane = getEntityFromPath(boardData, path);
        const items = lane.children;

        try {
          return update(
            updateEntity(boardData, path, {
              children: {
                $set: [],
              },
            }),
            {
              data: {
                archive: {
                  $unshift: stateManager.getSetting('archive-with-date')
                    ? items.map(appendArchiveDate)
                    : items,
                },
              },
            }
          );
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    deleteEntity: (id: string) => {
      at(id, (boardData, path) => {
        const entity = getEntityFromPath(boardData, path);

        if (entity.type === DataTypes.Lane) {
          return update<Board>(removeEntity(boardData, path), {
            data: { settings: { 'list-collapse': { $set: removeCollapseState(path.last()) } } },
          });
        }

        return removeEntity(boardData, path);
      });
    },

    updateItem: (id: string, change: (item: Item) => Item) => {
      at(id, (boardData, path) =>
        updateEntity(boardData, path, { $set: change(getEntityFromPath(boardData, path) as Item) })
      );
    },

    archiveItem: (id: string) => {
      at(id, (boardData, path) => {
        const item = getEntityFromPath(boardData, path) as Item;
        try {
          return update(removeEntity(boardData, path), {
            data: {
              archive: {
                $push: [
                  stateManager.getSetting('archive-with-date') ? appendArchiveDate(item) : item,
                ],
              },
            },
          });
        } catch (e) {
          stateManager.setError(e);
          return boardData;
        }
      });
    },

    duplicateEntity: (id: string) => {
      at(id, (boardData, path) => {
        const entity = getEntityFromPath(boardData, path);
        // Personal build: duplicated cards give nested child cards new IDs too.
        const withNewIds = (item: Item): Item =>
          update(item, {
            id: { $set: generateInstanceId() },
            children: { $set: (item.children ?? []).map(withNewIds) },
          });
        const entityWithNewID =
          entity.type === DataTypes.Item
            ? withNewIds(entity as Item)
            : update(entity, { id: { $set: generateInstanceId() } });

        if (entity.type === DataTypes.Lane) {
          const index = path.last();
          const collapseState = updateCollapseState((collapseState) => {
            const newState = [...collapseState];
            newState.splice(index, 0, collapseState[index]);
            return newState;
          });
          return update<Board>(insertEntity(boardData, path, [entityWithNewID]), {
            data: { settings: { 'list-collapse': { $set: collapseState } } },
          });
        }

        return insertEntity(boardData, path, [entityWithNewID]);
      });
    },
  };
}
