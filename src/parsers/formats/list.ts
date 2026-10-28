import update from 'immutability-helper';
import { Content, List, Parent, Root } from 'mdast';
import { ListItem } from 'mdast-util-from-markdown/lib';
import { toString } from 'mdast-util-to-string';
import { stringifyYaml } from 'obsidian';
import { KanbanSettings } from 'src/Settings';
import { StateManager } from 'src/StateManager';
import { generateInstanceId } from 'src/components/helpers';
import {
  Board,
  BoardTemplate,
  Item,
  ItemData,
  ItemTemplate,
  Lane,
  LaneTemplate,
} from 'src/components/types';
import { laneTitleWithMaxItems } from 'src/helpers';
import { defaultSort } from 'src/helpers/util';
import { t } from 'src/lang/helpers';
import { visit } from 'unist-util-visit';

import { archiveString, completeString, settingsToCodeblock } from '../common';
import { DateNode, FileNode, TimeNode, ValueNode } from '../extensions/types';
import {
  ContentBoundary,
  getNextOfType,
  getNodeContentBoundary,
  getPrevSibling,
  getStringFromBoundary,
} from '../helpers/ast';
import { hydrateItem, preprocessTitle } from '../helpers/hydrateBoard';
import { extractInlineFields, taskFields } from '../helpers/inlineMetadata';
import {
  addBlockId,
  dedentNewLines,
  executeDeletion,
  indentLines,
  indentNewLines,
  markRangeForDeletion,
  parseLaneTitle,
  removeBlockId,
  replaceBrs,
  replaceNewLines,
} from '../helpers/parser';
import { parseFragment } from '../parseMarkdown';

interface TaskItem extends ListItem {
  checkChar?: string;
}

// Personal build: nested task lists are child cards, not part of the card's text.
function isTaskList(node: Content): node is List {
  return (
    node.type === 'list' &&
    node.children.some((child) => child.checked !== null && child.checked !== undefined)
  );
}

/**
 * Split a list item into its own content and its child task lists. Child lists must
 * trail the content; otherwise the item keeps everything as text (native behavior).
 */
function splitItemChildren(item: TaskItem): { content: TaskItem; childLists: List[] } {
  const first = item.children.findIndex(isTaskList);
  if (first <= 0) return { content: item, childLists: [] };
  const trailing = item.children.slice(first);
  if (!trailing.every(isTaskList)) return { content: item, childLists: [] };
  return {
    content: { ...item, children: item.children.slice(0, first) },
    childLists: trailing as List[],
  };
}

export function listItemToItem(stateManager: StateManager, md: string, listItem: TaskItem): Item {
  const { childLists } = splitItemChildren(listItem);
  return {
    ...ItemTemplate,
    id: generateInstanceId(),
    data: listItemToItemData(stateManager, md, listItem),
    children: childLists.reduce<Item[]>(
      (items, list) => items.concat(list.children.map((child) => listItemToItem(stateManager, md, child))),
      []
    ),
  };
}

