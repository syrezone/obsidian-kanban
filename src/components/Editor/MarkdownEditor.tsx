import { insertBlankLine } from '@codemirror/commands';
import { EditorSelection, Extension, Prec } from '@codemirror/state';
import { EditorView, ViewUpdate, keymap, placeholder as placeholderExt } from '@codemirror/view';
import classcat from 'classcat';
import { EditorPosition, Editor as ObsidianEditor, Platform } from 'obsidian';
import { MutableRefObject, useContext, useEffect, useRef } from 'preact/compat';
import { KanbanBoard } from 'src/KanbanBoard';
import { StateManager } from 'src/StateManager';
import {
  clearFocusedEditorLinkHandler,
  openInDetailPane,
  setFocusedEditorLinkHandler,
  wikilinkAt,
} from 'src/helpers/detailPane';
import { registerEditorCommit } from 'src/helpers/flushBoard';
import { t } from 'src/lang/helpers';

import { KanbanContext } from '../context';
import { c, noop } from '../helpers';
import { EditState, isEditing } from '../types';
import { datePlugins, stateManagerField } from './dateWidget';
import { matchDateTrigger, matchTimeTrigger } from './suggest';

interface MarkdownEditorProps {
  editorRef?: MutableRefObject<EditorView>;
  editState?: EditState;
  onEnter: (cm: EditorView, mod: boolean, shift: boolean) => boolean;
  onEscape: (cm: EditorView) => void;
  onSubmit: (cm: EditorView) => void;
  onFlush: (cm: EditorView) => void;
  onPaste?: (e: ClipboardEvent, cm: EditorView) => void;
  onChange?: (update: ViewUpdate) => void;
  value?: string;
  className: string;
  placeholder?: string;
}

export function allowNewLine(stateManager: StateManager, mod: boolean, shift: boolean) {
  if (Platform.isMobile) return !(mod || shift);
  return stateManager.getSetting('new-line-trigger') === 'enter' ? !(mod || shift) : mod || shift;
}

function getEditorAppProxy(view: KanbanBoard) {
  return new Proxy(view.app, {
    get(target, prop, reveiver) {
      if (prop === 'vault') {
        return new Proxy(view.app.vault, {
          get(target, prop, reveiver) {
            if (prop === 'config') {
              return new Proxy((view.app.vault as any).config, {
                get(target, prop, reveiver) {
                  if (['showLineNumber', 'foldHeading', 'foldIndent'].includes(prop as string)) {
                    return false;
                  }
                  return Reflect.get(target, prop, reveiver);
                },
              });
            }
            return Reflect.get(target, prop, reveiver);
          },
        });
      }
      return Reflect.get(target, prop, reveiver);
    },
  });
}

function getMarkdownController(
  view: KanbanBoard,
  getEditor: () => ObsidianEditor
): Record<any, any> {
  return {
    app: view.app,
    showSearch: noop,
    toggleMode: noop,
    onMarkdownScroll: noop,
    getMode: () => 'source',
    scroll: 0,
    editMode: null,
    get editor() {
      return getEditor();
    },
    get file() {
      return view.file;
    },
    get path() {
      return view.file.path;
    },
  };
}

function setInsertMode(cm: EditorView) {
  const vim = getVimPlugin(cm);
  if (vim) {
    (window as any).CodeMirrorAdapter?.Vim?.enterInsertMode(vim);
  }
}

function getVimPlugin(cm: EditorView): string {
  return (cm as any)?.plugins?.find((p: any) => {
    if (!p?.value) return false;
    return 'useNextTextInput' in p.value && 'waitForCopy' in p.value;
  })?.value?.cm;
}

