import { App, WorkspaceLeaf } from 'obsidian';

// Personal build: card notes open in one reused split to the right.
const detailLeaves = new WeakMap<App, WorkspaceLeaf>();

/** The reused detail leaf, or a new vertical split when it was closed or holds `fromEl`. */
export function getDetailLeaf(app: App, fromEl?: HTMLElement): WorkspaceLeaf {
  const leaf = detailLeaves.get(app);
  let attached = false;
  if (leaf) app.workspace.iterateAllLeaves((candidate) => (attached ||= candidate === leaf));
  if (leaf && attached && !(fromEl && leaf.view.containerEl.contains(fromEl))) return leaf;

  const created = app.workspace.getLeaf('split', 'vertical');
  detailLeaves.set(app, created);
  return created;
}

export function openInDetailPane(app: App, linktext: string, sourcePath: string, fromEl?: HTMLElement) {
  // openLinkText(..., false) opens in the active leaf; it also creates unresolved notes.
  app.workspace.setActiveLeaf(getDetailLeaf(app, fromEl), { focus: true });
  return app.workspace.openLinkText(linktext, sourcePath, false);
}

/** The `[[link]]` (without alias) that contains or touches column `ch` of a line. */
export function wikilinkAt(text: string, ch: number): string | null {
  const linkRegEx = /!?\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegEx.exec(text))) {
    if (ch >= match.index && ch <= match.index + match[0].length) {
      return match[1].split('|')[0].trim() || null;
    }
  }
  return null;
}

// Obsidian's link-opening editor commands, redirected while a Kanban card editor has focus.
export const linkCommandIds = new Set([
  'editor:follow-link',
  'editor:open-link-in-new-leaf',
  'editor:open-link-in-new-split',
]);

let focusedEditorLinkHandler: (() => boolean) | null = null;

/** The focused card editor's handler; it returns true when it opened a link itself. */
export function setFocusedEditorLinkHandler(handler: (() => boolean) | null) {
  focusedEditorLinkHandler = handler;
}

export function clearFocusedEditorLinkHandler(handler: () => boolean) {
  if (focusedEditorLinkHandler === handler) focusedEditorLinkHandler = null;
}

export function runFocusedEditorLinkHandler(): boolean {
  return !!focusedEditorLinkHandler?.();
}
