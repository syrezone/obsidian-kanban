# Personal Changes

## 2026-10-28 - Detail pane, subtask badge and Alt+drop nesting

User request after comparing Kanbase and Notion: open card notes in one right
pane, see subtasks on cards (Trello-style badge plus linked-note checklist), and
nest cards like phone to-do apps. Kanbase was not adopted; tag colors, `[[`
suggest and New note from card already existed. Added `src/helpers/detailPane.ts`,
`src/helpers/subtasks.ts`, `src/components/Item/ItemSubtasks.tsx`,
`test/subtasks.test.mjs`; changed `renderMarkdown.ts`, `Item.tsx`, `ItemMenu.ts`,
`DragManager.ts`, `SortManager.ts`, `DndManager.ts`, `DndContext.tsx`, `DragDropApp.tsx`, `en.ts`,
`styles.less`. Nesting uses Alt+drop instead of the planned hover dwell, so the
validated sorting geometry stays unchanged. 41 tests, type check, changed-file lint
and build pass. Deployed to the desktop dev vault only; not committed. User confirms
badge, checklist and collapse on desktop. First Alt+drop showed the outline but did
nothing: `DndContext` forwarded only two drop arguments; fixed and redeployed.
User then asked for TickTick-style nested tasks instead of checklist text, and
reported that nesting linked cards made the card follow the subtask's note (Kanban
uses the last link). Card task lines now render as collapsible, draggable rows;
the card's note comes from its first-line link. 46 tests, type check, changed-file
lint and build pass; redeployed to desktop. Live checks pending.
Rows were then rejected: subtasks must be the same card element at another level
(user screenshot of a tree widget). Replaced rows, Alt+drop text nesting and Promote
with real nested cards: the parser reads indented task lists as `Item.children` and
writes them back indented; children render as normal draggable cards; moving a card
more than 32 px right during a drag nests it into the card above (that card is
outlined). Kept the detail pane and, per user request, the linked-note task preview.
Added `src/helpers/nestCards.ts`, `test/nested-cards.test.mjs`; changed `list.ts`,
`parser.ts`, `hydrateBoard.ts`, `Item.tsx`, `ItemCheckbox.tsx`, `components/helpers.ts`,
`boardModifiers.ts`, `KanbanBoard.tsx`, `DragDropApp.tsx`, `DragManager.ts`,
`SortManager.ts`, `EntityManager.ts`, `styles.less`. 44 tests, type check,
changed-file lint and build pass; deployed to desktop only. Live checks pending.
User: nesting works but the drop felt odd; asked for two drop columns per row. The
target row now splits 30/70: pointer in the left 30% drops as a sibling, right 70%
nests into the card above the gap. 44 tests pass; redeployed to desktop.
User asked for a translucent preview of the landing position: a 30%-opacity ghost now
fills the gap (full width = sibling, right 70% = child). Redeployed to desktop.
Fix: the ghost overlapped the target card; sorting shifts only the inner card, so the
slot is the target's unshifted wrapper. Redeployed to desktop.
User confirmed the ghost works and asked for a 50/50 column split (`nestColumnStart`).
User: Ctrl+Enter on a typed `[[newnote]]` did not open the right pane (Kanban's editor
keymap overrides Obsidian's link following). Ctrl/Cmd+Enter on a link now saves the card
and opens or creates the note in the detail pane. 45 tests pass; redeployed to desktop.
User: it still opened a new tab in both hosts. Obsidian's global hotkey handles
Ctrl+Enter before CodeMirror, so the handler moved into an editor-focus `Scope`.
Redeployed to desktop.
Still a new tab (user, while editing with the caret in the link): the scope did not
run first either. Replaced by a capture-phase keydown listener on the editor container.
Redeployed to desktop.
Still a new tab, and the unconfirmed card edit was lost. The link commands are now
intercepted in Kanban's existing `executeCommand` patch while a card editor has focus;
the card is saved before the note opens. 46 tests pass; redeployed to desktop.
User confirms on desktop: Ctrl+Enter on a link saves the card edit and opens the note
in the right pane. Nested cards, 50/50 drop columns and the drop ghost also confirmed
working on desktop. Not committed; Ignis not deployed.
User request: Alt+click on a card as a New note from card shortcut. The menu action is
now `newNoteFromCard`; Alt+click runs it, or opens the first-line linked note in the
detail pane if one exists. 46 tests pass; deployed to desktop; user confirms it works.

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
