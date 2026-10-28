import { generateInstanceId } from 'src/components/helpers';

import { Axis, Entity } from '../types';
import { getDropDuration, removeStyle, setStyle, transitions } from '../util/animation';
import { elementScale, sortDimensions } from '../util/geometry';
import { SiblingDirection, getSiblingDirection } from '../util/path';
import { DndManager } from './DndManager';
import { DragEventData, nestColumnStart } from './DragManager';

type EntityAndElement = [Entity, HTMLElement, HTMLElement];

interface Dimensions {
  width: number;
  height: number;
}

const emptyDimensions: Dimensions = {
  width: 0,
  height: 0,
};

export const dragLeaveDebounceLength = 100;

export class SortManager {
  dndManager: DndManager;
  sortables: Map<string, EntityAndElement>;
  shifted: Set<string>;
  hidden: Set<string>;
  isSorting: boolean;
  isPlaceholderActive: boolean;
  axis: Axis;
  placeholder: EntityAndElement | null;
  instanceId: string;

  sortListeners: Array<(isSorting: boolean) => void>;

  constructor(dndManager: DndManager, axis: Axis, onSortChange?: (isSorting: boolean) => void) {
    this.instanceId = generateInstanceId();
    this.dndManager = dndManager;
    this.sortables = new Map();
    this.shifted = new Set();
    this.hidden = new Set();
    this.isSorting = false;
    this.axis = axis;
    this.placeholder = null;
    this.sortListeners = onSortChange ? [onSortChange] : [];

    dndManager.dragManager.emitter.on('dragStart', this.handleDragStart);
    dndManager.dragManager.emitter.on('dragEnd', this.handleDragEnd);
    dndManager.dragManager.emitter.on('dragEnter', this.handleDragEnter);
    dndManager.dragManager.emitter.on('dragLeave', this.handleDragLeave);
    dndManager.dragManager.emitter.on('dragCancel', this.handleDragCancel);
    dndManager.dragManager.emitter.on('dragMove', this.handleNestTarget);
    dndManager.dragManager.emitter.on('dragEnter', this.handleNestTarget);
  }

  destroy() {
    this.hideDropGhost();
    this.dndManager.win.clearTimeout(this.dragLeaveTimeout);
    this.dndManager.win.clearTimeout(this.dragEndTimeout);

    this.dndManager.dragManager.emitter.off('dragStart', this.handleDragStart);
    this.dndManager.dragManager.emitter.off('dragEnd', this.handleDragEnd);
    this.dndManager.dragManager.emitter.off('dragEnter', this.handleDragEnter);
    this.dndManager.dragManager.emitter.off('dragLeave', this.handleDragLeave);
    this.dndManager.dragManager.emitter.off('dragCancel', this.handleDragCancel);
    this.dndManager.dragManager.emitter.off('dragMove', this.handleNestTarget);
    this.dndManager.dragManager.emitter.off('dragEnter', this.handleNestTarget);
  }

  // Personal build: while a drop would nest, highlight the card above the gap (the new parent).
  private nestTarget: HTMLElement | null = null;
  private setNestTarget(el: HTMLElement | null) {
    if (this.nestTarget === el) return;
    this.nestTarget?.removeClass('is-nest-parent');
    el?.addClass('is-nest-parent');
    this.nestTarget = el;
  }

  handleNestTarget = ({ nestIntent, primaryIntersection, dragEntity }: DragEventData) => {
    let parent: HTMLElement | null = null;
    const ownsTarget = !!primaryIntersection && this.sortables.has(primaryIntersection.entityId);
    if (nestIntent && ownsTarget) {
      const targetPath = primaryIntersection.getPath();
      const targetIndex = targetPath[targetPath.length - 1];
      let best = -1;
      this.sortables.forEach(([entity, , measure]) => {
        if (entity.getData().type !== 'item' || this.hidden.has(entity.entityId)) return;
        const path = entity.getPath();
        const index = path[path.length - 1];
        if (index < targetIndex && index > best) {
          best = index;
          parent = measure;
        }
      });
    }
    this.setNestTarget(parent);

    const isCardDrag = dragEntity?.getData().type === 'item';
    if (ownsTarget && isCardDrag && primaryIntersection.entityId !== dragEntity.entityId) {
      this.showDropGhost(primaryIntersection.entityId, !!parent);
    } else {
      this.hideDropGhost();
    }
  };

