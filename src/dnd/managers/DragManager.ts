import boxIntersect from 'box-intersect';
import EventEmitter from 'eventemitter3';
import { Notice } from 'obsidian';
import { RefObject, useCallback, useContext, useRef } from 'preact/compat';
import { StateManager } from 'src/StateManager';
import { handleDragOrPaste } from 'src/components/Item/helpers';

import { DndManagerContext } from '../components/context';
import { Coordinates, Entity, Hitbox, Side } from '../types';
import { getDropDuration, rafThrottle } from '../util/animation';
import { createHTMLDndEntity } from '../util/createHTMLDndEntity';
import { captureHostTransform, elementScale } from '../util/geometry';
import {
  adjustHitboxForMovement,
  distanceBetween,
  getBestIntersect,
  getScrollIntersection,
} from '../util/hitbox';

const dropSettleSlackMs = 25;
// Personal build: a pointer right of this fraction of the target row's width nests the card.
export const nestColumnStart = 0.5;

export interface DragEventData {
  dragEntity?: Entity;
  dragEntityId?: string;
  dragEntityMargin?: Hitbox;
  dragScale?: number;
  dragFont?: { fontSize: string; lineHeight: string };
  dragOrigin?: Coordinates;
  dragOriginHitbox?: Hitbox;
  dragPosition?: Coordinates;
  primaryIntersection?: Entity;
  scrollIntersections?: [Entity, number][];
  /** Personal build: the dragged card is moved right, so the drop nests it into the card above. */
  nestIntent?: boolean;
}

export interface ScrollEventData extends DragEventData {
  scrollEntity: Entity;
  scrollEntityId: string;
  scrollEntitySide: Side;
  scrollStrength: number;
}

export class DragManager {
  win: Window;
  emitter: EventEmitter;
  hitboxEntities: Map<string, Entity>;
  scrollEntities: Map<string, Entity>;

  dragEntity?: Entity;
  dragEntityId?: string;
  dragEntityMargin?: Hitbox;
  dragScale: number = 1;
  nestIntent = false;
  dragFont?: { fontSize: string; lineHeight: string };
  private hostUnchanged?: () => boolean;
  private transformFrame = 0;
  private dropUntil = 0;
  dragOrigin?: Coordinates;
  dragOriginHitbox?: Hitbox;
  dragPosition?: Coordinates;

  primaryIntersection?: Entity;
  scrollIntersection?: [Entity, number];

  isHTMLDragging: boolean = false;
  dragOverTimeout: number = 0;

  constructor(
    win: Window,
    emitter: EventEmitter,
    hitboxEntities: Map<string, Entity>,
    scrollEntities: Map<string, Entity>
  ) {
    this.win = win;
    this.hitboxEntities = hitboxEntities;
    this.scrollEntities = scrollEntities;
    this.emitter = emitter;
  }

  getDragEventData() {
    return {
      dragEntity: this.dragEntity,
      dragEntityId: this.dragEntityId,
      dragEntityMargin: this.dragEntityMargin,
      dragScale: this.dragScale,
      dragFont: this.dragFont,
      dragOrigin: this.dragOrigin,
      dragOriginHitbox: this.dragOriginHitbox,
      dragPosition: this.dragPosition,
      primaryIntersection: this.primaryIntersection,
      scrollIntersection: this.scrollIntersection,
      nestIntent: this.nestIntent,
    };
  }

