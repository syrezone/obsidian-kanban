import { Menu, TFile, TextFileView, ViewStateResult, WorkspaceLeaf } from 'obsidian';

import { KanbanBoard } from './KanbanBoard';
import { KanbanViewSettings } from './Settings';
import { hasFrontmatterKeyRaw } from './helpers';
import KanbanPlugin from './main';

export const kanbanViewType = 'kanban';
export const kanbanIcon = 'lucide-trello';

/** Workspace adapter; the renderer/editor session is shared with owned embeds. */
export class KanbanView extends TextFileView {
  board: KanbanBoard;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: KanbanPlugin
  ) {
    super(leaf);
    const view = this;
    this.board = this.addChild(
      new KanbanBoard(plugin, {
        app: this.app,
        containerEl: this.containerEl,
        contentEl: this.contentEl,
        scopeId: (leaf as any).id,
        get file() {
          return view.file;
        },
        get data() {
          return view.data;
        },
        set data(data: string) {
          view.data = data;
        },
        save: () => view.save(),
        requestSave: () => view.requestSave(),
        openMarkdown: (focus = true) => {
          plugin.kanbanFileModes[(leaf as any).id || view.file.path] = 'markdown';
          void plugin.setMarkdownView(leaf, focus);
        },
        addAction: (icon, title, callback) => view.addAction(icon, title, callback),
      })
    );
  }

  get emitter() {
    return this.board.emitter;
  }
  get activeEditor() {
    return this.board.activeEditor;
  }
  set activeEditor(value: any) {
    this.board.activeEditor = value;
  }
  get viewSettings() {
    return this.board.viewSettings;
  }
  set viewSettings(value: KanbanViewSettings) {
    this.board.viewSettings = value;
  }
  setView(...args: Parameters<KanbanBoard['setView']>) {
    return this.board.setView(...args);
  }
  getBoardSettings() {
    return this.board.getBoardSettings();
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
    return this.data;
  }
  clear() {}

  async loadFile(file: TFile) {
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
        this.plugin.removeView(this.board);
        void this.plugin.addView(this.board, this.data, this.board.isPrimary);
      })
    );
  }

  handleRename(newPath: string, oldPath: string) {
    this.board.handleRename(newPath, oldPath);
  }

  setViewData(data: string, clear?: boolean) {
    if (!hasFrontmatterKeyRaw(data)) {
      this.plugin.removeView(this.board);
      this.board.owner.openMarkdown(false);
      return;
    }
    void this.board.setViewData(data, clear).catch((error) => {
      this.plugin.getStateManager(this.file)?.setError(error);
      console.error('Kanban view initialization failed', error);
    });
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    this.viewSettings = { ...state.kanbanViewState };
    await super.setState(state, result);
  }

  getState() {
    return { ...super.getState(), kanbanViewState: { ...this.viewSettings } };
  }
  onPaneMenu(menu: Menu, source: string) {
    this.board.onPaneMenu(menu, source);
    super.onPaneMenu(menu, source);
  }
}
