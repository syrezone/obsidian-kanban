import { JSX } from 'preact';
import { CSSProperties, createPortal, useContext, useEffect, useState } from 'preact/compat';

import { DragEventData } from '../managers/DragManager';
import { Coordinates, Entity, Hitbox } from '../types';
import { getDropDuration, transitions } from '../util/animation';
import { previewGeometry } from '../util/geometry';
import { emptyHitbox } from '../util/hitbox';
import { DndManagerContext } from './context';

export interface DragOverlayProps {
  children(entity: Entity, styles: JSX.CSSProperties): JSX.Element;
}

function getDragOverlayStyles(
  position: Coordinates,
  origin: Coordinates,
  originHitbox: Hitbox,
  scale: number,
  transition?: string,
  destination?: Coordinates
): CSSProperties {
  return {
    ...previewGeometry(originHitbox, origin, position, scale),
    ...(destination
      ? { transform: `translate3d(${destination.x}px, ${destination.y}px, 0) scale(${scale})` }
      : {}),
    transition,
  };
}

export function DragOverlay({ children }: DragOverlayProps) {
  const dndManager = useContext(DndManagerContext);

  const [dragEntity, setDragEntity] = useState<Entity | undefined>();
  const [styles, setStyles] = useState<CSSProperties | undefined>();

  useEffect(() => {
    if (!dndManager) return;

    let dragOriginHitbox: Hitbox = emptyHitbox;
    let scale = 1;
    let font: DragEventData['dragFont'];
    let dropTimer = 0;

    const dragStart = ({
      dragEntity,
      dragOrigin,
      dragPosition,
      dragOriginHitbox: originHitbox,
      dragScale,
      dragFont,
    }: DragEventData) => {
      if (!dragEntity || !dragPosition || !dragOrigin) {
        return;
      }
      dndManager.win.clearTimeout(dropTimer);
      dragOriginHitbox = originHitbox;
      scale = dragScale || 1;
      font = dragFont;
      setDragEntity(dragEntity);
      setStyles({
        ...getDragOverlayStyles(dragPosition, dragOrigin, dragOriginHitbox, scale),
        ...font,
      });
    };

    const dragMove = ({ dragOrigin, dragPosition }: DragEventData) => {
      if (!dragPosition || !dragOrigin) {
        return;
      }
      setStyles({
        ...getDragOverlayStyles(dragPosition, dragOrigin, dragOriginHitbox, scale),
        ...font,
      });
    };

    const dragEnd = ({ dragOrigin, primaryIntersection, dragPosition }: DragEventData) => {
      if (primaryIntersection && dragPosition && dragOrigin) {
        const dropHitbox = primaryIntersection.getHitbox();
        const dropDestination = {
          x: dropHitbox[0],
          y: dropHitbox[1],
        };
        const dropDuration = getDropDuration({
          position: dragPosition,
          destination: dropDestination,
        });

        const transition = transitions.drop(dropDuration);

        setStyles({
          ...getDragOverlayStyles(
            dragPosition,
            dragOrigin,
            dragOriginHitbox,
            scale,
            transition,
            dropDestination
          ),
          ...font,
        });

        dropTimer = dndManager.win.setTimeout(() => {
          setDragEntity(undefined);
          setStyles(undefined);
        }, dropDuration);
      } else {
        setDragEntity(undefined);
        setStyles(undefined);
      }
    };
    const dragCancel = () => {
      dndManager.win.clearTimeout(dropTimer);
      setDragEntity(undefined);
      setStyles(undefined);
    };

    const { emitter } = dndManager.dragManager;
    emitter.on('dragStart', dragStart);
    emitter.on('dragMove', dragMove);
    emitter.on('dragEnd', dragEnd);
    emitter.on('dragCancel', dragCancel);

    return () => {
      emitter.off('dragStart', dragStart);
      emitter.off('dragMove', dragMove);
      emitter.off('dragEnd', dragEnd);
      emitter.off('dragCancel', dragCancel);
      dndManager.win.clearTimeout(dropTimer);
    };
  }, [dndManager]);

  if (!dragEntity || !styles) {
    return null;
  }

  return createPortal(children(dragEntity, styles), dragEntity.getData().win.document.body);
}

export function useIsAnythingDragging() {
  const dndManager = useContext(DndManagerContext);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let dropTimer = 0;
    const onDragStart = () => setIsDragging(true);
    const onDragCancel = () => {
      activeWindow.clearTimeout(dropTimer);
      setIsDragging(false);
    };
    const onDragEnd = ({ primaryIntersection, dragPosition }: DragEventData) => {
      const dropHitbox = primaryIntersection?.getHitbox() || [0, 0];
      const dropDestination = {
        x: dropHitbox[0],
        y: dropHitbox[1],
      };
      const dropDuration = getDropDuration({
        position: dragPosition || dropDestination,
        destination: dropDestination,
      });

      dropTimer = activeWindow.setTimeout(() => setIsDragging(false), dropDuration);
    };

    const { emitter } = dndManager.dragManager;

    emitter.on('dragStart', onDragStart);
    emitter.on('dragEnd', onDragEnd);
    emitter.on('dragCancel', onDragCancel);

    return () => {
      emitter.off('dragStart', onDragStart);
      emitter.off('dragEnd', onDragEnd);
      emitter.off('dragCancel', onDragCancel);
      activeWindow.clearTimeout(dropTimer);
    };
  }, [dndManager]);

  return isDragging;
}
