# Personal Changes

## 2026-10-29 - Board/host separation and commands in canvas cards (refactor 2.2)

Review refactor 2.2, branch `refactor/board-host`. Delegation ran both ways: the board
forwarded to a public `owner`, `KanbanView` forwarded `emitter`, `activeEditor`,
`viewSettings`, `setView` and `getBoardSettings` back to its board, `main.ts` rebuilt
board ids from `owner.scopeId` and the old path on rename, and every command looked up
`getActiveViewOfType(KanbanView)`, so boards in canvas cards got no commands or
hotkeys. Now the board depends on a private `BoardHost`; the view passthroughs are gone
(callers use `view.board`); the pane-menu source check moved to `KanbanView` while the
board keeps its menu items (`addMenuItems`, also used by the file explorer menu); a
board's id is its host's `scopeId`, so a rename only refreshes it and `DragDropApp`
compares boards' files instead of splitting ids. Commands and forwarded hotkeys act on
`getActiveBoard()`: a Kanban tab's board, or the last clicked/focused board inside the
active view (`src/helpers/boardFocus.ts`). Maguilanote's mount API is unchanged.

Tests: 74 (new `board-focus`, two; owned-mount checks rename refresh), type check,
changed-file lint and build pass. Deployed (`main.js`) to the desktop dev vault; live
check pending. Ignis not deployed.

## 2026-10-29 - Child cards can be dragged in canvas cards

User report: in a canvas card, a nested child card could not be picked up; the drag
ended at once. The owned-embed drag watcher cancels a drag when an ancestor's transform
changes (a canvas zoom or pan), but it watched every ancestor, including Kanban's own
elements; sorting shifts the child's parent card with a transform, which cancelled the
drag. Workspace tabs have no watcher, so they were not affected. It now watches only the
embed root and its ancestors (`captureHostTransform`, `DragManager`). Not caused by the
drop-target refactor. Tests: 72 (new: a shifted parent card keeps the drag, a host zoom
still cancels it; it fails without the fix), type check, changed-file lint and build
pass. Deployed to the desktop dev vault; the user confirms it works on desktop.

## 2026-10-29 - One drop target for preview and drop (refactor 2.4)

Review refactor 2.4, branch `refactor/drop-target`. The card outlined during a nesting
drag was chosen by `SortManager` from the shown cards, while the drop moved the card
by path and then `nestIntoPrevious` re-parented it under whatever card was then above
it in the data; the two agreed only by convention (they could differ with search
hiding cards), and cross-board drops ignored nesting. The owning `SortManager` now
decides one `DropTarget` (receiving lane/card ID plus position) that both the preview
and the drop use; `DragDropApp` performs it by ID (`src/helpers/dropTarget.ts`).
`nestCards.ts` is removed, and the drop handler no longer takes `nestIntent`.
Behaviour changes: nesting works across boards and follows the shown cards; a card
dropped on a collapsed lane of the same board now goes where the board's new-card
insertion setting puts cards (it went to the top; drops from another board already
followed the setting). Not done: a new rule for overlapping nested hitboxes, since no
erratic sorting has been reported and it would change how dragging feels.

Tests: 71 (six new drop-target tests replace the `nestIntoPrevious` test), type check,
changed-file lint and build pass. Deployed (`main.js`) to the desktop dev vault; the
user confirms it works on desktop. Ignis not deployed.

## 2026-10-29 - Closing a board keeps an uncommitted card edit

User report: renaming a card without confirming, then unloading Kanban, lost the new
title in tabs and canvas cards. Card editors are children of their board and Obsidian
unloads children first, so the draft was gone before anything saved; only an embed's
explicit dispose committed drafts. `KanbanBoard.unload()` now commits its open editors
(like Enter) first, plugin unload commits every board's editors before the final
writes start, and a tab switching files commits before leaving. Boards with parse
errors are skipped. Files: `src/KanbanBoard.tsx`, `src/main.ts`, `src/KanbanView.tsx`.
66 tests, type check, changed-file lint and build pass (no unit test: the real board
is not bundled in tests); deployed to the desktop dev vault. The user confirms on
desktop that an unconfirmed card edit now survives plugin unload, tab close and canvas
card close.

