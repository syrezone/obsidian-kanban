import classcat from 'classcat';
import {
  JSX,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/compat';
import { Droppable } from 'src/dnd/components/Droppable';
import { SortPlaceholder } from 'src/dnd/components/SortPlaceholder';
import { Sortable, StaticSortable } from 'src/dnd/components/Sortable';
import { DndManagerContext } from 'src/dnd/components/context';
import { useDragHandle } from 'src/dnd/managers/DragManager';
import { cardNoteLink, openInDetailPane } from 'src/helpers/detailPane';
import { frontmatterKey } from 'src/parsers/common';

import { Icon } from '../Icon/Icon';
import { KanbanContext, SearchContext } from '../context';
import { c } from '../helpers';
import { DataTypes, EditState, EditingState, Item, isEditing } from '../types';
import { ItemCheckbox } from './ItemCheckbox';
import { ItemContent } from './ItemContent';
import { newNoteFromCard, useItemMenu } from './ItemMenu';
import { ItemMenuButton } from './ItemMenuButton';
import { ItemSubtasks } from './ItemSubtasks';
import { ItemMetadata } from './MetadataTable';
import { getItemClassModifiers } from './helpers';

export interface DraggableItemProps {
  item: Item;
  itemIndex: number;
  isStatic?: boolean;
  shouldMarkItemsComplete?: boolean;
}

export interface ItemInnerProps {
  item: Item;
  isStatic?: boolean;
  shouldMarkItemsComplete?: boolean;
  isMatch?: boolean;
  searchQuery?: string;
}

const ItemInner = memo(function ItemInner({
  item,
  shouldMarkItemsComplete,
  isMatch,
  searchQuery,
  isStatic,
}: ItemInnerProps) {
  const { stateManager, boardModifiers } = useContext(KanbanContext);
  const [editState, setEditState] = useState<EditState>(EditingState.cancel);

  const dndManager = useContext(DndManagerContext);

  useEffect(() => {
    // Keep the open edit, as Enter would; upstream discarded it on any drag.
    const handler = () => {
      if (isEditing(editState)) setEditState(EditingState.complete);
    };

    dndManager.dragManager.emitter.on('dragStart', handler);
    return () => {
      dndManager.dragManager.emitter.off('dragStart', handler);
    };
  }, [dndManager, editState]);

  useEffect(() => {
    if (item.data.forceEditMode) {
      setEditState({ x: 0, y: 0 });
    }
  }, [item.data.forceEditMode]);

  const showItemMenu = useItemMenu({
    boardModifiers,
    item,
    setEditState: setEditState,
    stateManager,
  });

  const onContextMenu: JSX.MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (isEditing(editState)) return;
      if (
        e.targetNode.instanceOf(HTMLAnchorElement) &&
        (e.targetNode.hasClass('internal-link') || e.targetNode.hasClass('external-link'))
      ) {
        return;
      }
      showItemMenu(e);
    },
    [showItemMenu, editState]
  );

  // Personal build: Alt+click opens the card's linked note in the detail pane, or runs
  // "New note from card" when the card's first line has no [[link]] yet.
  const onClick: JSX.MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!e.altKey || isEditing(editState)) return;
      if ((e.target as HTMLElement).closest('a, input, button')) return;
      e.preventDefault();
      e.stopPropagation();
      const link = cardNoteLink(item.data.titleRaw);
      if (link) {
        void openInDetailPane(stateManager.app, link, stateManager.file.path, e.currentTarget);
      } else {
        void newNoteFromCard(stateManager, boardModifiers, item, e.currentTarget);
      }
    },
    [editState, item, stateManager, boardModifiers]
  );

  const onDoubleClick: JSX.MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => setEditState({ x: e.clientX, y: e.clientY }),
    [setEditState]
  );

  const ignoreAttr = useMemo(() => {
    if (isEditing(editState)) {
      return {
        'data-ignore-drag': true,
      };
    }

    return {};
  }, [editState]);

  return (
    <div
      // eslint-disable-next-line react/no-unknown-property
      onDblClick={onDoubleClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={c('item-content-wrapper')}
      {...ignoreAttr}
    >
      <div className={c('item-title-wrapper')} {...ignoreAttr}>
        <ItemCheckbox
          boardModifiers={boardModifiers}
          item={item}
          shouldMarkItemsComplete={shouldMarkItemsComplete}
          stateManager={stateManager}
        />
        <ItemContent
          item={item}
          searchQuery={isMatch ? searchQuery : undefined}
          setEditState={setEditState}
          editState={editState}
          isStatic={isStatic}
        />
        <ItemMenuButton editState={editState} setEditState={setEditState} showMenu={showItemMenu} />
      </div>
      <ItemMetadata searchQuery={isMatch ? searchQuery : undefined} item={item} />
      <ItemSubtasks item={item} />
    </div>
  );
});