  dragStart(e: PointerEvent, referenceElement?: HTMLElement) {
    const id =
      referenceElement?.dataset.hitboxid || (e.currentTarget as HTMLElement).dataset.hitboxid;

    if (!id || this.dragEntity || this.win.performance.now() < this.dropUntil) return false;

    const source = referenceElement || (e.currentTarget as HTMLElement);
    const styles = this.win.getComputedStyle(source);
    // Only owned embeds live inside a host transform (a scaled canvas); workspace
    // leaves keep the upstream unscaled drag path.
    if (source.closest('.kanban-owned-embed')) {
      try {
        this.hostUnchanged = captureHostTransform(source);
        this.dragScale = elementScale(source);
      } catch (error) {
        this.clearDrag();
        new Notice(String(error));
        return false;
      }
    }
    // Refresh all registered destinations as well as the source before sorting
    // hides anything. Ancestor transforms need not deliver ResizeObserver.
    this.scrollEntities.forEach((entity) => entity.recalcInitial());
    this.hitboxEntities.forEach((entity) => entity.recalcInitial());

    this.dragEntityId = id;
    this.dragOrigin = { x: e.clientX, y: e.clientY };
    this.dragPosition = { x: e.clientX, y: e.clientY };
    this.dragEntity = this.hitboxEntities.get(id);
    if (!this.dragEntity) {
      this.clearDrag();
      return false;
    }
    this.dragOriginHitbox = this.dragEntity?.getHitbox();
    this.dragFont = { fontSize: styles.fontSize, lineHeight: styles.lineHeight };
    this.dragEntityMargin = [
      parseFloat(styles.marginLeft) || 0,
      parseFloat(styles.marginTop) || 0,
      parseFloat(styles.marginRight) || 0,
      parseFloat(styles.marginBottom) || 0,
    ];

    this.emitter.emit('dragStart', this.getDragEventData());
    if (this.hostUnchanged) {
      // A host zoom/pan invalidates every measured hitbox, even without pointer movement.
      const watch = () => {
        if (!this.dragEntity) return;
        if (!this.hostUnchanged()) {
          this.cancelDrag();
          return;
        }
        this.transformFrame = this.win.requestAnimationFrame(watch);
      };
      this.transformFrame = this.win.requestAnimationFrame(watch);
    }
    return true;
  }

  dragStartHTML(e: DragEvent, viewId: string) {
    this.isHTMLDragging = true;
    const entity = createHTMLDndEntity(e.clientX, e.clientY, [], viewId, e.view);
    this.dragScale = 1;

    this.dragEntityId = entity.entityId;
    this.dragOrigin = { x: e.clientX, y: e.clientY };
    this.dragPosition = { x: e.clientX, y: e.clientY };
    this.dragEntity = entity;
    this.dragOriginHitbox = entity.getHitbox();
    this.dragEntityMargin = [0, 0, 0, 0];

    this.emitter.emit('dragStart', this.getDragEventData());
  }

  dragMove(e: PointerEvent) {
    if (!this.dragEntity) return;
    this.dragPosition = { x: e.clientX, y: e.clientY };
    this.nestIntent = this.getNestIntent();
    this.emitter.emit('dragMove', this.getDragEventData());
    this.calculateDragIntersect();
  }