## 2026-10-29 - Owned embed as one Component; embed API 2 (refactor 2.5)

Review refactor 2.5, branch `refactor/embed-component`. An embed was a set of closures
with its own cleanup function, kept in a plugin-wide `embeddedCleanups` set that plugin
unload had to run by hand, and the handle exposed the internal board as `view`, which
Maguilanote used to notice that Kanban had unloaded. `KanbanEmbed` is now one Component,
a child of the plugin, that is both the board's owner and the returned handle; unloading
it releases the board, its DOM and the rename event, and plugin unload reaches it
through Obsidian's own child unloading. `embeddedCleanups` is gone. Embed API 2 replaces
`view` with a `closed` promise; build marker `embed-api-2`. Maguilanote changes in the
same step (its branch `feat/kanban-embed-api-2`).

Tests: 66 (owned-mount rewritten on a Component stub, plus plugin unload of a mounted
embed), type check, changed-file lint and production build pass. Deployed (`main.js`)
with Maguilanote to the desktop dev vault; the user confirms canvas cards work on
desktop. Ignis not deployed.

## 2026-10-29 - One BoardDocument per file for saving and sync (refactor 2.1)

Review refactor 2.1, branch `refactor/board-document`. Native tabs saved through
TextFileView (which merges external changes into pending edits), while owned embeds had
their own write queue that latched a conflict on any external change; every view also
kept its own copy of the file text, synchronized by convention. A per-file
`BoardDocument` (`src/BoardDocument.ts`, owned by `StateManager`) now holds the text,
the last saved copy, the write queue and the only modify/delete listener. Policy (user
decision): merge external changes into pending edits line by line, as Obsidian does,
for tabs and embeds alike (`src/helpers/merge3.ts`). `KanbanView` routes `save`,
`saveImmediately`, `requestSave` and `onModify` to it; `KanbanEmbed`, `KanbanBoard` and
`flushBoard` lost their save plumbing, text copies and the primary-view notion;
`addView` no longer takes a parse flag. A failed write no longer blocks later saves.

Tests: 65 (new `board-document`, ten; owned-mount and flush-board rewritten for the
document), type check, changed-file lint and production build pass. Deployed
(`main.js`) to the desktop dev vault; the user confirms on desktop: timed saving in a tab
and a canvas card, edits kept on close/quit, reload of clean boards and merge of pending
edits after outside changes, converted and deleted sources, and a tab and canvas card of
one board staying in step. Ignis not deployed.

## 2026-10-29 - Address cards and lists by ID (refactor 2.3)

Review refactor 2.3, branch `refactor/id-addressing`. Board modifiers took paths
captured at render time; with nested cards paths shift often, so an action that ran
after an await, a re-render or a change in another view could edit or remove the wrong
card. Every modifier now takes an ID, resolves it in the state it changes
(`src/helpers/boardIndex.ts`, `pathOf`) and updates the entity as it is then. A vanished
ID changes nothing and shows a Notice. Callers converted: card menu, checkbox, content
and editor commits, date/time pickers, lane header/menu/settings and sorts, add-card
form, table cells (their explicit path context is gone). `splitItem` merged into
`replaceItem`; the card menu's direct `moveEntity` became `moveItemToLane`;
`findItemPath` replaced by `pathOf`. Drag-and-drop drops are unchanged (2.4).

Tests: 57 (five new ID-addressing tests), type check, changed-file lint and production
build pass. Deployed (`main.js`) to the desktop dev vault with the review fixes below; the
user confirms both work on desktop. Ignis not deployed.

## 2026-10-29 - Review fixes for nested cards, links and embed saving

Fixes from the fork review. Build marker is now `nested-cards-1` (embed API still 1).

- Mixed nested lists (tasks plus plain or numbered items) stay card text; before, saving
  rewrote the plain items as `- [ ]` tasks (`list.ts`).
