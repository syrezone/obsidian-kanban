import { Notice, TFile, setIcon } from 'obsidian';

import { KanbanBoard, KanbanBoardOwner } from './KanbanBoard';
import { hasFrontmatterKeyRaw } from './helpers';
import KanbanPlugin from './main';

export interface KanbanMount {
  readonly view: KanbanBoard;
  refreshGeometry(): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

/** Personal API: a component-owned board, never a workspace leaf. */
export async function mountKanbanBoard(
  plugin: KanbanPlugin,
  container: HTMLElement,
  file: TFile,
  signal?: AbortSignal
): Promise<KanbanMount> {
  const { app } = plugin;
  if (signal?.aborted) throw new Error('Kanban mount aborted.');
  if (!container.isConnected || container.ownerDocument.defaultView !== window) {
    throw new Error('Kanban embeds require a connected main-window container.');
  }
  if (app.vault.getAbstractFileByPath(file.path) !== file || file.extension !== 'md') {
    throw new Error('Kanban source must be an existing Markdown file in this vault.');
  }

  // Install cancellation before the first await, including plugin shutdown.
  let disposed = false;
  let owner: KanbanBoardOwner;
  let board: KanbanBoard;
  let root: HTMLElement;
  let timer = 0;
  let disposing: Promise<void>;
  const notifySaveFailure = (error: unknown) =>
    new Notice(`Kanban embed save failed: ${String(error)}`);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    // Plugin unload cannot await; start a debounced write instead of dropping it.
    if (timer) void owner.save().catch(notifySaveFailure);
    signal?.removeEventListener('abort', cleanup);
    if (board) {
      plugin.removeView(board);
      plugin.removeChild(board);
    }
    root?.remove();
    plugin.embeddedCleanups.delete(cleanup);
  };
  plugin.embeddedCleanups.add(cleanup);
  // Once mounted, the listener is removed: the caller must await dispose to save first.
  signal?.addEventListener('abort', cleanup, { once: true });
  const assertOpen = () => {
    if (disposed) throw new Error('Kanban mount aborted or disposed.');
  };

  try {
    const source = await app.vault.read(file);
    assertOpen();
    if (!hasFrontmatterKeyRaw(source)) throw new Error('Source is not a Kanban board.');
    root = container.createDiv({ cls: 'kanban-owned-embed' });
    const header = root.createDiv({ cls: 'kanban-owned-embed-actions' });
    const content = root.createDiv({ cls: 'view-content' });
    let lastSaved = source;
    // Our own write in progress; its modify event must not look like an external change.
    let inFlight: string | undefined;
    let writing = Promise.resolve();
    let conflict: Error;
    owner = {
      app,
      containerEl: root,
      contentEl: content,
      file,
      data: source,
      scopeId: `embed-${crypto.randomUUID()}`,
      save: () => {
        window.clearTimeout(timer);
        timer = 0;
        const data = owner.data;
        // Preserve write ordering and propagate failure; a failed queue stays failed.
        writing = writing.then(async () => {
          if (conflict) throw conflict;
          if (data === lastSaved) return;
          if (app.vault.getAbstractFileByPath(file.path) !== file)
            throw new Error('Kanban source was deleted.');
          inFlight = data;
          try {
            await app.vault.modify(file, data);
            lastSaved = data;
          } finally {
            inFlight = undefined;
          }
        });
        return writing;
      },
      requestSave: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void owner.save().catch(notifySaveFailure);
        }, 2000);
      },
      openMarkdown: () => {
        const leaf = app.workspace.getLeaf('tab');
        plugin.kanbanFileModes[(leaf as any).id] = 'markdown';
        void leaf.openFile(file);
      },
      addAction: (icon, title, callback) => {
        const button = header.createEl('button', { attr: { 'aria-label': title, title } });
        setIcon(button, icon);
        board.registerDomEvent(button, 'click', callback);
        return button;
      },
    };
    board = plugin.addChild(new KanbanBoard(plugin, owner));
    // A read-only mount must never rewrite the source. Existing state wins over
    // a disk snapshot when another native tab/embed already owns this file;
    // registerView copies that state instead of parsing.
    await plugin.addView(board, owner.data, !plugin.getStateManager(file));
    assertOpen();
    if (plugin.getStateManager(file).hasError())
      throw new Error('Kanban source could not be parsed.');
    await board.rendered;
    assertOpen();
    board.registerEvent(
      app.vault.on('modify', (changed) => {
        if (changed !== file) return;
        void app.vault
          .read(file)
          .then(async (data) => {
            if (disposed) return;
            // Our own write echoed back; pending local edits are newer, not conflicting.
            if (data === owner.data || data === inFlight) {
              lastSaved = data;
              return;
            }
            if (!hasFrontmatterKeyRaw(data)) {
              conflict = new Error('Source is no longer a Kanban board.');
              throw conflict;
            }
            // Another view (a native tab) is the writer and reloads external changes.
            if (!board.isPrimary) {
              lastSaved = data;
              return;
            }
            if (data === lastSaved) return;
            if (owner.data !== lastSaved) {
              conflict = new Error(
                'Kanban source changed externally while local edits were pending.'
              );
              throw conflict;
            }
            lastSaved = owner.data = data;
            await board.setViewData(data, false);
          })
          .catch((error) => new Notice(`Kanban embed refresh failed: ${String(error)}`));
      })
    );
    board.registerEvent(
      app.vault.on('rename', (changed, oldPath) => {
        if (changed === file) plugin.handleViewFileRename(board, oldPath);
      })
    );
    board.registerEvent(
      app.vault.on('delete', (changed) => {
        if (changed === file) {
          conflict = new Error('Kanban source was deleted.');
          new Notice(conflict.message);
        }
      })
    );
    signal?.removeEventListener('abort', cleanup);
    const flush = async () => {
      assertOpen();
      if (conflict) throw conflict;
      await board.flush();
    };
    return {
      view: board,
      refreshGeometry: () => {
        assertOpen();
        board.refreshGeometry();
      },
      flush,
      dispose: () => {
        if (disposing) return disposing;
        if (disposed) return Promise.resolve();
        root.inert = true;
        // Failed saving preserves the live board and reports the rejection.
        disposing = flush()
          .then(cleanup)
          .catch((error) => {
            disposing = undefined;
            root.inert = false;
            throw error;
          });
        return disposing;
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
