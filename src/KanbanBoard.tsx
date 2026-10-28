import EventEmitter from 'eventemitter3';
import update from 'immutability-helper';
import {
  App,
  Component,
  HoverParent,
  HoverPopover,
  Menu,
  Platform,
  TFile,
  debounce,
} from 'obsidian';

import { KanbanFormat, KanbanSettings, KanbanViewSettings, SettingsModal } from './Settings';
import { Kanban } from './components/Kanban';
import { BasicMarkdownRenderer } from './components/MarkdownRenderer/MarkdownRenderer';
import { c } from './components/helpers';
import { Board } from './components/types';
import { DndManager } from './dnd/managers/DndManager';
import { getParentWindow } from './dnd/util/getWindow';
import { gotoNextDailyNote, gotoPrevDailyNote, hasFrontmatterKeyRaw } from './helpers';
import { flushBoard } from './helpers/flushBoard';
import { bindMarkdownEvents } from './helpers/renderMarkdown';
import { PromiseQueue } from './helpers/util';
import { t } from './lang/helpers';
import KanbanPlugin from './main';
import { frontmatterKey } from './parsers/common';

export interface KanbanBoardOwner {
  app: App;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  file: TFile;
  data: string;
  scopeId: string;
  save(): Promise<void>;
  requestSave(): void;
  openMarkdown(focus?: boolean): void;
  addAction(icon: string, title: string, callback: (event: MouseEvent) => void): HTMLElement;
}

export class KanbanBoard extends Component implements HoverParent {
  dndManager: DndManager;
  private resolveRendered: () => void;
  rendered = new Promise<void>((resolve) => {
    this.resolveRendered = resolve;
  });
  markRendered(manager: DndManager) {
    this.dndManager = manager;
    this.resolveRendered();
  }
  refreshGeometry() {
    if (!this.dndManager) throw new Error('Kanban renderer is not ready.');
    if (this.dndManager.dragManager.dragEntity) throw new Error('Cannot refresh during a drag.');
    for (const entity of this.dndManager.scrollEntities.values()) {
      if (entity.scopeId === this.id) entity.recalcInitial();
    }
    for (const entity of this.dndManager.hitboxEntities.values()) {
      if (entity.scopeId === this.id) entity.recalcInitial();
    }
  }
  get app() {
    return this.owner.app;
  }
  get containerEl() {
    return this.owner.containerEl;
  }
  get contentEl() {
    return this.owner.contentEl;
  }
  get file() {
    return this.owner.file;
  }
  get data() {
    return this.owner.data;
  }
  set data(value: string) {
    this.owner.data = value;
  }
  save() {
    return this.owner.save();
  }
  requestSave() {
    this.owner.requestSave();
  }
  addAction(icon: string, title: string, callback: (event: MouseEvent) => void) {
    return this.owner.addAction(icon, title, callback);
  }

  plugin: KanbanPlugin;
  hoverPopover: HoverPopover | null;
  emitter: EventEmitter;
  actionButtons: Record<string, HTMLElement> = {};

  previewCache: Map<string, BasicMarkdownRenderer>;
  previewQueue: PromiseQueue;

  activeEditor: any;
  editorCommits = new Set<() => void>();
  viewSettings: KanbanViewSettings = {};

  get isPrimary(): boolean {
    return this.plugin.getStateManager(this.file)?.getAView() === this;
  }

  get id(): string {
    return `${this.owner.scopeId}:::${this.file?.path}`;
  }

  get isShiftPressed(): boolean {
    return this.plugin.isShiftPressed;
  }

  constructor(
    plugin: KanbanPlugin,
    public owner: KanbanBoardOwner
  ) {
    super();
    this.plugin = plugin;
    this.emitter = new EventEmitter();
    this.previewCache = new Map();

    this.previewQueue = new PromiseQueue(() => this.emitter.emit('queueEmpty'));

    this.emitter.on('hotkey', ({ commandId }) => {
      switch (commandId) {
        case 'daily-notes:goto-prev': {
          gotoPrevDailyNote(this.app, this.file);
          break;
        }
        case 'daily-notes:goto-next': {
          gotoNextDailyNote(this.app, this.file);
          break;
        }
      }
    });

    bindMarkdownEvents(this);
  }

  async prerender(board: Board) {
    board.children.forEach((lane) => {
      lane.children.forEach((item) => {
        if (this.previewCache.has(item.id)) return;

        this.previewQueue.add(async () => {
          const preview = this.addChild(new BasicMarkdownRenderer(this, item.data.title));
          this.previewCache.set(item.id, preview);
          await preview.renderCapability.promise;
        });
      });
    });

    if (this.previewQueue.isRunning) {
      await new Promise((res) => {
        this.emitter.once('queueEmpty', res);
      });
    }

    this.initHeaderButtons();
  }

