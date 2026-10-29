import update from 'immutability-helper';
import { Menu, Notice, Platform, TFile, TFolder } from 'obsidian';
import { Dispatch, StateUpdater, useCallback } from 'preact/hooks';
import { StateManager } from 'src/StateManager';
import { t } from 'src/lang/helpers';

import { pathOf } from '../../helpers/boardIndex';
import { BoardModifiers } from '../../helpers/boardModifiers';
import { getDetailLeaf } from '../../helpers/detailPane';
import { applyTemplate, escapeRegExpStr, generateInstanceId } from '../helpers';
import { EditState, Item } from '../types';
import {
  constructDatePicker,
  constructMenuDatePickerOnChange,
  constructMenuTimePickerOnChange,
  constructTimePicker,
} from './helpers';

const illegalCharsRegEx = /[\\/:"*?<>|]+/g;
const embedRegEx = /!?\[\[([^\]]*)\.[^\]]+\]\]/g;
const wikilinkRegEx = /!?\[\[([^\]]*)\]\]/g;
const mdLinkRegEx = /!?\[([^\]]*)\]\([^)]*\)/g;
const tagRegEx = /#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s\n\r]+)/g;
const condenceWhiteSpaceRE = /\s+/g;

/** Create a note named after the card, open it (detail pane or new tab) and link it from the card. */
export async function newNoteFromCard(
  stateManager: StateManager,
  boardModifiers: BoardModifiers,
  item: Item,
  fromEl?: HTMLElement,
  openIn: 'detail' | 'tab' = 'detail'
) {
  const prevTitle = item.data.titleRaw.split('\n')[0].trim();
  const sanitizedTitle = prevTitle
    .replace(embedRegEx, '$1')
    .replace(wikilinkRegEx, '$1')
    .replace(mdLinkRegEx, '$1')
    .replace(tagRegEx, '$1')
    .replace(illegalCharsRegEx, ' ')
    .trim()
    .replace(condenceWhiteSpaceRE, ' ');

  const newNoteFolder = stateManager.getSetting('new-note-folder');
  const newNoteTemplatePath = stateManager.getSetting('new-note-template');

  const targetFolder = newNoteFolder
    ? (stateManager.app.vault.getAbstractFileByPath(newNoteFolder as string) as TFolder)
    : stateManager.app.fileManager.getNewFileParent(stateManager.file.path);

  const newFile = (await (stateManager.app.fileManager as any).createNewMarkdownFile(
    targetFolder,
    sanitizedTitle
  )) as TFile;

  const newLeaf =
    openIn === 'tab'
      ? stateManager.app.workspace.getLeaf('tab')
      : getDetailLeaf(stateManager.app, fromEl);

  await newLeaf.openFile(newFile);

  stateManager.app.workspace.setActiveLeaf(newLeaf, false, true);

  await applyTemplate(stateManager, newNoteTemplatePath as string | undefined);

  // The board may have changed during the awaits; link the card as it is now.
  const link = stateManager.app.fileManager.generateMarkdownLink(newFile, stateManager.file.path);
  let linked = false;
  if (pathOf(stateManager.state, item.id)) {
    boardModifiers.updateItem(item.id, (current) => {
      if (!current.data.titleRaw.includes(prevTitle)) return current;
      linked = true;
      // A replacer function keeps `$` in the link literal.
      return stateManager.updateItemContent(
        current,
        current.data.titleRaw.replace(prevTitle, () => link)
      );
    });
  }
  if (!linked) {
    new Notice(`Created ${newFile.basename}, but its card changed meanwhile; link it manually.`);
  }
}

interface UseItemMenuParams {
  setEditState: Dispatch<StateUpdater<EditState>>;
  item: Item;
  boardModifiers: BoardModifiers;
  stateManager: StateManager;
}