  // Personal build: a translucent card in the drop gap previews the resulting level:
  // full row width for a sibling, the right half for a nested child. It is a fixed
  // body-level element, positioned from on-screen rects every frame while shown.
  private dropGhost: HTMLElement | null = null;
  private dropGhostFrame = 0;
  private dropGhostTarget: { id: string; nest: boolean } | null = null;

  private showDropGhost(id: string, nest: boolean) {
    this.dropGhostTarget = { id, nest };
    if (!this.dropGhost) {
      this.dropGhost = this.dndManager.win.document.body.createDiv({ cls: 'kanban-plugin__drop-ghost' });
    }
    if (!this.dropGhostFrame) this.positionDropGhost();
  }

  private hideDropGhost() {
    this.dndManager.win.cancelAnimationFrame(this.dropGhostFrame);
    this.dropGhostFrame = 0;
    this.dropGhostTarget = null;
    this.dropGhost?.remove();
    this.dropGhost = null;
  }

  private positionDropGhost = () => {
    const target = this.dropGhostTarget && this.sortables.get(this.dropGhostTarget.id);
    const placeholder = this.placeholder?.[2];
    if (!this.dropGhost || !target || !placeholder || !this.isPlaceholderActive) {
      this.dropGhost?.hide();
    } else {
      // Sorting translates the target's inner card down; its untransformed wrapper (or the
      // end placeholder) marks the slot the dropped card will take.
      const rect = target[2].getBoundingClientRect();
      const gapHeight = placeholder.getBoundingClientRect().height;
      const left = rect.left + (this.dropGhostTarget.nest ? rect.width * nestColumnStart : 0);
      setStyle(this.dropGhost, 'left', `${left}px`);
      setStyle(this.dropGhost, 'top', `${rect.top}px`);
      setStyle(this.dropGhost, 'width', `${rect.right - left}px`);
      setStyle(this.dropGhost, 'height', `${gapHeight}px`);
      this.dropGhost.show();
    }
    this.dropGhostFrame = this.dndManager.win.requestAnimationFrame(this.positionDropGhost);
  };

  handleDragCancel = () => {
    const { win } = this.dndManager;
    win.clearTimeout(this.dragEnterTimeout);
    win.clearTimeout(this.dragLeaveTimeout);
    win.clearTimeout(this.dragEndTimeout);
    this.setNestTarget(null);
    this.hideDropGhost();
    this.sortables.forEach(([, , measure]) => measure.removeClass('is-dropping'));
    this.resetSelf({
      maintainHidden: false,
      shiftTransition: transitions.none,
      placeholderTransition: transitions.none,
    });
    this.hitboxDimensions = emptyDimensions;
  };

  private localDimensions(
    box: DragEventData['dragOriginHitbox'],
    margin: DragEventData['dragEntityMargin'],
    scale: number = 1
  ) {
    const target = this.placeholder?.[2];
    if (!target) throw new Error('Sortable has no destination placeholder.');
    return sortDimensions(box, margin || [0, 0, 0, 0], scale, elementScale(target));
  }

  registerSortable(id: string, entity: Entity, el: HTMLElement, measureEl: HTMLElement) {
    const type = entity.getData().type;

    this.sortables.set(id, [entity, el, measureEl]);

    if (type === 'placeholder') {
      this.placeholder = [entity, el, measureEl];
      measureEl.dataset.axis = this.axis;
      setStyle(measureEl, 'transition', transitions.none);
    } else {
      setStyle(el, 'transition', transitions.none);
    }
  }

  unregisterSortable(id: string) {
    this.sortables.delete(id);
  }

  hitboxDimensions = emptyDimensions;

  handleDragStart = ({
    dragEntity,
    dragEntityMargin,
    dragOriginHitbox,
    dragScale,
  }: DragEventData) => {
    const id = dragEntity?.entityId;
    const haveDragEntity = id ? this.sortables.has(id) : null;

    if (!dragEntity || !haveDragEntity || !dragOriginHitbox) {
      return;
    }

    this.setSortState(true);
    this.hitboxDimensions = this.localDimensions(dragOriginHitbox, dragEntityMargin, dragScale);
    this.activatePlaceholder(this.hitboxDimensions, transitions.none);

    this.sortables.forEach(([entity, el, measureEl]) => {
      const siblingDirection = getSiblingDirection(dragEntity.getPath(), entity.getPath());
      const entityId = entity.entityId;

      if (siblingDirection === SiblingDirection.Self) {
        this.hidden.add(entityId);
        return this.hideDraggingEntity(measureEl);
      }

      if (siblingDirection === SiblingDirection.After) {
        if (!this.shifted.has(entityId)) {
          this.shifted.add(entityId);
        }

        this.shiftEl(el, transitions.none, this.hitboxDimensions);
      }
    });
  };

