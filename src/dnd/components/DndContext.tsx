import { useEffect, useMemo, useRef } from 'preact/compat';

import { DndManager, DropHandler } from '../managers/DndManager';
import { DropTarget, Entity, WithChildren } from '../types';
import { DndScrollState } from './ScrollStateContext';
import { DndManagerContext } from './context';

interface DndContextProps extends WithChildren {
  win: Window;
  onDrop: DropHandler;
}

export function DndContext({ win, children, onDrop }: DndContextProps) {
  const onDropRef = useRef(onDrop);

  onDropRef.current = onDrop;

  const dndManager = useMemo(() => {
    return new DndManager(win, (dragEntity: Entity, dropEntity: Entity, target: DropTarget) => {
      return onDropRef.current(dragEntity, dropEntity, target);
    });
  }, []);

  useEffect(() => {
    return () => {
      dndManager.destroy();
    };
  }, [dndManager]);

  return (
    <DndManagerContext.Provider value={dndManager}>
      <DndScrollState>{children}</DndScrollState>
    </DndManagerContext.Provider>
  );
}
