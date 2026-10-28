interface FlushManager {
  viewSet: Set<{ editorCommits: Set<() => void> }>;
  hasError: () => boolean;
  saveToDisk: () => void;
  document: { save: () => Promise<void> };
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

/** Commit mounted editors in every view of the board, then await the file's document. */
export async function flushBoard(manager: FlushManager): Promise<void> {
  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');

  for (const view of Array.from(manager.viewSet)) {
    for (const commit of Array.from(view.editorCommits)) commit();
  }

  if (manager.hasError()) throw new Error('Cannot flush a Kanban board with parse errors.');
  manager.saveToDisk();
  await manager.document.save();
}