- An owned embed no longer treats the echo of its own write as an external conflict
  when newer edits are pending, and a secondary embed leaves external changes to the
  primary native tab. Either case used to latch a conflict that failed every later
  save and `dispose()` (`KanbanEmbed.ts`).
- Card links: Alt+click, note tasks and Ctrl/Cmd+Enter accept Markdown links as well as
  wikilinks (`cardNoteLink`/`linkAt`, `detailPane.ts`). In Markdown-link vaults
  Alt+click used to create a new note on every click.
- New note from card relinks the card by ID after its awaits, not by a stale path
  (`findItemPath`, `nestCards.ts`, `ItemMenu.ts`); `$` in links stays literal.
- Card editors call the latest handlers instead of first-render closures
  (`MarkdownEditor.tsx`).
- Note-task toggles change a line only if it still holds the previewed task
  (`subtasks.ts`, `ItemSubtasks.tsx`).

Tests: 52 (six new regressions, each confirmed failing without its fix), type check,
changed-file lint and production build pass. Confirmed on desktop with refactor 2.3 above. Still open: table view
does not show child cards; Archive completed ignores checked child cards.

## 2026-10-28/29 - Detail pane, nested cards and linked-note tasks

User request after comparing Kanbase and Notion. Kanbase was not adopted: tag colors,
`[[` suggest and New note from card already existed. Branch `feat/personal-subtasks`.

- **Detail pane** (`src/helpers/detailPane.ts`): card links, New note from card,
  Alt+click on a card (open first-line linked note, else New note from card) and
  Ctrl/Cmd+Enter on a `[[link]]` in a card editor open the note in one reused right
  split. Ctrl/Cmd+Enter saves the card edit first; it is routed through the existing
  `executeCommand` patch because Obsidian runs link commands before any editor keymap.
- **Nested cards**: the parser reads indented task lists as `Item.children` and writes
  them back indented (`list.ts`, `parser.ts`, `hydrateBoard.ts`); children render as
  normal draggable cards (`Item.tsx`); search, duplicate, move, completion and preview
  cache walk the tree. Drops split the target row 50/50 (sibling / child of the card
  above, `nestCards.ts`) with a translucent ghost in the gap (`SortManager.ts`); a card
  cannot be dropped into its own subtree; nested hitboxes register at any depth.
- **Linked-note tasks** (`ItemSubtasks.tsx`, `subtasks.ts`): tasks of the note linked
  in the card's first line show under the card behind a collapsible `done/total`
  badge and can be ticked.

Tried and removed during the session: checklist rows inside cards, Alt+drop text
nesting and Promote subtasks (user preferred real nested cards). Fixes found live: the
drop handler dropped the nest flag in `DndContext`; the ghost first used the target's
shifted position; Ctrl+Enter was taken by Obsidian's hotkey before scope or capture
listeners. Tests: 46 (new `nested-cards`, `subtasks`), type check, changed-file lint
and build pass. The user confirms all features on desktop. Ignis not yet deployed.

## 2026-10-28 - Kanban badge in the file explorer

User request: show a `KANBAN` badge for Kanban boards, like the `BOARD` badge
on Maguilanote canvases. Added `src/fileExplorerTags.ts`, registered in
`src/main.ts`, with `test/file-tags.test.mjs`. 35 tests, type check,
changed-file lint and build pass. Deployed to both test vaults; the user confirms
on desktop and Ignis that boards show the badge, ordinary notes do not, rename
and move keep it, and disabling Kanban removes it.

## 2026-10-28 - Commit open edits when switching or dragging

User report: double-clicking a second task left the first in edit mode
(upstream allows several open editors per board), and dragging another task
silently discarded open edits. Opening an editor now commits the board's other
open editors like Enter, and drag start commits instead of cancelling. Escape
still cancels; normal tabs change too. Paths: `src/helpers/flushBoard.ts`
(`registerEditorCommit`), `src/components/Editor/MarkdownEditor.tsx`,
`src/components/Item/Item.tsx`, `test/flush-board.test.mjs`. 33 tests, type
check, changed-file lint and build pass. Deployed to both test vaults; the user
confirms task/list-title/form switching, drag-commit and Escape on desktop and Ignis.

