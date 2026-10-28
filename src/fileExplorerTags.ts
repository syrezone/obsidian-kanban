import { Plugin, TAbstractFile, TFile, debounce } from 'obsidian';

import { frontmatterKey } from './parsers/common';

const tagClass = 'kanban-plugin__file-tag';

interface FileItem {
  file: TAbstractFile;
  selfEl: HTMLElement;
}

/**
 * Personal change: badge Kanban Markdown files in the file explorer, like
 * Obsidian's own extension badge for non-Markdown files. File explorer items
 * are internal API, so missing items are skipped rather than reported.
 */
export function registerKanbanFileTags(plugin: Plugin) {
  const { app } = plugin;

  const isKanban = (file: TAbstractFile) =>
    file instanceof TFile &&
    file.extension === 'md' &&
    !!app.metadataCache.getFileCache(file)?.frontmatter?.[frontmatterKey];

  const fileItems = () => {
    const items: FileItem[] = [];
    for (const leaf of app.workspace.getLeavesOfType('file-explorer')) {
      items.push(
        ...Object.values(((leaf.view as any).fileItems ?? {}) as Record<string, FileItem>)
      );
    }
    return items;
  };

  const decorate = () => {
    for (const item of fileItems()) {
      if (!item.selfEl) continue;
      const tag = item.selfEl.querySelector(`:scope > .${tagClass}`);
      if (isKanban(item.file)) {
        if (!tag) item.selfEl.createDiv({ cls: `nav-file-tag ${tagClass}`, text: 'kanban' });
      } else {
        tag?.remove();
      }
    }
  };

  // Explorer items are created after vault/layout events, so decorate afterwards.
  const refresh = debounce(decorate, 100, true);
  app.workspace.onLayoutReady(refresh);
  plugin.registerEvent(app.workspace.on('layout-change', refresh));
  plugin.registerEvent(app.metadataCache.on('changed', refresh));
  plugin.registerEvent(app.vault.on('create', refresh));
  plugin.registerEvent(app.vault.on('rename', refresh));
  plugin.register(() => {
    refresh.cancel();
    for (const item of fileItems()) item.selfEl?.querySelector(`:scope > .${tagClass}`)?.remove();
  });
}
