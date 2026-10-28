import { Component, Notice, TFile, setIcon } from 'obsidian';

import { KanbanBoard, KanbanBoardOwner } from './KanbanBoard';
import { hasFrontmatterKeyRaw } from './helpers';
import KanbanPlugin from './main';

export interface KanbanMount {
  /** Resolves once the board is closed: by dispose(), or by Kanban unloading. */
  readonly closed: Promise<void>;
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
  if (signal?.aborted) throw new Error('Kanban mount aborted.');
  if (!container.isConnected || container.ownerDocument.defaultView !== window) {
    throw new Error('Kanban embeds require a connected main-window container.');
  }
  if (plugin.app.vault.getAbstractFileByPath(file.path) !== file || file.extension !== 'md') {
    throw new Error('Kanban source must be an existing Markdown file in this vault.');
  }

  // A child of the plugin, so plugin unload closes it, also while it is opening.
  const embed = plugin.addChild(new KanbanEmbed(plugin, container, file));
  // Once mounted, the signal no longer applies: the caller must await dispose to save first.
  const abort = () => plugin.removeChild(embed);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await embed.open();
    return embed;
  } catch (error) {
    plugin.removeChild(embed);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Owns one embedded board: its DOM, the board component and the file's rename event.
 * Unloading it (dispose, abort or plugin unload) unregisters the board, which disposes
 * the file's document when it was the last view, and removes the DOM.
 */
class KanbanEmbed extends Component implements KanbanMount, KanbanBoardOwner {
  readonly scopeId = `embed-${crypto.randomUUID()}`;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  private header: HTMLElement;
  private board: KanbanBoard;
  private isClosed = false;
  private disposing?: Promise<void>;
  private resolveClosed: () => void;
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private plugin: KanbanPlugin,
    private container: HTMLElement,
    readonly file: TFile
  ) {
    super();
  }

  get app() {
    return this.plugin.app;
  }

  async open() {
    const source = await this.app.vault.read(this.file);
    this.assertOpen();
    if (!hasFrontmatterKeyRaw(source)) throw new Error('Source is not a Kanban board.');
    this.containerEl = this.container.createDiv({ cls: 'kanban-owned-embed' });
    this.header = this.containerEl.createDiv({ cls: 'kanban-owned-embed-actions' });
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    this.board = this.addChild(new KanbanBoard(this.plugin, this));
    // A read-only mount must never rewrite the source. Existing state wins over
    // a disk snapshot when another native tab/embed already has this file open.
    await this.plugin.addView(this.board, source);
    this.assertOpen();
    if (this.plugin.getStateManager(this.file).hasError())
      throw new Error('Kanban source could not be parsed.');
    await this.board.rendered;
    this.assertOpen();
    this.registerEvent(
      this.app.vault.on('rename', (changed, oldPath) => {
        if (changed === this.file) this.plugin.handleViewFileRename(this.board, oldPath);
      })
    );
  }

  onunload() {
    this.isClosed = true;
    this.containerEl?.remove();
    this.resolveClosed();
  }

  refreshGeometry() {
    this.assertOpen();
    this.board.refreshGeometry();
  }

  async flush() {
    this.assertOpen();
    await this.board.flush();
  }

  dispose() {
    if (this.disposing) return this.disposing;
    if (this.isClosed) return Promise.resolve();
    this.containerEl.inert = true;
    // Failed saving preserves the live board and reports the rejection.
    this.disposing = this.flush()
      .then(() => {
        this.plugin.removeChild(this);
      })
      .catch((error) => {
        this.disposing = undefined;
        this.containerEl.inert = false;
        throw error;
      });
    return this.disposing;
  }

  openMarkdown() {
    const leaf = this.app.workspace.getLeaf('tab');
    this.plugin.kanbanFileModes[(leaf as any).id] = 'markdown';
    void leaf.openFile(this.file);
  }

  addAction(icon: string, title: string, callback: (event: MouseEvent) => void) {
    const button = this.header.createEl('button', { attr: { 'aria-label': title, title } });
    setIcon(button, icon);
    this.registerDomEvent(button, 'click', callback);
    return button;
  }

  onSourceLost(error: Error) {
    new Notice(`Kanban embed: ${error.message}`);
  }

  private assertOpen() {
    if (this.isClosed) throw new Error('Kanban mount aborted or disposed.');
  }
}
