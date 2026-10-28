import { Menu, TFile, TextFileView, ViewStateResult, WorkspaceLeaf } from 'obsidian';

import { KanbanBoard } from './KanbanBoard';
import { hasFrontmatterKeyRaw } from './helpers';
import KanbanPlugin from './main';

export const kanbanViewType = 'kanban';
export const kanbanIcon = 'lucide-trello';

/**
 * Workspace adapter and the board's host for a tab; the renderer/editor session is shared
 * with owned embeds. Callers use `board` directly. Saving and external changes belong to
 * the file's BoardDocument, so TextFileView's own save, reload and merge paths are routed
 * to it.
 */
export class KanbanView extends TextFileView {
  board: KanbanBoard;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: KanbanPlugin
  ) {
    super(leaf);
    const view = this;
    this.requestSave = () => this.document?.requestSave();
    this.board = this.addChild(
      new KanbanBoard(plugin, {
        app: this.app,
        containerEl: this.containerEl,
        contentEl: this.contentEl,
        scopeId: (leaf as any).id,
        get file() {
          return view.file;
        },
        openMarkdown: (focus = true) => {
          plugin.kanbanFileModes[(leaf as any).id || view.file.path] = 'markdown';
          void plugin.setMarkdownView(leaf, focus);
        },
        addAction: (icon, title, callback) => view.addAction(icon, title, callback),
        onSourceLost: () => {
          // Obsidian closes tabs of deleted files; a converted note opens as Markdown.
          if (view.app.vault.getAbstractFileByPath(view.file?.path) !== view.file) return;
          plugin.removeView(view.board);
          view.board.openMarkdown(false);
        },
      })
    );
  }

  get document() {
    return this.plugin.getStateManager(this.file)?.document;
  }

  getViewType() {
    return kanbanViewType;
  }
  getIcon() {
    return kanbanIcon;
  }
  getDisplayText() {
    return this.file?.basename || 'Kanban';
  }
  getViewData() {
    return this.document?.text ?? this.data;
  }
  clear() {}

  async save() {
    await this.document?.save();
  }

  /** Obsidian calls this when a pending edit must be written now (e.g. before quitting). */
  saveImmediately() {
    return this.document?.isDirty ? this.document.save() : undefined;
  }

  /** The file's BoardDocument handles external changes for all of its views. */
  onModify() {}

  async loadFile(file: TFile) {
    this.board.commitEditors();
    this.plugin.removeView(this.board);
    // @ts-expect-error Obsidian runtime method absent from public typings.
    return super.loadFile(file);
  }

  async onLoadFile(file: TFile) {
    try {
      return await super.onLoadFile(file);
    } catch (error) {
      this.plugin.getStateManager(this.file)?.setError(error);
      throw error;
    }
  }

  onload() {
    super.onload();
    this.register(
      this.containerEl.onWindowMigrated(() => {
        // Read the text first: removing the last view disposes the document.
        const text = this.getViewData();
        this.plugin.removeView(this.board);
        void this.plugin.addView(this.board, text);
      })
    );
  }

  handleRename(newPath: string) {
    if (this.file?.path === newPath) this.board.onFileRenamed();
  }

  setViewData(data: string, clear?: boolean) {
    if (!hasFrontmatterKeyRaw(data)) {
      this.plugin.removeView(this.board);
      this.board.openMarkdown(false);
      return;
    }
    void this.board.setViewData(data, clear).catch((error) => {
      this.plugin.getStateManager(this.file)?.setError(error);
      console.error('Kanban view initialization failed', error);
    });
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    this.board.viewSettings = { ...state.kanbanViewState };
    await super.setState(state, result);
  }

  getState() {
    return { ...super.getState(), kanbanViewState: { ...this.board.viewSettings } };
  }
  onPaneMenu(menu: Menu, source: string) {
    if (source === 'more-options') this.board.addMenuItems(menu);
    super.onPaneMenu(menu, source);
  }
}