  resetSelf({
    maintainHidden,
    maintainPlaceholder,
    shiftTransition,
    placeholderTransition,
  }: {
    maintainHidden?: boolean;
    maintainPlaceholder?: boolean;
    shiftTransition?: string;
    placeholderTransition?: string;
  }) {
    if (this.isSorting) {
      this.setSortState(false);
    }

    if (this.isPlaceholderActive && !maintainPlaceholder) {
      this.deactivatePlaceholder(placeholderTransition);
    }

    if (this.shifted.size > 0) {
      this.shifted.forEach((entityId) => {
        if (this.sortables.has(entityId)) {
          const [, el] = this.sortables.get(entityId);
          this.resetEl(el, shiftTransition);
        }
      });

      this.shifted.clear();
    }

    if (!maintainHidden && this.hidden.size > 0) {
      this.hidden.forEach((entityId) => {
        if (this.sortables.has(entityId)) {
          const [, , measure] = this.sortables.get(entityId);
          this.resetEl(measure, shiftTransition);
        }
      });

      this.hidden.clear();
    }
  }

  private dragEndTimeout = 0;
  handleDragEnd = ({
    primaryIntersection,
    dragPosition,
    dragOriginHitbox,
    dragEntity,
    nestIntent,
  }: DragEventData) => {
    this.setNestTarget(null);
    this.hideDropGhost();
    const resetDroparea = () => {
      if (primaryIntersection && dragEntity) {
        const { acceptsSort } = primaryIntersection.getData();
        const inDroparea = acceptsSort && !acceptsSort.includes(dragEntity.getData().type);
        if (inDroparea) {
          const sortable = this.sortables.get(primaryIntersection.entityId);
          if (sortable) sortable[2].removeClass('is-dropping');
        }
      }
    };

    if (!this.isSorting || !dragPosition || !dragOriginHitbox || !dragEntity) {
      resetDroparea();

      if (!primaryIntersection && dragEntity && this.sortables.has(dragEntity.entityId)) {
        return this.resetSelf({ maintainHidden: false });
      }

      if (primaryIntersection && dragEntity) {
        const dropHitbox = primaryIntersection?.getHitbox() || dragOriginHitbox;
        const dropDuration = getDropDuration({
          position: dragPosition,
          destination: {
            x: dropHitbox[0],
            y: dropHitbox[1],
          },
        });

        return this.dndManager.win.setTimeout(() => {
          this.resetSelf({ maintainHidden: false });
        }, dropDuration);
      }

      return this.resetSelf({ maintainHidden: true });
    }

    const { win } = this.dndManager;
    win.clearTimeout(this.dragEnterTimeout);
    win.clearTimeout(this.dragLeaveTimeout);
    win.clearTimeout(this.dragEndTimeout);

    const dropHitbox = primaryIntersection?.getHitbox() || dragOriginHitbox;
    const dropDuration =
      dragEntity.scopeId === 'htmldnd'
        ? 0
        : getDropDuration({
            position: dragPosition,
            destination: {
              x: dropHitbox[0],
              y: dropHitbox[1],
            },
          });

    this.dragEndTimeout = win.setTimeout(() => {
      const dragEntityId = dragEntity.entityId.split(':::').pop();
      const primaryIntersectionId = primaryIntersection?.entityId.split(':::').pop();

      resetDroparea();

      if (
        primaryIntersection &&
        this.sortables.has(primaryIntersection.entityId) &&
        primaryIntersectionId !== dragEntityId
      ) {
        this.dndManager.onDrop(dragEntity, primaryIntersection, nestIntent);
      }

      this.resetSelf({
        maintainHidden: false,
        shiftTransition: transitions.none,
        placeholderTransition: transitions.none,
      });
    }, dropDuration);

    this.hitboxDimensions = emptyDimensions;
  };