export function listItemToItemData(stateManager: StateManager, md: string, listItem: TaskItem) {
  const moveTags = stateManager.getSetting('move-tags');
  const moveDates = stateManager.getSetting('move-dates');
  const item = splitItemChildren(listItem).content;

  const startNode = item.children.first();
  const endNode = item.children.last();

  const start =
    startNode.type === 'paragraph'
      ? getNodeContentBoundary(startNode).start
      : startNode.position.start.offset;
  const end =
    endNode.type === 'paragraph'
      ? getNodeContentBoundary(endNode).end
      : endNode.position.end.offset;
  const itemBoundary: ContentBoundary = { start, end };

  let itemContent = getStringFromBoundary(md, itemBoundary);

  // Handle empty task
  if (itemContent === '[' + (item.checked ? item.checkChar : ' ') + ']') {
    itemContent = '';
  }

  let title = itemContent;
  let titleSearch = '';

  visit(
    item,
    ['text', 'wikilink', 'embedWikilink', 'image', 'inlineCode', 'code', 'hashtag'],
    (node: any, i, parent) => {
      if (node.type === 'hashtag') {
        if (!parent.children.first()?.value?.startsWith('```')) {
          titleSearch += ' #' + node.value;
        }
      } else {
        titleSearch += node.value || node.alt || '';
      }
    }
  );

  const itemData: ItemData = {
    titleRaw: removeBlockId(dedentNewLines(replaceBrs(itemContent))),
    blockId: undefined,
    title: '',
    titleSearch,
    titleSearchRaw: titleSearch,
    metadata: {
      dateStr: undefined,
      date: undefined,
      time: undefined,
      timeStr: undefined,
      tags: [],
      fileAccessor: undefined,
      file: undefined,
      fileMetadata: undefined,
      fileMetadataOrder: undefined,
    },
    checked: item.checked,
    checkChar: item.checked ? item.checkChar || ' ' : ' ',
  };

  visit(
    item,
    (node) => {
      return node.type !== 'paragraph';
    },
    (node, i, parent) => {
      const genericNode = node as ValueNode;

      if (genericNode.type === 'blockid') {
        itemData.blockId = genericNode.value;
        return true;
      }

      if (
        genericNode.type === 'hashtag' &&
        !(parent.children.first() as any)?.value?.startsWith('```')
      ) {
        if (!itemData.metadata.tags) {
          itemData.metadata.tags = [];
        }

        itemData.metadata.tags.push('#' + genericNode.value);

        if (moveTags) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'date' || genericNode.type === 'dateLink') {
        itemData.metadata.dateStr = (genericNode as DateNode).date;

        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'time') {
        itemData.metadata.timeStr = (genericNode as TimeNode).time;
        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'embedWikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }

      if (genericNode.type === 'wikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'link' && (genericNode as FileNode).fileAccessor) {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'embedLink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }
    }
  );

  itemData.title = preprocessTitle(stateManager, dedentNewLines(executeDeletion(title)));

  const firstLineEnd = itemData.title.indexOf('\n');
  const inlineFields = extractInlineFields(itemData.title, true);

  if (inlineFields?.length) {
    const inlineMetadata = (itemData.metadata.inlineMetadata = inlineFields.reduce((acc, curr) => {
      if (!taskFields.has(curr.key)) acc.push(curr);
      else if (firstLineEnd <= 0 || curr.end < firstLineEnd) acc.push(curr);

      return acc;
    }, []));

    const moveTaskData = stateManager.getSetting('move-task-metadata');
    const moveMetadata = stateManager.getSetting('inline-metadata-position') !== 'body';

    if (moveTaskData || moveMetadata) {
      let title = itemData.title;
      for (const item of [...inlineMetadata].reverse()) {
        const isTask = taskFields.has(item.key);

        if (isTask && !moveTaskData) continue;
        if (!isTask && !moveMetadata) continue;

        title = title.slice(0, item.start) + title.slice(item.end);
      }

      itemData.title = title;
    }
  }

  itemData.metadata.tags?.sort(defaultSort);

  return itemData;
}

function isArchiveLane(child: Content, children: Content[], currentIndex: number) {
  if (child.type !== 'heading' || toString(child, { includeImageAlt: false }) !== t('Archive')) {
    return false;
  }

  const prev = getPrevSibling(children, currentIndex);

  return prev && prev.type === 'thematicBreak';
}

export function astToUnhydratedBoard(
  stateManager: StateManager,
  settings: KanbanSettings,
  frontmatter: Record<string, any>,
  root: Root,
  md: string
): Board {
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  root.children.forEach((child, index) => {
    if (child.type === 'heading') {
      const isArchive = isArchiveLane(child, root.children, index);
      const headingBoundary = getNodeContentBoundary(child as Parent);
      const title = getStringFromBoundary(md, headingBoundary);

      let shouldMarkItemsComplete = false;

      const list = getNextOfType(root.children, index, 'list', (child) => {
        if (child.type === 'heading') return false;

        if (child.type === 'paragraph') {
          const childStr = toString(child);

          if (childStr.startsWith('%% kanban:settings')) {
            return false;
          }

          if (childStr === t('Complete')) {
            shouldMarkItemsComplete = true;
            return true;
          }
        }

        return true;
      });

      if (isArchive && list) {
        archive.push(
          ...(list as List).children.map((listItem) => listItemToItem(stateManager, md, listItem))
        );

        return;
      }

      if (!list) {
        lanes.push({
          ...LaneTemplate,
          children: [],
          id: generateInstanceId(),
          data: {
            ...parseLaneTitle(title),
            shouldMarkItemsComplete,
          },
        });
      } else {
        lanes.push({
          ...LaneTemplate,
          children: (list as List).children.map((listItem) =>
            listItemToItem(stateManager, md, listItem)
          ),
          id: generateInstanceId(),
          data: {
            ...parseLaneTitle(title),
            shouldMarkItemsComplete,
          },
        });
      }
    }
  });

  return {
    ...BoardTemplate,
    id: stateManager.file.path,
    children: lanes,
    data: {
      settings,
      frontmatter,
      archive,
      isSearching: false,
      errors: [],
    },
  };
}

export function updateItemContent(stateManager: StateManager, oldItem: Item, newContent: string) {
  const md = `- [${oldItem.data.checkChar}] ${addBlockId(indentNewLines(newContent), oldItem)}`;

  const ast = parseFragment(stateManager, md);
  const parsed = listItemToItem(stateManager, md, (ast.children[0] as List).children[0]);
  // Indented tasks typed into the card become children after the existing ones.
  const newItem = update(oldItem, {
    data: { $set: parsed.data },
    children: { $set: [...(oldItem.children ?? []), ...parsed.children] },
  });

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function newItem(
  stateManager: StateManager,
  newContent: string,
  checkChar: string,
  forceEdit?: boolean
) {
  const md = `- [${checkChar}] ${indentNewLines(newContent)}`;
  const ast = parseFragment(stateManager, md);
  const newItem = listItemToItem(stateManager, md, (ast.children[0] as List).children[0]);

  newItem.data.forceEditMode = !!forceEdit;

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function reparseBoard(stateManager: StateManager, board: Board) {
  const reparseItem = (item: Item): Item =>
    update(updateItemContent(stateManager, item, item.data.titleRaw), {
      children: { $set: (item.children ?? []).map(reparseItem) },
    });

  try {
    return update(board, {
      children: {
        $set: board.children.map((lane) => {
          return update(lane, {
            children: {
              $set: lane.children.map(reparseItem),
            },
          });
        }),
      },
    });
  } catch (e) {
    stateManager.setError(e);
    throw e;
  }
}

function itemToMd(item: Item): string {
  const md = `- [${item.data.checkChar}] ${addBlockId(indentNewLines(item.data.titleRaw), item)}`;
  if (!item.children?.length) return md;
  return [md, ...item.children.map((child) => indentLines(itemToMd(child)))].join('\n');
}

function laneToMd(lane: Lane) {
  const lines: string[] = [];

  lines.push(`## ${replaceNewLines(laneTitleWithMaxItems(lane.data.title, lane.data.maxItems))}`);

  lines.push('');

  if (lane.data.shouldMarkItemsComplete) {
    lines.push(completeString);
  }

  lane.children.forEach((item) => {
    lines.push(itemToMd(item));
  });

  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function archiveToMd(archive: Item[]) {
  if (archive.length) {
    const lines: string[] = [archiveString, '', `## ${t('Archive')}`, ''];

    archive.forEach((item) => {
      lines.push(itemToMd(item));
    });

    return lines.join('\n');
  }

  return '';
}

export function boardToMd(board: Board) {
  const lanes = board.children.reduce((md, lane) => {
    return md + laneToMd(lane);
  }, '');

  const frontmatter = ['---', '', stringifyYaml(board.data.frontmatter), '---', '', ''].join('\n');

  return frontmatter + lanes + archiveToMd(board.data.archive) + settingsToCodeblock(board);
}
