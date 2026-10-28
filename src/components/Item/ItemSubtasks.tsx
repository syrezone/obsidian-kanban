import { App, TFile } from 'obsidian';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { openInDetailPane } from 'src/helpers/detailPane';
import { LinkedTask, readLinkedTasks, toggleTaskLine } from 'src/helpers/subtasks';
import { getTaskStatusDone } from 'src/parsers/helpers/inlineMetadata';

import { Icon } from '../Icon/Icon';
import { KanbanContext } from '../context';
import { c } from '../helpers';
import { Item } from '../types';

// Personal build: collapsible preview of the tasks in the note linked by the card's first line.
const MAX_LINKED_TASKS = 10;
const firstLinkRegEx = /\[\[([^\]|#^]+)/;

function useLinkedTasks(app: App, file?: TFile | null): LinkedTask[] {
  const [tasks, setTasks] = useState<LinkedTask[]>([]);

  useEffect(() => {
    if (!file) {
      setTasks([]);
      return;
    }

    let latest = 0;
    let mounted = true;
    const load = async () => {
      const request = ++latest;
      const lines =
        app.metadataCache
          .getFileCache(file)
          ?.listItems?.filter((listItem) => listItem.task !== undefined)
          .map((listItem) => listItem.position.start.line) ?? [];
      const next = lines.length ? readLinkedTasks(await app.vault.cachedRead(file), lines) : [];
      if (mounted && request === latest) setTasks(next);
    };

    void load();
    const ref = app.metadataCache.on('changed', (changed) => {
      if (changed === file) void load();
    });
    return () => {
      mounted = false;
      app.metadataCache.offref(ref);
    };
  }, [app, file]);

  return tasks;
}

export function ItemSubtasks({ item }: { item: Item }) {
  const { stateManager } = useContext(KanbanContext);
  const { app } = stateManager;
  const sourcePath = stateManager.file.path;
  const [collapsed, setCollapsed] = useState(false);

  // The card's note is the link in its first line (Kanban's metadata.file uses the last link).
  const file = useMemo(() => {
    const link = item.data.titleRaw.split('\n')[0].match(firstLinkRegEx)?.[1];
    return link ? app.metadataCache.getFirstLinkpathDest(link.trim(), sourcePath) : null;
  }, [app, item.data.titleRaw, sourcePath]);
  const linked = useLinkedTasks(app, file);

  if (!file || !linked.length) return null;
  const done = linked.filter((task) => task.checked).length;

  return (
    <div
      className={c('item-subtasks')}
      data-ignore-drag={true}
      // eslint-disable-next-line react/no-unknown-property
      onDblClick={(e) => e.stopPropagation()}
    >
      <button
        className={c('item-subtasks-badge')}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Show note tasks' : 'Hide note tasks'}
        onClick={(e) => {
          e.stopPropagation();
          setCollapsed(!collapsed);
        }}
      >
        <Icon name={collapsed ? 'lucide-chevron-right' : 'lucide-chevron-down'} />
        <Icon name="lucide-list-checks" />
        {`${done}/${linked.length}`}
      </button>
      {!collapsed && (
        <ul className={c('item-subtasks-linked')}>
          {linked.slice(0, MAX_LINKED_TASKS).map((task) => (
            <li key={task.line} className={task.checked ? 'is-checked' : undefined}>
              <input
                type="checkbox"
                className="task-list-item-checkbox"
                checked={task.checked}
                onClick={(e) => {
                  e.stopPropagation();
                  void app.vault.process(file, (data) =>
                    toggleTaskLine(data, task.line, getTaskStatusDone())
                  );
                }}
              />
              <span>{task.text}</span>
            </li>
          ))}
          {linked.length > MAX_LINKED_TASKS && (
            <li>
              <a
                className={c('item-subtasks-more')}
                onClick={(e) => {
                  e.stopPropagation();
                  void openInDetailPane(app, file.path, sourcePath, e.currentTarget);
                }}
              >
                {`+${linked.length - MAX_LINKED_TASKS} more`}
              </a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