export const DraggableItem = memo(function DraggableItem(props: DraggableItemProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const search = useContext(SearchContext);

  const { itemIndex, ...innerProps } = props;

  const bindHandle = useDragHandle(measureRef, measureRef);

  const isMatch = search?.query ? innerProps.item.data.titleSearch.includes(search.query) : false;
  const classModifiers: string[] = getItemClassModifiers(innerProps.item);
  const [childrenCollapsed, setChildrenCollapsed] = useState(false);
  const childItems = innerProps.item.children ?? [];

  // Personal build: nested child cards are the same card component one level deeper.
  // Collapsed lists are not mounted; a Sortable needs a visible placeholder.
  const ChildSortable = props.isStatic ? StaticSortable : Sortable;
  const childCards =
    childItems.length > 0 ? (
      <>
        <button
          className={c('item-children-toggle')}
          data-ignore-drag={true}
          aria-label={childrenCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
          onClick={(e) => {
            e.stopPropagation();
            setChildrenCollapsed(!childrenCollapsed);
          }}
        >
          <Icon name={childrenCollapsed ? 'lucide-chevron-right' : 'lucide-chevron-down'} />
        </button>
        {!childrenCollapsed && (
          <div className={c('item-children')}>
            <ChildSortable axis="vertical">
              <Items
                items={childItems}
                isStatic={props.isStatic}
                shouldMarkItemsComplete={props.shouldMarkItemsComplete}
              />
              <SortPlaceholder
                accepts={[DataTypes.Item]}
                index={childItems.length}
                isStatic={props.isStatic}
              />
            </ChildSortable>
          </div>
        )}
      </>
    ) : null;

  return (
    <div
      ref={(el) => {
        measureRef.current = el;
        bindHandle(el);
      }}
      className={c('item-wrapper')}
    >
      <div ref={elementRef} className={classcat([c('item'), ...classModifiers])}>
        {props.isStatic ? (
          <>
            <ItemInner
              {...innerProps}
              isMatch={isMatch}
              searchQuery={search?.query}
              isStatic={true}
            />
            {childCards}
          </>
        ) : (
          <Droppable
            elementRef={elementRef}
            measureRef={measureRef}
            id={props.item.id}
            index={itemIndex}
            data={props.item}
          >
            <ItemInner {...innerProps} isMatch={isMatch} searchQuery={search?.query} />
            {childCards}
          </Droppable>
        )}
      </div>
    </div>
  );
});

interface ItemsProps {
  isStatic?: boolean;
  items: Item[];
  shouldMarkItemsComplete: boolean;
}

export const Items = memo(function Items({ isStatic, items, shouldMarkItemsComplete }: ItemsProps) {
  const search = useContext(SearchContext);
  const { view } = useContext(KanbanContext);
  const boardView = view.useViewState(frontmatterKey);

  return (
    <>
      {items.map((item, i) => {
        return search?.query && !search.items.has(item) ? null : (
          <DraggableItem
            key={boardView + item.id}
            item={item}
            itemIndex={i}
            shouldMarkItemsComplete={shouldMarkItemsComplete}
            isStatic={isStatic}
          />
        );
      })}
    </>
  );
});