## 2026-10-28 - Embed and drag-geometry cleanup

Review cleanup of build 4. Behavior changes: owned-embed transform checks no
longer run for workspace tabs (removes a new Notice/refusal path from upstream
drags); scroll scale is cached at entity creation/refresh instead of measured on
every hit test; the per-move transform check is dropped (animation-frame watcher
and drop check remain); plugin unload starts a pending embed write instead of
dropping it. Added `embedApiVersion = 1` as the consumer contract. Simplified
`KanbanEmbed` to one `disposed` flag, removed the embed's duplicate state copy,
merged `addView`'s cancellation checks and removed unused `KanbanView`
pass-throughs, `transforms`, `isEqual`/`origin`, `getHitboxDimensions` and an
unreachable `flushBoard` guard. Paths: `src/KanbanEmbed.ts`, `src/KanbanView.tsx`,
`src/main.ts`, `src/dnd/**`, `src/helpers/flushBoard.ts`, tests. 32 tests (one
obsolete guard test removed, one workspace-tab pickup test added), type check,
changed-file lint and production build pass. Deployed (`main.js`) to both test
vaults; the user confirms on desktop and Ignis: normal-tab drags, canvas drags at
50/100/200% with zoom/pan cancelling mid-drag, and a pending edit saved when
Kanban is disabled within the save delay.

## 2026-10-28 - Component-owned Kanban mounting

Build `canvas-geometry-4` extracts shared `KanbanBoard` behavior from the native
TextFileView adapter and adds `KanbanEmbed`/`plugin.mountBoard()`. The personal
API mounts the existing renderer without a workspace leaf, awaits parsing/layout,
flushes before idempotent disposal and rolls back failed/pending mounts. Both
owners share StateManager/portal/DnD infrastructure and select one primary
writer. Editors now belong to the board Component. Added scoped external-source
guards and owned-host styles. Nine mount tests plus the prior 23 tests, type
check, changed-file lint and production build pass. Deployed both test vaults;
user confirms owned-mount interactions, persistence and shared-source checks on
desktop and Ignis. Maguilanote 1.2.0 saved-card acceptance also passes on both;
its guide owns the individual results. Awaited plugin-shutdown saving and
failed-write recovery remain limitations. Local commits retain the personal
implementation; no push or release.

## 2026-10-28 - Explicit editor commit and native save boundary

Build `canvas-geometry-3` adds `KanbanView.flush()` and native editor commit
registrations so a host can await committed content and the existing primary
writer before Reset. No new Markdown writer or leaf ownership model. Renames
commit synchronously; nonempty creation drafts submit through native callbacks.
Editor cleanup now releases desktop active-editor ownership too. Five save
boundary tests plus 18 geometry tests, type check, changed-file lint and build
pass. Both test vaults deployed; the user confirms timed Reset preserves active task/column renames, submits task drafts and creates no blank task from empty forms on desktop and Ignis. See [development notes](PERSONAL_DEVELOPMENT.md) for limitations.

## 2026-10-28 - Canvas geometry experiment

Build `canvas-geometry-2` fixes a captured child-before-parent mount failure in
`getScreenScrollState()`: return native zero offsets until the parent scroll
node mounts. The regression reproduces the logged exception without the guard
and passes with it. Eighteen tests/type check/changed-file lint/build pass;
user-guided desktop/Ignis recovery, geometry, ordinary persistence, scrolling and cancellation checks pass.

Added viewport/local coordinate conversions, fresh pickup geometry, scaled
border-box previews, destination-local sorting and nested scroll shifts.
Transform changes cancel without dropping; overlapping drop animations are
gated. Added runtime build marker and 17 focused regression tests. Type check,
changed-file lint and production build pass. User-guided desktop/Ignis interaction checks now pass. Native Markdown handling is unchanged; embed ownership remains
the next separate design task. See [development notes](PERSONAL_DEVELOPMENT.md).
