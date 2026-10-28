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

/**
 * One open editor per board: opening another commits the open ones exactly like
 * Enter. Returns the unregister function for the editor's cleanup.
 */
export function registerEditorCommit(commits: Set<() => void>, commit: () => void) {
  for (const other of Array.from(commits)) other();
  commits.add(commit);
  return () => commits.delete(commit);
}

/** Commit mounted native editors, then await the native primary writer. */
export async function flushBoard(manager: FlushManager): Promise<void> {
  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');

  for (const view of Array.from(manager.viewSet)) {
    for (const commit of Array.from(view.editorCommits)) commit();
  }

  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');
  // Callers flush a registered view, so the manager always has a primary writer.
  manager.saveToDisk();
  await manager.getAView().save();
}
