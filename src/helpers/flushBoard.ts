interface FlushView {
  editorCommits: Set<() => void>;
  save: () => Promise<void>;
}

interface FlushManager {
  viewSet: Set<FlushView>;
  hasError: () => boolean;
  getAView: () => FlushView;
  saveToDisk: () => void;
}

/** Commit mounted native editors, then await the native primary writer. */
export async function flushBoard(manager: FlushManager): Promise<void> {
  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');

  for (const view of Array.from(manager.viewSet)) {
    for (const commit of Array.from(view.editorCommits)) commit();
  }

  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');
  const primary = manager.getAView();
  if (!primary) throw new Error('Cannot flush a Kanban board without a native writer.');
  manager.saveToDisk();
  await primary.save();
}