  private dragEnterTimeout = 0;
  handleDragEnter = ({
    dragEntity,
    dragEntityMargin,
    dragOriginHitbox,
    primaryIntersection,
    dragScale,
  }: DragEventData) => {
    const id = primaryIntersection?.entityId;
    const haveSortable = id ? this.sortables.has(id) : null;

    if (!dragEntity || !primaryIntersection || !haveSortable || !dragOriginHitbox) {
      if (!haveSortable && this.isSorting) {
        this.resetSelf({ maintainHidden: true, maintainPlaceholder: true });
      }

      return;
    }

    if (dragEntity.entityId === primaryIntersection.entityId) {
      return;
    }

    const { win } = this.dndManager;

    win.clearTimeout(this.dragLeaveTimeout);
    win.clearTimeout(this.dragEnterTimeout);

    this.dragEnterTimeout = win.setTimeout(() => {
      const dims = (this.hitboxDimensions = this.localDimensions(
        dragOriginHitbox,
        dragEntityMargin,
        dragScale
      ));
      this.setSortState(true);
      this.activatePlaceholder(dims, transitions.placeholder);

      const { acceptsSort } = primaryIntersection.getData();
      const inDroparea = acceptsSort && !acceptsSort.includes(dragEntity.getData().type);

      if (inDroparea) {
        const sortable = this.sortables.get(primaryIntersection.entityId);
        if (sortable) sortable[2].addClass('is-dropping');

        this.sortables.forEach(([entity, el]) => {
          const entityId = entity.entityId;
          if (this.shifted.has(entityId)) {
            this.shifted.delete(entityId);
            this.resetEl(el);
          }
        });
        return;
      }

      this.sortables.forEach(([entity, el]) => {
        const siblingDirection = getSiblingDirection(
          primaryIntersection.getPath(),
          entity.getPath()
        );

        const entityId = entity.entityId;

        if (
          !this.hidden.has(entityId) &&
          (siblingDirection === SiblingDirection.Self ||
            siblingDirection === SiblingDirection.After)
        ) {
          if (!this.shifted.has(entityId)) {
            this.shifted.add(entityId);
            this.shiftEl(el, transitions.outOfTheWay, dims);
          }
        } else if (this.shifted.has(entityId)) {
          this.shifted.delete(entityId);
          this.resetEl(el);
        }
      });
    }, 10);
  };

  private dragLeaveTimeout = 0;
  handleDragLeave = ({ dragEntity, primaryIntersection }: DragEventData) => {
    if (!this.isSorting) return;

    const { acceptsSort } = primaryIntersection.getData();
    const inDroparea = acceptsSort && !acceptsSort.includes(dragEntity.getData().type);
    if (inDroparea) {
      const sortable = this.sortables.get(primaryIntersection.entityId);
      if (sortable) sortable[2].removeClass('is-dropping');
    }

    const { win } = this.dndManager;
    win.clearTimeout(this.dragLeaveTimeout);
    win.clearTimeout(this.dragEnterTimeout);
    this.dragLeaveTimeout = win.setTimeout(() => {
      this.resetSelf({ maintainHidden: true, maintainPlaceholder: true });
    }, dragLeaveDebounceLength);

    this.hitboxDimensions = emptyDimensions;
  };

  activatePlaceholder(dimensions: { width: number; height: number }, transition: string) {
    if (this.placeholder) {
      const isHorizontal = this.axis === 'horizontal';
      const [, , measure] = this.placeholder;

      setStyle(measure, 'transition', transition);
      setStyle(
        measure,
        isHorizontal ? 'width' : 'height',
        `${isHorizontal ? dimensions.width : dimensions.height}px`
      );

      this.isPlaceholderActive = true;
    }
  }

  deactivatePlaceholder(transition: string = transitions.placeholder) {
    if (this.placeholder) {
      const [, , measure] = this.placeholder;

      setStyle(measure, 'transition', transition);
      removeStyle(measure, 'width');
      removeStyle(measure, 'height');

      this.isPlaceholderActive = false;
    }
  }

  hideDraggingEntity(el: HTMLElement) {
    setStyle(el, 'display', 'none');
  }

  shiftEl(el: HTMLElement, transition: string, dimensions: { width: number; height: number }) {
    const shift =
      this.axis === 'horizontal'
        ? `translate3d(${dimensions.width}px, 0, 0)`
        : `translate3d(0, ${dimensions.height}px, 0)`;

    setStyle(el, 'transition', transition);
    setStyle(el, 'transform', shift);
  }

  resetEl(el: HTMLElement, transition: string = transitions.outOfTheWay) {
    setStyle(el, 'transition', transition);
    setStyle(el, 'transform', 'translate3d(0, 0, 0)');
    removeStyle(el, 'display');
  }

  addSortNotifier(fn: (isSorting: boolean) => void) {
    this.sortListeners.push(fn);
  }

  removeSortNotifier(fn: (isSorting: boolean) => void) {
    this.sortListeners = this.sortListeners.filter((listener) => listener !== fn);
  }

  setSortState(isSorting: boolean) {
    if (this.isSorting !== isSorting) {
      this.isSorting = isSorting;
      this.sortListeners.forEach((fn) => fn(isSorting));
    }
  }
}