export function MarkdownEditor({
  editorRef,
  onEnter,
  onEscape,
  onChange,
  onPaste,
  className,
  onSubmit,
  onFlush,
  editState,
  value,
  placeholder,
}: MarkdownEditorProps) {
  const { view, stateManager } = useContext(KanbanContext);
  const elRef = useRef<HTMLDivElement>();
  const internalRef = useRef<EditorView>();
  const flushRef = useRef(onFlush);
  flushRef.current = onFlush;

  useEffect(() => {
    let disposed = false;
    let linkHandler: (() => boolean) | null = null;
    class Editor extends view.plugin.MarkdownEditor {
      isKanbanEditor = true;

      showTasksPluginAutoSuggest(
        cursor: EditorPosition,
        editor: ObsidianEditor,
        lineHasGlobalFilter: boolean
      ) {
        if (matchTimeTrigger(stateManager.getSetting('time-trigger'), editor, cursor)) return false;
        if (matchDateTrigger(stateManager.getSetting('date-trigger'), editor, cursor)) return false;
        if (lineHasGlobalFilter && cursor.line === 0) return true;
        return undefined;
      }

      updateBottomPadding() {}
      onUpdate(update: ViewUpdate, changed: boolean) {
        super.onUpdate(update, changed);
        onChange && onChange(update);
      }
      buildLocalExtensions(): Extension[] {
        const extensions = super.buildLocalExtensions();

        extensions.push(stateManagerField.init(() => stateManager));
        extensions.push(datePlugins);
        extensions.push(
          Prec.highest(
            EditorView.domEventHandlers({
              focus: (evt) => {
                view.activeEditor = this.owner;
                if (linkHandler) setFocusedEditorLinkHandler(linkHandler);
                if (Platform.isMobile) {
                  view.contentEl.addClass('is-mobile-editing');
                }

                evt.win.setTimeout(() => {
                  if (disposed) return;
                  this.app.workspace.activeEditor = this.owner;
                  if (Platform.isMobile) {
                    this.app.mobileToolbar.update();
                  }
                });
                return true;
              },
              blur: () => {
                if (linkHandler) clearFocusedEditorLinkHandler(linkHandler);
                if (Platform.isMobile) {
                  view.contentEl.removeClass('is-mobile-editing');
                  this.app.mobileToolbar.update();
                }
                return true;
              },
            })
          )
        );

        if (placeholder) extensions.push(placeholderExt(placeholder));
        if (onPaste) {
          extensions.push(
            Prec.high(
              EditorView.domEventHandlers({
                paste: onPaste,
              })
            )
          );
        }

        const makeEnterHandler = (mod: boolean, shift: boolean) => (cm: EditorView) => {
          const didRun = onEnter(cm, mod, shift);
          if (didRun) return true;
          if (this.app.vault.getConfig('smartIndentList')) {
            this.editor.newlineAndIndentContinueMarkdownList();
          } else {
            insertBlankLine(cm as any);
          }
          return true;
        };

        extensions.push(
          Prec.highest(
            keymap.of([
              {
                key: 'Enter',
                run: makeEnterHandler(false, false),
                shift: makeEnterHandler(false, true),
                preventDefault: true,
              },
              {
                key: 'Mod-Enter',
                run: makeEnterHandler(true, false),
                shift: makeEnterHandler(true, true),
                preventDefault: true,
              },
              {
                key: 'Escape',
                run: (cm) => {
                  onEscape(cm);
                  return false;
                },
                preventDefault: true,
              },
            ])
          )
        );

        return extensions;
      }
    }

    const controller = getMarkdownController(view, () => editor.editor);
    const app = getEditorAppProxy(view);
    const editor = view.addChild(new (Editor as any)(app, elRef.current, controller));
    const cm: EditorView = editor.cm;
    const unregisterCommit = registerEditorCommit(view.editorCommits, () => flushRef.current(cm));

    // Personal build: Obsidian's "follow link"/"open link in new tab" commands (Ctrl/Cmd+Enter
    // by default) run as global hotkeys. While this editor has focus they come here (see
    // registerMonkeyPatches): a [[link]] at the cursor saves the card first, then opens or
    // creates the note in the reused detail pane. Without a link the command runs as usual.
    linkHandler = () => {
      const head = cm.state.selection.main.head;
      const line = cm.state.doc.lineAt(head);
      const link = wikilinkAt(line.text, head - line.from);
      if (!link) return false;
      onSubmit(cm);
      void openInDetailPane(view.app, link, view.file.path, view.contentEl);
      return true;
    };
    if (cm.hasFocus) setFocusedEditorLinkHandler(linkHandler);

    internalRef.current = cm;
    if (editorRef) editorRef.current = cm;

    controller.editMode = editor;
    editor.set(value || '');
    if (isEditing(editState)) {
      cm.dispatch({
        userEvent: 'select.pointer',
        selection: EditorSelection.single(cm.posAtCoords(editState, false)),
      });

      cm.dom.win.setTimeout(() => {
        setInsertMode(cm);
      });
    }

    const onShow = () => {
      elRef.current.scrollIntoView({ block: 'end' });
    };

    if (Platform.isMobile) {
      cm.dom.win.addEventListener('keyboardDidShow', onShow);
    }

    return () => {
      disposed = true;
      clearFocusedEditorLinkHandler(linkHandler);
      unregisterCommit();
      if (Platform.isMobile) {
        cm.dom.win.removeEventListener('keyboardDidShow', onShow);
      }
      if (view.activeEditor === controller) view.activeEditor = null;
      if (app.workspace.activeEditor === controller) {
        app.workspace.activeEditor = null;
        if (Platform.isMobile) (app as any).mobileToolbar.update();
      }
      view.removeChild(editor);
      internalRef.current = null;
      if (editorRef) editorRef.current = null;
    };
  }, []);

  const cls = ['cm-table-widget'];
  if (className) cls.push(className);

  return (
    <>
      <div className={classcat(cls)} ref={elRef}></div>
      {Platform.isMobile && (
        <button
          onClick={() => onSubmit(internalRef.current)}
          className={classcat([c('item-submit-button'), 'mod-cta'])}
        >
          {t('Submit')}
        </button>
      )}
    </>
  );
}
