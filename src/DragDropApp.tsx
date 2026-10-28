import classcat from 'classcat';
import update from 'immutability-helper';
import { JSX, createPortal, memo, useCallback, useMemo } from 'preact/compat';

import { KanbanBoard } from './KanbanBoard';
import { StateManager } from './StateManager';
import { DraggableItem } from './components/Item/Item';
import { DraggableLane } from './components/Lane/Lane';
import { KanbanContext } from './components/context';
import { c, maybeCompleteForMove } from './components/helpers';
import { Board, DataTypes, Item, Lane } from './components/types';
import { DndContext } from './dnd/components/DndContext';
import { DragOverlay } from './dnd/components/DragOverlay';
import { DropTarget, Entity, Nestable } from './dnd/types';
import { getEntityFromPath, insertEntity, removeEntity, updateEntity } from './dnd/util/data';
import { pathOf } from './helpers/boardIndex';
import { getBoardModifiers } from './helpers/boardModifiers';
import { moveToTarget, targetPath } from './helpers/dropTarget';
import KanbanPlugin from './main';
import { frontmatterKey } from './parsers/common';
import {
  getTaskStatusDone,
  getTaskStatusPreDone,
  toggleTask,
} from './parsers/helpers/inlineMetadata';

/** Whether a drop onto a collapsed lane goes first, like the board's new cards. */
function newCardsFirst(stateManager: StateManager) {
  return (stateManager.getSetting('new-card-insertion-method') || 'append') !== 'append';
}

export function createApp(win: Window, plugin: KanbanPlugin) {
  return <DragDropApp win={win} plugin={plugin} />;
}

const View = memo(function View({ view }: { view: KanbanBoard }) {
  return createPortal(view.getPortal(), view.contentEl);
});

