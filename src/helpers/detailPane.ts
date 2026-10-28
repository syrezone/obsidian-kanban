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

export function openInDetailPane(
  app: App,
  linktext: string,
  sourcePath: string,
  fromEl?: HTMLElement
) {
  // openLinkText(..., false) opens in the active leaf; it also creates unresolved notes.
  app.workspace.setActiveLeaf(getDetailLeaf(app, fromEl), { focus: true });
  return app.workspace.openLinkText(linktext, sourcePath, false);
}

// `[[target|alias]]` or `[text](target)`, either optionally embedded with `!`.
const internalLinkRegEx = /!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\(([^)]+)\)/g;

/** Link text for openLinkText, or null for an empty or external (URL) link. */
function linktextOf(match: RegExpExecArray): string | null {
  if (match[1] !== undefined) return match[1].split('|')[0].trim() || null;
  let target = match[2].trim().replace(/^<(.*)>$/, '$1');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  try {
    target = decodeURI(target);
  } catch {
    // Not percent-encoded; use it as written.
  }
  return target || null;
}

/** The internal link (wikilink or Markdown link) that contains or touches column `ch`. */
export function linkAt(text: string, ch: number): string | null {
  const linkRegEx = new RegExp(internalLinkRegEx);
  let match: RegExpExecArray | null;
  while ((match = linkRegEx.exec(text))) {
    if (ch >= match.index && ch <= match.index + match[0].length) return linktextOf(match);
  }
  return null;
}

/** A card's note: the first internal link in the first line of its Markdown. */
export function cardNoteLink(titleRaw: string): string | null {
  const linkRegEx = new RegExp(internalLinkRegEx);
  const firstLine = titleRaw.split('\n')[0];
  let match: RegExpExecArray | null;
  while ((match = linkRegEx.exec(firstLine))) {
    const linktext = linktextOf(match);
    if (linktext) return linktext;
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