  validatePreviewCache(board: Board) {
    const seenKeys = new Set<string>();
    board.children.forEach((lane) => {
      seenKeys.add(lane.id);
      lane.children.forEach((item) => {
        seenKeys.add(item.id);
      });
    });

    for (const k of this.previewCache.keys()) {
      if (!seenKeys.has(k)) {
        this.removeChild(this.previewCache.get(k));
        this.previewCache.delete(k);
      }
    }
  }

  setView(view: KanbanFormat) {
    this.setViewState(frontmatterKey, view);
    this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
      frontmatter[frontmatterKey] = view;
    });
  }

  setBoard(board: Board, shouldSave: boolean = true) {
    const stateManager = this.plugin.stateManagers.get(this.file);
    stateManager.setState(board, shouldSave);
  }

  getBoard(): Board {
    const stateManager = this.plugin.stateManagers.get(this.file);
    return stateManager.state;
  }

  getWindow() {
    return getParentWindow(this.containerEl) as Window & typeof globalThis;
  }

  onload() {
    super.onload();
    if (Platform.isMobile) {
      this.containerEl.setCssProps({
        '--mobile-navbar-height': (this.app as any).mobileNavbar.containerEl.clientHeight + 'px',
      });
    }
  }

  onunload(): void {
    super.onunload();
    this.resolveRendered();
    if (this.dndManager?.dragManager.dragEntity?.scopeId === this.id) {
      this.dndManager.dragManager.cancelDrag();
    }

    this.previewQueue.clear();
    this.previewCache.clear();
    this.emitter.emit('queueEmpty');

    // Remove draggables from render, as the DOM has already detached
    this.plugin.removeView(this);
    this.emitter.removeAllListeners();
    this.activeEditor = null;
    this.actionButtons = {};
  }

  handleRename(newPath: string, oldPath: string) {
    if (this.file.path === newPath) {
      this.plugin.handleViewFileRename(this, oldPath);
    }
  }

  requestSaveToDisk(data: string) {
    if (this.data !== data && this.isPrimary) {
      this.data = data;
      this.requestSave();
    } else {
      this.data = data;
    }
  }

  async flush(): Promise<void> {
    const file = this.file;
    const manager = this.plugin.getStateManager(file);
    if (!file || !manager || !manager.viewSet.has(this)) {
      throw new Error('Cannot flush an unregistered Kanban view.');
    }
    await flushBoard(manager);
    if (this.file !== file || !manager.viewSet.has(this)) {
      throw new Error('Kanban view changed or closed while flushing.');
    }
  }

  setViewData(data: string, clear?: boolean) {
    if (!hasFrontmatterKeyRaw(data)) throw new Error('The source is no longer a Kanban board.');

    if (clear) {
      this.activeEditor = null;
      this.previewQueue.clear();
      this.previewCache.clear();
      this.emitter.emit('queueEmpty');
      Object.values(this.actionButtons).forEach((b) => b.remove());
      this.actionButtons = {};
    }

    return this.plugin.addView(this, data, !clear && this.isPrimary);
  }

  setViewState<K extends keyof KanbanViewSettings>(
    key: K,
    val?: KanbanViewSettings[K],
    globalUpdater?: (old: KanbanViewSettings[K]) => KanbanViewSettings[K]
  ) {
    if (globalUpdater) {
      const stateManager = this.plugin.getStateManager(this.file);
      stateManager.viewSet.forEach((view) => {
        view.viewSettings[key] = globalUpdater(view.viewSettings[key]);
      });
    } else if (val) {
      this.viewSettings[key] = val;
    }

    this.app.workspace.requestSaveLayout();
  }

  populateViewState(settings: KanbanSettings) {
    this.viewSettings['kanban-plugin'] ??= settings['kanban-plugin'] || 'board';
    this.viewSettings['list-collapse'] ??= settings['list-collapse'] || [];
  }

  getViewState<K extends keyof KanbanViewSettings>(key: K) {
    const stateManager = this.plugin.stateManagers.get(this.file);
    const settingVal = stateManager.getSetting(key);
    return this.viewSettings[key] ?? settingVal;
  }

  useViewState<K extends keyof KanbanViewSettings>(key: K) {
    const stateManager = this.plugin.stateManagers.get(this.file);
    const settingVal = stateManager.useSetting(key);
    return this.viewSettings[key] ?? settingVal;
  }

  getPortal() {
    const stateManager = this.plugin.stateManagers.get(this.file);
    return <Kanban stateManager={stateManager} view={this} />;
  }

  getBoardSettings() {
    const stateManager = this.plugin.stateManagers.get(this.file);
    const board = stateManager.state;

    new SettingsModal(
      this,
      {
        onSettingsChange: (settings) => {
          const updatedBoard = update(board, {
            data: {
              settings: {
                $set: settings,
              },
            },
          });

          // Save to disk, compute text of new board
          stateManager.setState(updatedBoard);
        },
      },
      board.data.settings
    ).open();
  }

  onPaneMenu(menu: Menu, source: string) {
    if (source !== 'more-options') {
      return;
    }
    // Add a menu item to force the board to markdown view
    menu
      .addItem((item) => {
        item
          .setTitle(t('Open as markdown'))
          .setIcon('lucide-file-text')
          .setSection('pane')
          .onClick(() => {
            this.owner.openMarkdown();
          });
      })
      .addItem((item) => {
        item
          .setTitle(t('Open board settings'))
          .setIcon('lucide-settings')
          .setSection('pane')
          .onClick(() => {
            this.getBoardSettings();
          });
      })
      .addItem((item) => {
        item
          .setTitle(t('Archive completed cards'))
          .setIcon('lucide-archive')
          .setSection('pane')
          .onClick(() => {
            const stateManager = this.plugin.stateManagers.get(this.file);
            stateManager.archiveCompletedCards();
          });
      });
  }

  initHeaderButtons = debounce(() => this._initHeaderButtons(), 10, true);

  _initHeaderButtons = async () => {
    if (!(this as any)._loaded) return;
    if (Platform.isPhone) return;
    const stateManager = this.plugin.getStateManager(this.file);

    if (!stateManager) return;

    if (
      stateManager.getSetting('show-board-settings') &&
      !this.actionButtons['show-board-settings']
    ) {
      this.actionButtons['show-board-settings'] = this.addAction(
        'lucide-settings',
        t('Open board settings'),
        () => {
          this.getBoardSettings();
        }
      );
    } else if (
      !stateManager.getSetting('show-board-settings') &&
      this.actionButtons['show-board-settings']
    ) {
      this.actionButtons['show-board-settings'].remove();
      delete this.actionButtons['show-board-settings'];
    }

    if (stateManager.getSetting('show-set-view') && !this.actionButtons['show-set-view']) {
      this.actionButtons['show-set-view'] = this.addAction(
        'lucide-view',
        t('Board view'),
        (evt) => {
          const view = this.viewSettings[frontmatterKey] || stateManager.getSetting(frontmatterKey);
          new Menu()
            .addItem((item) =>
              item
                .setTitle(t('View as board'))
                .setIcon('lucide-trello')
                .setChecked(view === 'basic' || view === 'board')
                .onClick(() => this.setView('board'))
            )
            .addItem((item) =>
              item
                .setTitle(t('View as table'))
                .setIcon('lucide-table')
                .setChecked(view === 'table')
                .onClick(() => this.setView('table'))
            )
            .addItem((item) =>
              item
                .setTitle(t('View as list'))
                .setIcon('lucide-server')
                .setChecked(view === 'list')
                .onClick(() => this.setView('list'))
            )
            .showAtMouseEvent(evt);
        }
      );
    } else if (!stateManager.getSetting('show-set-view') && this.actionButtons['show-set-view']) {
      this.actionButtons['show-set-view'].remove();
      delete this.actionButtons['show-set-view'];
    }

    if (stateManager.getSetting('show-search') && !this.actionButtons['show-search']) {
      this.actionButtons['show-search'] = this.addAction('lucide-search', t('Search...'), () => {
        this.emitter.emit('hotkey', { commandId: 'editor:open-search' });
      });
    } else if (!stateManager.getSetting('show-search') && this.actionButtons['show-search']) {
      this.actionButtons['show-search'].remove();
      delete this.actionButtons['show-search'];
    }

    if (
      stateManager.getSetting('show-view-as-markdown') &&
      !this.actionButtons['show-view-as-markdown']
    ) {
      this.actionButtons['show-view-as-markdown'] = this.addAction(
        'lucide-file-text',
        t('Open as markdown'),
        () => {
          this.owner.openMarkdown();
        }
      );
    } else if (
      !stateManager.getSetting('show-view-as-markdown') &&
      this.actionButtons['show-view-as-markdown']
    ) {
      this.actionButtons['show-view-as-markdown'].remove();
      delete this.actionButtons['show-view-as-markdown'];
    }

    if (stateManager.getSetting('show-archive-all') && !this.actionButtons['show-archive-all']) {
      this.actionButtons['show-archive-all'] = this.addAction(
        'lucide-archive',
        t('Archive completed cards'),
        () => {
          const stateManager = this.plugin.stateManagers.get(this.file);
          stateManager.archiveCompletedCards();
        }
      );
    } else if (
      !stateManager.getSetting('show-archive-all') &&
      this.actionButtons['show-archive-all']
    ) {
      this.actionButtons['show-archive-all'].remove();
      delete this.actionButtons['show-archive-all'];
    }

    if (stateManager.getSetting('show-add-list') && !this.actionButtons['show-add-list']) {
      const btn = this.addAction('lucide-plus-circle', t('Add a list'), () => {
        this.emitter.emit('showLaneForm', undefined);
      });

      btn.addClass(c('ignore-click-outside'));

      this.actionButtons['show-add-list'] = btn;
    } else if (!stateManager.getSetting('show-add-list') && this.actionButtons['show-add-list']) {
      this.actionButtons['show-add-list'].remove();
      delete this.actionButtons['show-add-list'];
    }
  };
}
