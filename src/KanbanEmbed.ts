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
  let disposing: Promise<void>;
  // Removing the last view of a file disposes its document, which starts a pending write.
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
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
    owner = {
      app,
      containerEl: root,
      contentEl: content,
      file,
      scopeId: `embed-${crypto.randomUUID()}`,
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
      onSourceLost: (error) => new Notice(`Kanban embed: ${error.message}`),
    };
    board = plugin.addChild(new KanbanBoard(plugin, owner));
    // A read-only mount must never rewrite the source. Existing state wins over
    // a disk snapshot when another native tab/embed already has this file open.
    await plugin.addView(board, source);
    assertOpen();
    if (plugin.getStateManager(file).hasError())
      throw new Error('Kanban source could not be parsed.');
    await board.rendered;
    assertOpen();
    board.registerEvent(
      app.vault.on('rename', (changed, oldPath) => {
        if (changed === file) plugin.handleViewFileRename(board, oldPath);
      })
    );
    signal?.removeEventListener('abort', cleanup);
    const flush = async () => {
      assertOpen();
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