  dragMoveHTML(e: DragEvent) {
    this.dragPosition = { x: e.clientX, y: e.clientY };
    this.emitter.emit('dragMove', this.getDragEventData());
    this.calculateDragIntersect();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  dragEnd(e: PointerEvent) {
    if (!this.dragEntity) return;
    if (e.type === 'pointercancel' || (this.hostUnchanged && !this.hostUnchanged())) {
      this.cancelDrag();
      return;
    }
    const destination = this.primaryIntersection?.getHitbox() || this.dragOriginHitbox;
    // Block a new drag until the drop animation (plus one frame of slack) settles.
    this.dropUntil =
      this.win.performance.now() +
      getDropDuration({
        position: this.dragPosition,
        destination: { x: destination[0], y: destination[1] },
      }) +
      dropSettleSlackMs;
    this.nestIntent = this.getNestIntent();
    this.emitter.emit('dragEnd', this.getDragEventData());
    this.clearDrag();
  }

  cancelDrag() {
    if (this.dragEntity) this.emitter.emit('dragCancel', this.getDragEventData());
    this.clearDrag();
  }

  private clearDrag() {
    this.win.cancelAnimationFrame(this.transformFrame);
    this.transformFrame = 0;
    this.hostUnchanged = undefined;
    this.dragScale = 1;
    this.nestIntent = false;
    this.dragFont = undefined;
    this.dragEntityMargin = undefined;
    this.dragEntity = undefined;
    this.dragEntityId = undefined;
    this.dragOrigin = undefined;
    this.dragOriginHitbox = undefined;
    this.dragPosition = undefined;
    this.scrollIntersection = undefined;
    this.primaryIntersection = undefined;
  }

  dragEndHTML(e: DragEvent, viewId: string, content: string[], isLeave?: boolean) {
    this.isHTMLDragging = false;
    if (!isLeave) {
      this.dragEntity = createHTMLDndEntity(e.clientX, e.clientY, content, viewId, e.view);
      this.emitter.emit('dragEnd', this.getDragEventData());
    }

    this.dragEntityMargin = undefined;
    this.dragEntity = undefined;
    this.dragEntityId = undefined;
    this.dragOrigin = undefined;
    this.dragOriginHitbox = undefined;
    this.dragPosition = undefined;
    this.scrollIntersection = undefined;
    this.primaryIntersection = undefined;

    if (isLeave) {
      this.emitter.emit('dragEnd', this.getDragEventData());
    }
  }

  onHTMLDragLeave(callback: () => void) {
    this.win.clearTimeout(this.dragOverTimeout);
    this.dragOverTimeout = this.win.setTimeout(callback, 351);
  }

  /**
   * Personal build: the target row has two columns. With the pointer in the left half the
   * card drops as a sibling; in the right half it nests into the card above the drop gap.
   * Hitboxes and the pointer are both viewport units, so this holds at any canvas scale.
   */
  private getNestIntent() {
    if (!this.dragEntity || !this.dragPosition || !this.primaryIntersection) return false;
    if (this.dragEntity.getData().type !== 'item') return false;
    const [left, , right] = this.primaryIntersection.getHitbox();
    return right > left && (this.dragPosition.x - left) / (right - left) > nestColumnStart;
  }

  calculateDragIntersect() {
    if (!this.dragEntity || !this.dragPosition || !this.dragOrigin || !this.dragOriginHitbox) {
      return;
    }

    const { type, win } = this.dragEntity.getData();

    const hitboxEntities: Entity[] = [];
    const hitboxHitboxes: Hitbox[] = [];
    const scrollEntities: Entity[] = [];
    const scrollHitboxes: Hitbox[] = [];

    // Personal build: a card cannot be dropped into its own nested child cards.
    const dragPath = this.dragEntity.getPath();
    const insideDragged = (entity: Entity) => {
      const path = entity.getPath();
      return path.length > dragPath.length && dragPath.every((step, i) => path[i] === step);
    };

    this.hitboxEntities.forEach((entity) => {
      const data = entity.getData();

      if (
        win === data.win &&
        (data.accepts.includes(type) || data.acceptsSort?.includes(type)) &&
        !insideDragged(entity)
      ) {
        hitboxEntities.push(entity);
        hitboxHitboxes.push(entity.getHitbox());
      }
    });

    this.scrollEntities.forEach((entity) => {
      const data = entity.getData();

      if (win === data.win && data.accepts.includes(type)) {
        scrollEntities.push(entity);
        scrollHitboxes.push(entity.getHitbox());
      }
    });

    if (hitboxEntities.length === 0 && scrollEntities.length === 0) {
      return;
    }

    const dragHitbox = adjustHitboxForMovement(
      this.dragOriginHitbox,
      this.dragOrigin,
      this.dragPosition
    );

    const isScrolling = this.handleScrollIntersect(
      dragHitbox,
      this.dragEntity,
      scrollHitboxes,
      scrollEntities
    );

    if (!isScrolling) {
      this.handleHitboxIntersect(dragHitbox, this.dragEntity, hitboxHitboxes, hitboxEntities);
    }
  }

  handleScrollIntersect(
    dragHitbox: Hitbox,
    dragEntity: Entity,
    hitboxes: Hitbox[],
    hitboxEntities: Entity[]
  ) {
    const scrollHits: Entity[] = boxIntersect([dragHitbox], hitboxes).map(
      (match) => hitboxEntities[match[1]]
    );

    const scrollIntersection = getScrollIntersection(scrollHits, dragHitbox, dragEntity);

    if (
      this.scrollIntersection &&
      (!scrollIntersection || scrollIntersection[0] !== this.scrollIntersection[0])
    ) {
      const [scrollEntity, scrollStrength] = this.scrollIntersection;
      const scrollEntityData = scrollEntity.getData();
      const scrollEntityId = scrollEntity.entityId;
      const scrollEntitySide = scrollEntityData.side;

      this.emitter.emit(
        'endDragScroll',
        {
          ...this.getDragEventData(),
          scrollEntity,
          scrollEntityId,
          scrollEntitySide,
          scrollStrength,
        },
        scrollEntityId
      );

      this.scrollIntersection = undefined;
    }

    if (
      scrollIntersection &&
      (!this.scrollIntersection || this.scrollIntersection[0] !== scrollIntersection[0])
    ) {
      const [scrollEntity, scrollStrength] = scrollIntersection;
      const scrollEntityData = scrollEntity.getData();
      const scrollEntityId = scrollEntity.entityId;
      const scrollEntitySide = scrollEntityData.side;

      this.emitter.emit(
        'beginDragScroll',
        {
          ...this.getDragEventData(),
          scrollEntity,
          scrollEntityId,
          scrollEntitySide,
          scrollStrength,
        },
        scrollEntityId
      );

      this.scrollIntersection = scrollIntersection;
    } else if (
      scrollIntersection &&
      this.scrollIntersection &&
      scrollIntersection[0] === this.scrollIntersection[0]
    ) {
      const [scrollEntity, scrollStrength] = scrollIntersection;
      const scrollEntityData = scrollEntity.getData();
      const scrollEntityId = scrollEntity.entityId;
      const scrollEntitySide = scrollEntityData.side;

      this.emitter.emit(
        'updateDragScroll',
        {
          ...this.getDragEventData(),
          scrollEntity,
          scrollEntityId,
          scrollEntitySide,
          scrollStrength,
        },
        scrollEntityId
      );

      this.scrollIntersection = scrollIntersection;
    }

    return !!scrollIntersection;
  }

  handleHitboxIntersect(
    dragHitbox: Hitbox,
    dragEntity: Entity,
    hitboxes: Hitbox[],
    hitboxEntities: Entity[]
  ) {
    const hits: Entity[] = boxIntersect([dragHitbox], hitboxes).map(
      (match) => hitboxEntities[match[1]]
    );

    const primaryIntersection = getBestIntersect(hits, dragHitbox, dragEntity);

    if (this.primaryIntersection && this.primaryIntersection !== primaryIntersection) {
      this.emitter.emit('dragLeave', this.getDragEventData(), this.primaryIntersection.entityId);
      this.primaryIntersection = undefined;
    }

    if (primaryIntersection && this.primaryIntersection !== primaryIntersection) {
      this.emitter.emit(
        'dragEnter',
        {
          ...this.getDragEventData(),
          primaryIntersection,
        },
        primaryIntersection.entityId
      );
      this.primaryIntersection = primaryIntersection;
    }
  }
}

const cancelEvent = (e: TouchEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

export function useDragHandle(
  droppableElement: RefObject<HTMLElement | null>,
  handleElement: RefObject<HTMLElement | null>
) {
  const dndManager = useContext(DndManagerContext);
  const unbind = useRef(() => {});

  return useCallback((el: HTMLElement) => {
    if (handleElement.current !== el) {
      unbind.current();
      unbind.current = () => {};
    }
    if (!el) return;

    const handle = el;
    const onPointerDown = (e: PointerEvent) => {
      if (e.defaultPrevented || !dndManager || !droppableElement.current) return;
      const droppable = droppableElement.current;

      let node = e.targetNode;
      while (node) {
        if (node.instanceOf(HTMLElement) && node.dataset.ignoreDrag) {
          return;
        }
        node = node.parentElement;
      }

      // We only care about left mouse / touch contact
      // https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events#determining_button_states
      if (e.button !== 0 && e.buttons !== 1) {
        return;
      }

      const win = e.view;
      const isTouchEvent = ['pen', 'touch'].includes(e.pointerType);
      const pointerId = e.pointerId;

      if (!isTouchEvent) {
        e.stopPropagation();
        e.preventDefault();
      }

      const initialEvent = e;
      const initialPosition: Coordinates = {
        x: e.clientX,
        y: e.clientY,
      };

      let isDragging = false;
      let longPressTimeout = 0;

      if (isTouchEvent) {
        win.addEventListener('contextmenu', cancelEvent, true);

        longPressTimeout = win.setTimeout(() => {
          isDragging = dndManager.dragManager.dragStart(initialEvent, droppable);
          win.addEventListener('touchmove', cancelEvent, {
            passive: false,
          });
        }, 500);
      }

      const onMove = rafThrottle(win, (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (isTouchEvent) {
          if (!isDragging) {
            if (
              distanceBetween(initialPosition, {
                x: e.clientX,
                y: e.clientY,
              }) > 5
            ) {
              win.clearTimeout(longPressTimeout);
              win.removeEventListener('touchmove', cancelEvent);
              win.removeEventListener('contextmenu', cancelEvent, true);
              win.removeEventListener('pointermove', onMove);
              win.removeEventListener('pointerup', onEnd);
              win.removeEventListener('pointercancel', onEnd);
            }
          } else {
            dndManager.dragManager.dragMove(e);
          }
        } else {
          if (!isDragging) {
            if (
              distanceBetween(initialPosition, {
                x: e.clientX,
                y: e.clientY,
              }) > 5
            ) {
              isDragging = dndManager.dragManager.dragStart(initialEvent, droppable);
              if (isDragging) dndManager.dragManager.dragMove(e);
            }
          } else {
            dndManager.dragManager.dragMove(e);
          }
        }
      });

      const onEnd = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        win.clearTimeout(longPressTimeout);
        isDragging = false;
        onMove.cancel();

        dndManager.dragManager.dragEnd(e);

        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onEnd);
        win.removeEventListener('pointercancel', onEnd);

        if (isTouchEvent) {
          win.removeEventListener('contextmenu', cancelEvent, true);
          win.removeEventListener('touchmove', cancelEvent);
        }
      };

      win.addEventListener('pointermove', onMove);
      win.addEventListener('pointerup', onEnd);
      win.addEventListener('pointercancel', onEnd);
    };

    const swallowTouchEvent = (e: TouchEvent) => {
      e.stopPropagation();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('touchstart', swallowTouchEvent);

    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('touchstart', swallowTouchEvent);
    };
  }, []);
}

export function createHTMLDndHandlers(stateManager: StateManager) {
  const dndManager = useContext(DndManagerContext);
  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (dndManager.dragManager.isHTMLDragging) {
        e.preventDefault();
        dndManager.dragManager.dragMoveHTML(e);
      } else {
        dndManager.dragManager.dragStartHTML(e, stateManager.getAView().id);
      }

      dndManager.dragManager.onHTMLDragLeave(() => {
        dndManager.dragManager.dragEndHTML(e, stateManager.getAView().id, [], true);
      });
    },
    [dndManager, stateManager]
  );

  const onDrop = useCallback(
    async (e: DragEvent) => {
      dndManager.dragManager.dragEndHTML(
        e,
        stateManager.getAView().id,
        await handleDragOrPaste(stateManager, e, activeWindow as Window & typeof globalThis),
        false
      );
    },
    [dndManager, stateManager]
  );

  return {
    onDragOver,
    onDrop,
  };
}