export function useItemMenu({
  setEditState,
  item,
  boardModifiers,
  stateManager,
}: UseItemMenuParams) {
  return useCallback(
    (e: MouseEvent) => {
      const coordinates = { x: e.clientX, y: e.clientY };
      const hasDate = !!item.data.metadata.date;
      const hasTime = !!item.data.metadata.time;

      const menu = new Menu().addItem((i) => {
        i.setIcon('lucide-edit')
          .setTitle(t('Edit card'))
          .onClick(() => setEditState(coordinates));
      });

      menu
        .addItem((i) => {
          i.setIcon('lucide-file-plus-2')
            .setTitle(t('New note from card'))
            .onClick(() =>
              newNoteFromCard(stateManager, boardModifiers, item, e.target as HTMLElement)
            );
        })
        .addItem((i) => {
          i.setIcon('lucide-link')
            .setTitle(t('Copy link to card'))
            .onClick(() => {
              if (item.data.blockId) {
                navigator.clipboard.writeText(
                  `${this.app.fileManager.generateMarkdownLink(
                    stateManager.file,
                    '',
                    '#^' + item.data.blockId
                  )}`
                );
              } else {
                const id = generateInstanceId(6);

                navigator.clipboard.writeText(
                  `${this.app.fileManager.generateMarkdownLink(stateManager.file, '', '#^' + id)}`
                );

                boardModifiers.updateItem(item.id, (current) =>
                  stateManager.updateItemContent(
                    update(current, { data: { blockId: { $set: id } } }),
                    current.data.titleRaw
                  )
                );
              }
            });
        })
        .addSeparator();

      if (/\n/.test(item.data.titleRaw)) {
        menu.addItem((i) => {
          i.setIcon('lucide-wrap-text')
            .setTitle(t('Split card'))
            .onClick(() => {
              boardModifiers.replaceItem(item.id, (current) =>
                current.data.titleRaw
                  .split(/[\r\n]+/g)
                  .map((title) => stateManager.getNewItem(title.trim(), ' '))
              );
            });
        });
      }

      menu
        .addItem((i) => {
          i.setIcon('lucide-copy')
            .setTitle(t('Duplicate card'))
            .onClick(() => boardModifiers.duplicateEntity(item.id));
        })
        .addItem((i) => {
          i.setIcon('lucide-list-start')
            .setTitle(t('Insert card before'))
            .onClick(() =>
              boardModifiers.insertItems(
                item.id,
                [stateManager.getNewItem('', ' ', true)],
                'before'
              )
            );
        })
        .addItem((i) => {
          i.setIcon('lucide-list-end')
            .setTitle(t('Insert card after'))
            .onClick(() =>
              boardModifiers.insertItems(item.id, [stateManager.getNewItem('', ' ', true)], 'after')
            );
        })
        .addItem((i) => {
          i.setIcon('lucide-arrow-up')
            .setTitle(t('Move to top'))
            .onClick(() => boardModifiers.moveItemToTop(item.id));
        })
        .addItem((i) => {
          i.setIcon('lucide-arrow-down')
            .setTitle(t('Move to bottom'))
            .onClick(() => boardModifiers.moveItemToBottom(item.id));
        })
        .addItem((i) => {
          i.setIcon('lucide-archive')
            .setTitle(t('Archive card'))
            .onClick(() => boardModifiers.archiveItem(item.id));
        })
        .addItem((i) => {
          i.setIcon('lucide-trash-2')
            .setTitle(t('Delete card'))
            .onClick(() => boardModifiers.deleteEntity(item.id));
        })
        .addSeparator()
        .addItem((i) => {
          i.setIcon('lucide-calendar-check')
            .setTitle(hasDate ? t('Edit date') : t('Add date'))
            .onClick(() => {
              constructDatePicker(
                e.view,
                stateManager,
                coordinates,
                constructMenuDatePickerOnChange({ stateManager, boardModifiers, item }),
                item.data.metadata.date?.toDate()
              );
            });
        });

      if (hasDate) {
        menu.addItem((i) => {
          i.setIcon('lucide-x')
            .setTitle(t('Remove date'))
            .onClick(() => {
              const shouldLinkDates = stateManager.getSetting('link-date-to-daily-note');
              const dateTrigger = stateManager.getSetting('date-trigger');
              const contentMatch = shouldLinkDates
                ? '(?:\\[[^\\]]+\\]\\([^\\)]+\\)|\\[\\[[^\\]]+\\]\\])'
                : '{[^}]+}';
              const dateRegEx = new RegExp(
                `(^|\\s)${escapeRegExpStr(dateTrigger as string)}${contentMatch}`
              );

              boardModifiers.updateItem(item.id, (current) =>
                stateManager.updateItemContent(
                  current,
                  current.data.titleRaw.replace(dateRegEx, '').trim()
                )
              );
            });
        });

        menu.addItem((i) => {
          i.setIcon('lucide-clock')
            .setTitle(hasTime ? t('Edit time') : t('Add time'))
            .onClick(() => {
              constructTimePicker(
                e.view,
                stateManager,
                coordinates,
                constructMenuTimePickerOnChange({ stateManager, boardModifiers, item }),
                item.data.metadata.time
              );
            });
        });

        if (hasTime) {
          menu.addItem((i) => {
            i.setIcon('lucide-x')
              .setTitle(t('Remove time'))
              .onClick(() => {
                const timeTrigger = stateManager.getSetting('time-trigger');
                const timeRegEx = new RegExp(
                  `(^|\\s)${escapeRegExpStr(timeTrigger as string)}{([^}]+)}`
                );

                boardModifiers.updateItem(item.id, (current) =>
                  stateManager.updateItemContent(
                    current,
                    current.data.titleRaw.replace(timeRegEx, '').trim()
                  )
                );
              });
          });
        }
      }

      menu.addSeparator();

      const addMoveToOptions = (menu: Menu) => {
        const lanes = stateManager.state.children;
        if (lanes.length <= 1) return;
        const laneIndex = pathOf(stateManager.state, item.id)?.[0];
        for (let i = 0, len = lanes.length; i < len; i++) {
          menu.addItem((menuItem) =>
            menuItem
              .setIcon('lucide-square-kanban')
              .setChecked(laneIndex === i)
              .setTitle(lanes[i].data.title)
              .onClick(() => boardModifiers.moveItemToLane(item.id, lanes[i].id, 'top'))
          );
        }
      };

      if (Platform.isPhone) {
        addMoveToOptions(menu);
      } else {
        menu.addItem((item) => {
          const submenu = (item as any)
            .setTitle(t('Move to list'))
            .setIcon('lucide-square-kanban')
            .setSubmenu();

          addMoveToOptions(submenu);
        });
      }

      menu.showAtPosition(coordinates);
    },
    [setEditState, item, boardModifiers, stateManager]
  );
}