export function DragDropApp({ win, plugin }: { win: Window; plugin: KanbanPlugin }) {
  const views = plugin.useKanbanViews(win);
  const portals: JSX.Element[] = views.map((view) => <View key={view.id} view={view} />);

  const handleDrop = useCallback(
    (dragEntity: Entity, dropEntity: Entity, target: DropTarget) => {
      if (!dragEntity || !dropEntity) {
        return;
      }

      if (dragEntity.scopeId === 'htmldnd') {
        const data = dragEntity.getData();
        const stateManager = plugin.getStateManagerFromViewID(data.viewId, data.win);

        try {
          return stateManager.setState((board) => {
            const to = targetPath(board, target, newCardsFirst(stateManager));
            if (!to) return board;
            const isComplete = !!board.children[to[0]]?.data?.shouldMarkItemsComplete;

            const items: Item[] = data.content.map((title: string) => {
              let item = stateManager.getNewItem(title, ' ');

              if (isComplete) {
                item = update(item, { data: { checkChar: { $set: getTaskStatusPreDone() } } });
                const updates = toggleTask(item, stateManager.file);
                if (updates) {
                  const [itemStrings, checkChars, thisIndex] = updates;
                  const nextItem = itemStrings[thisIndex];
                  const checkChar = checkChars[thisIndex];
                  return stateManager.getNewItem(nextItem, checkChar);
                }
              }

              return update(item, {
                data: {
                  checked: { $set: isComplete },
                  checkChar: { $set: isComplete ? getTaskStatusDone() : ' ' },
                },
              });
            });

            return insertEntity(board, to, items);
          });
        } catch (e) {
          stateManager.setError(e);
          console.error(e);
        }

        return;
      }

      const dragEntityData = dragEntity.getData();
      const dropEntityData = dropEntity.getData();
      const dragId: string = dragEntityData.id;
      const isLane = dragEntityData.type === DataTypes.Lane;
      const [, sourceFile] = dragEntity.scopeId.split(':::');
      const [, destinationFile] = dropEntity.scopeId.split(':::');

      // Same board
      if (sourceFile === destinationFile) {
        const view = plugin.getKanbanView(dragEntity.scopeId, dragEntityData.win);
        const stateManager = plugin.stateManagers.get(view.file);

        return stateManager.setState((board) => {
          const moved = moveToTarget(
            board,
            dragId,
            target,
            newCardsFirst(stateManager),
            (entity, from, to) =>
              entity.type === DataTypes.Item
                ? maybeCompleteForMove(
                    stateManager,
                    board,
                    from,
                    stateManager,
                    board,
                    to,
                    entity as Item
                  )
                : { next: entity }
          );
          if (!moved) return board;

          if (isLane) {
            const from = moved.from[0];
            const to = moved.to[0];
            const collapsedState = view.getViewState('list-collapse');
            const op = (collapsedState: boolean[]) => {
              const newState = [...collapsedState];
              newState.splice(to, 0, newState.splice(from, 1)[0]);
              return newState;
            };

            view.setViewState('list-collapse', undefined, op);

            return update<Board>(moved.board, {
              data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
            });
          }

          // Remove sorting in the destination lane
          const destinationLanePath = moved.to.slice(0, 1);
          const destinationLane = getEntityFromPath(moved.board, destinationLanePath);

          if (destinationLane?.data?.sorted !== undefined) {
            return updateEntity(moved.board, destinationLanePath, {
              data: {
                $unset: ['sorted'],
              },
            });
          }

          return moved.board;
        });
      }

      const sourceView = plugin.getKanbanView(dragEntity.scopeId, dragEntityData.win);
      const sourceStateManager = plugin.stateManagers.get(sourceView.file);
      const destinationView = plugin.getKanbanView(dropEntity.scopeId, dropEntityData.win);
      const destinationStateManager = plugin.stateManagers.get(destinationView.file);

      sourceStateManager.setState((sourceBoard) => {
        const from = pathOf(sourceBoard, dragId);
        if (!from) return sourceBoard;
        const entity = getEntityFromPath(sourceBoard, from);
        let replacementEntity: Nestable;
        let inserted = false;

        destinationStateManager.setState((destinationBoard) => {
          const to = targetPath(destinationBoard, target, newCardsFirst(destinationStateManager));
          if (!to) return destinationBoard;
          inserted = true;

          let next = entity;
          if (entity.type === DataTypes.Item) {
            ({ next, replacement: replacementEntity } = maybeCompleteForMove(
              sourceStateManager,
              sourceBoard,
              from,
              destinationStateManager,
              destinationBoard,
              to,
              entity as Item
            ));
          }

          if (isLane) {
            const collapsedState = destinationView.getViewState('list-collapse');
            const val = sourceView.getViewState('list-collapse')[from[0]];
            const op = (collapsedState: boolean[]) => {
              const newState = [...collapsedState];
              newState.splice(to[0], 0, val);
              return newState;
            };

            destinationView.setViewState('list-collapse', undefined, op);

            return update<Board>(insertEntity(destinationBoard, to, [next]), {
              data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
            });
          }

          return insertEntity(destinationBoard, to, [next]);
        });

        if (!inserted) return sourceBoard;

        if (isLane) {
          const collapsedState = sourceView.getViewState('list-collapse');
          const op = (collapsedState: boolean[]) => {
            const newState = [...collapsedState];
            newState.splice(from[0], 1);
            return newState;
          };
          sourceView.setViewState('list-collapse', undefined, op);

          return update<Board>(removeEntity(sourceBoard, from), {
            data: { settings: { 'list-collapse': { $set: op(collapsedState) } } },
          });
        }

        return removeEntity(sourceBoard, from, replacementEntity);
      });
    },
    [views]
  );

  if (portals.length)
    return (
      <DndContext win={win} onDrop={handleDrop}>
        {...portals}
        <DragOverlay>
          {(entity, styles) => {
            const [data, context] = useMemo(() => {
              if (entity.scopeId === 'htmldnd') {
                return [null, null];
              }

              const overlayData = entity.getData();

              const view = plugin.getKanbanView(entity.scopeId, overlayData.win);
              const stateManager = plugin.stateManagers.get(view.file);
              const data = getEntityFromPath(stateManager.state, entity.getPath());
              const boardModifiers = getBoardModifiers(view, stateManager);
              const filePath = view.file.path;

              return [
                data,
                {
                  view,
                  stateManager,
                  boardModifiers,
                  filePath,
                },
              ];
            }, [entity]);

            if (data?.type === DataTypes.Lane) {
              const boardView =
                context?.view.viewSettings[frontmatterKey] ||
                context?.stateManager.getSetting(frontmatterKey);
              const collapseState =
                context?.view.viewSettings['list-collapse'] ||
                context?.stateManager.getSetting('list-collapse');
              const laneIndex = entity.getPath().last();

              return (
                <KanbanContext.Provider value={context}>
                  <div
                    className={classcat([
                      c('drag-container'),
                      {
                        [c('horizontal')]: boardView !== 'list',
                        [c('vertical')]: boardView === 'list',
                      },
                    ])}
                    style={styles}
                  >
                    <DraggableLane
                      lane={data as Lane}
                      laneIndex={laneIndex}
                      isStatic={true}
                      isCollapsed={!!collapseState[laneIndex]}
                      collapseDir={boardView === 'list' ? 'vertical' : 'horizontal'}
                    />
                  </div>
                </KanbanContext.Provider>
              );
            }

            if (data?.type === DataTypes.Item) {
              return (
                <KanbanContext.Provider value={context}>
                  <div className={c('drag-container')} style={styles}>
                    <DraggableItem item={data as Item} itemIndex={0} isStatic={true} />
                  </div>
                </KanbanContext.Provider>
              );
            }

            return <div />;
          }}
        </DragOverlay>
      </DndContext>
    );
}
