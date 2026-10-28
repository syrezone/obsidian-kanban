# Personal Canvas Geometry Build

Local branch `fix/personal-canvas-geometry` starts at release tag `2.0.51`
(`8501981`). Runtime marker: `plugin.personalBuild === 'embed-api-2'`
(diagnostics only; earlier `canvas-geometry-4` and `nested-cards-1`). Consumers check
`plugin.embedApiVersion === 2`, bumped when the `mountBoard()`/`KanbanMount` contract
changes (2: `view` removed, `closed` added).
Manifest ID/version remain `obsidian-kanban`/`2.0.51`; settings stay native. Branch
`feat/personal-subtasks` (from `ab53074`) adds the detail pane, nested cards and
linked-note task preview (last section). Its parser reads indented task lists as child
cards; the file stays a plain Markdown task list that upstream Kanban still opens (it
shows children as card text). This is a manually managed experimental build. Do not
replace it through community updates while testing. Personal changes are retained
in local Git commits; no remote fork, push or release has been made.

## Coordinate Contract

- Hitboxes, pointer positions and the fixed body-level preview use viewport
  coordinates. Pickup refreshes registered scroll/target/source geometry before
  sorting hides the source. Pointer movement is applied on the threshold frame.
- The preview represents the source border box. Its fractional local dimensions,
  inherited font/line height and scale are preserved; clone outer margins are
  zero. Source CSS margins remain local and contribute to sorting space only.
- `geometry.ts` converts screen drag size plus source margins into the destination
  placeholder's local dimensions. Placeholder sizes and sibling translations
  therefore remain local even at 50/200% zoom.
- Scroll state and auto-scroll speed stay local. `ScrollManager` converts each
  parent's offsets to screen units before accumulating nested hitbox shifts.
  Before a parent scroll ref mounts, offsets remain at the native zero initial
  state; child refs may initialize first. Each scroll chain's scale is measured
  when an entity is created or refreshed (pickup, `refreshGeometry()`, resize)
  and cached for per-move hit testing. Hidden lane scroll containers retain
  their last visible scale. Auto-scroll
  edge thickness remains 35 screen pixels, with the original local speed policy.
- Host transform checks apply only to sources inside an owned embed
  (`.kanban-owned-embed`); workspace tabs keep the upstream unscaled drag path.
  In embeds, support positive uniform scale and translation. Reject rotation/skew
  and nonuniform/zero source scale. Transform/zoom changes of the embed root and its
  ancestors (the host; checked each animation frame and at drop), document scroll changes, source detachment or
  pointer cancellation cancel a drag without a drop. Elements inside the embed root
  are not watched: sorting moves them with transforms during a drag, including the
  parent card of a dragged child card. Cancellation restores sort/preview/scroll state. Host resizing during
  a gesture and cross-window dragging are not validated.
- New pickup waits for the previous native drop animation to settle. This
  avoids caching transient sort positions or an old timer affecting a new drag.

Geometry owners: `DragManager`, `DragOverlay`, `SortManager`, `ScrollManager`,
`EntityManager`, manager teardown and scoped overlay CSS. Task state stays native;
nested task lists are child cards (see Nested Cards below). The personal mount API
below is experimental.

## Build & Verification

From this checkout, using the existing Yarn lockfile:

```powershell
corepack yarn@1.22.22 install --frozen-lockfile --non-interactive
node --test test/*.test.mjs
corepack yarn@1.22.22 typecheck
corepack yarn@1.22.22 build
```

All seven test files hold 72 tests; the counts per area are given in each section.

Nineteen tests cover 0.5/1/2 scale, fractional border boxes, asymmetric margins,
destination scale, pan/pointer anchoring, nested scroll shifts, real manager
refresh/sorting/cancellation, child-before-parent initialization, the animation
gate and unscaled workspace-tab pickup. Host boundaries are stubbed;
these tests do not prove real DnD, auto-scroll, saving or restore. Type checking,
production build and ESLint on changed TypeScript files pass. Repository-wide
lint fails on existing checkout CRLF and unrelated violations; no broad cleanup
was applied.

Use only `plugin-dev` and Ignis/Chromium `kanban-spike`. Keep release rollback
artifacts under each vault's `.obsidian/plugin-build-backups/obsidian-kanban/2.0.51/`.
Deploy only runtime artifacts, preserve `data.json`, then reload Kanban. Check a
normal Kanban tab, then a saved Maguilanote canvas card: repeat 50/100/200%/pan
drags, scrolling, auto-scroll, cancellation, task order and Markdown persistence.

## File Saving and Sync (BoardDocument)

One `BoardDocument` (`src/BoardDocument.ts`) per open board file, owned by its
`StateManager`, is the only owner of the file's text and its connection to disk, for
workspace tabs and owned embeds alike. Views keep no copy of the text.

- `StateManager.saveToDisk()` serializes the board into `document.update(text)`. A text
  that differs from the last saved copy is written 2 s after the first change (no timer
  reset, like Obsidian's TextFileView). `save()` writes now. Writes run one at a time
  through `vault.process`, which compares the disk with the last saved copy.
- External changes (one `modify` listener per file): the echo of our own write is
  ignored; a clean board reloads the disk text; pending edits are merged with the disk
  text line by line (`src/helpers/merge3.ts`) and a Notice says so. Where both sides
  changed the same lines, the board's lines win; where both only added lines at the
  same place, both are kept. A change that reaches disk before its event is merged the
  same way at write time. This matches Obsidian's own policy for text views.
- A deleted source, or one no longer a Kanban board, stops all saving
  (`owner.onSourceLost`): a tab of a converted note opens it as Markdown, an embed shows
  a Notice. Obsidian closes tabs of deleted files.
- A failed write rejects, shows a Notice for timed saves, restores the last saved copy
  and keeps the edits pending; the next save retries (no automatic retry loop).
- `KanbanView` routes TextFileView's `save()`, `saveImmediately()` (called by Obsidian
  when a pending edit must be written now), `requestSave` and `onModify` to the
  document; its initial file load still goes through TextFileView.
- Removing a file's last view, or plugin unload, disposes the document: it stops
  listening and starts a pending write without awaiting it.

The merge compares lines with a longest-common-subsequence table after trimming the
common start and end; very large boards changed throughout on both sides are slow to
merge. Ten tests (`test/board-document.test.mjs`) cover the merge rules, timed saving,
own-write echoes, reload, merge on change and at write time, deleted/converted sources,
failed writes and disposal; the vault is stubbed.

## Save Boundary (build 3)

`KanbanBoard.flush()` commits mounted editors in every view sharing its file,
serializes through the existing StateManager, then awaits the file's
`BoardDocument.save()`. Parse/commit/write failures reject. Renames commit directly
rather than waiting for a Preact effect; new task/list drafts submit only when
nonempty. Editor registrations follow component lifetime; cleanup releases
active editor ownership on desktop as well as mobile.

One editor per board (personal change from upstream): opening a task, list-title
or form editor first runs the other open editors' commits, exactly like Enter
(`registerEditorCommit()`). Starting any drag commits open task edits instead of
upstream's silent cancel. Escape still cancels. This applies to workspace tabs as
well as embeds.

Five save-boundary tests verify shared-editor ordering, a single document save,
awaited completion and error propagation. These stub
the native save boundary; Obsidian/Ignis save behavior and the actual editor
callbacks have passed user-guided timed Reset checks on desktop and Ignis: active task/column renames, new-task draft submission and no blank task from an empty form. Concurrent edits during flush, external writes,
plugin unload and automatic teardown are not guaranteed by this operation.

Live check: leave an existing-task rename, a new task draft or a column rename
active in a saved canvas card, then close the canvas or Remove the card and
reopen the Markdown. Empty new-task forms must not create blank tasks.
Dependency/plugin disable still uses synchronous cleanup and does not establish
save safety.

## Owned Mount (build 4)

`plugin.mountBoard(container, file, { signal? })` returns an asynchronous handle
with `closed` (resolves once the board is closed, by `dispose()` or by Kanban
unloading), `refreshGeometry()`, `flush()` and `dispose()`. The signal cancels
pending mounting only. Mount requires a connected container
in the main window and an existing valid Kanban Markdown file; it waits for
native parsing/portal layout and rolls back partial registration on failure.

`KanbanBoard.tsx` now owns shared renderer/editor/preview behavior as an Obsidian
Component. `KanbanView.tsx` adapts real workspace tabs to it. In `KanbanEmbed.ts` one
`KanbanEmbed` Component, a child of the plugin, is the board's owner (no leaf) and the
returned handle: it owns its DOM, the board as a child component and the rename event,
and unloading it (dispose, abort or plugin unload) releases all of them. Plugin unload
closes embeds before it disposes the documents, because Obsidian unloads children
first. Both use the existing
window Preact root, DnD scopes, parser and per-file StateManager. Editors are
children of their board, not the plugin. Both save through the file's shared
`BoardDocument` (above). Maguilanote never writes Kanban Markdown. Read-only
mounting does not write.

Explicit disposal disables input, commits/flushes, then unregisters/unloads the
board and removes its own DOM. Repeated disposal shares the pending promise;
failed saving preserves the board and restores interaction. External changes,
merging and lost sources follow File Saving and Sync; a lost source makes later
flushes and disposal reject.

Ten tests cover read-only mount, awaited/idempotent disposal, save failure,
plugin unload of a mounted embed, pending cancellation/shutdown, failed registration,
a document shared by two embeds, invalid sources and lost-source reporting; a
Component stub follows Obsidian's unload order. Renderer, DOM and Obsidian event behavior are stubbed;
the user confirms normal-tab and owned-host interaction, explicit/timed Reset
persistence and shared-source checks on desktop and Ignis. The saved-card
integration's live results are owned by
[Maguilanote's guide](../../maguilanote-obsidian/docs/KANBAN.md).

Maguilanote 1.2.0 persisted canvas cards are the only consumer and the live test
host (the earlier diagnostic companion was removed on 2026-10-28). Global Kanban commands in the canvas, popouts/mobile and guaranteed async
plugin-shutdown saving remain outside current support.
Synchronous shutdown force-cleans components without an awaited flush. It first
commits open card editors in every board (like Enter), then starts each document's
pending write. Any board that closes (tab, embed, plugin unload, or a tab switching
files) commits its open editors before Obsidian unloads them
(`KanbanBoard.commitEditors()`).

## File Explorer Badge

`src/fileExplorerTags.ts` adds a `kanban` badge (Obsidian's `nav-file-tag`
style, like the built-in `BOARD` badge for `.board` files) to Markdown files
whose frontmatter has `kanban-plugin`. It uses the internal file explorer
`fileItems`, refreshes after layout, metadata, create and rename events, and
removes its badges on unload. Two stubbed tests cover the badge decision and
cleanup; a changed explorer API would silently show no badges.

Workspace docs own deployment hashes, raw measurements and current runtime
results. The contracts above describe the implemented personal API; they do not
guarantee failed-write recovery or source deletion during active editing.

## Card and List Addressing

`BoardModifiers` (`src/helpers/boardModifiers.ts`) take lane and card IDs, never
paths. Each modifier resolves the ID with `pathOf` (`src/helpers/boardIndex.ts`, an
ID-to-path index cached per immutable board state) inside the `setState` call that
changes the board. Item and lane updates (`updateItem`, `replaceItem`, `updateLane`)
take a function of the *current* entity, so menus, date/time pickers, editor commits,
checkbox toggles, lane sorts and New note from card build on the card as it is when
the action runs, not as it was rendered. Inserts are `before`/`after` an ID; moves to
another list use `moveItemToLane` (`top` from the card menu, `bottom` from the table
view). An ID that no longer exists leaves the board unchanged and shows a Notice.

Scope: card and list actions. Drag-and-drop drops still use the paths of the hit
entities at drop time (refactor 2.4), and DnD scopes still encode the file path
(`scopeId:::path`, refactor 2.2). IDs are regenerated on a full parse (opening the
board or an external change), so they protect within a session, which is where the
async cases arise.

## Detail Pane, Nested Cards and Note Tasks

Applies to workspace tabs and owned embeds.

- **Detail pane** (`src/helpers/detailPane.ts`): a plain click on an internal link
  in a card opens it in one reused vertical split; later clicks replace its note. A
  closed pane, or one containing the board itself, gets a new split. Ctrl/Cmd or
  middle click keep native `openLinkText`. **New note from card** opens there too.
  Alt+click on a card (not editing, not on a link/checkbox/button) opens the card's
  note there, or runs New note from card (`newNoteFromCard`, `ItemMenu.ts`) when the
  card has none. A card's note is the first internal link in its first line
  (`cardNoteLink`): a wikilink or a Markdown link, so vaults using Markdown links work;
  URLs are skipped. New note from card links the card it finds by ID after creating
  the note, since the board may change meanwhile; if that card is gone or its first
  line changed, a Notice asks to link it manually.
  In a card editor, Ctrl/Cmd+Enter with the cursor on an internal link (`linkAt`) saves
  the card (`onSubmit`) and opens or creates the note there. Obsidian runs these as
  global hotkey commands before any editor keymap, so the existing `executeCommand`
  patch (`main.ts`) routes `editor:follow-link`, `editor:open-link-in-new-leaf` and
  `editor:open-link-in-new-split` to the focused card editor's handler
  (`setFocusedEditorLinkHandler`); without a link at the cursor the command runs as usual.
- **Nested cards (parser contract change).** Task lists indented under a card are
  child cards (`Item.children`), not card text: `splitItemChildren`/`listItemToItem`
  in `parsers/formats/list.ts`. Only unordered lists whose items are all tasks
  qualify, and they must trail the card's own content; otherwise the card keeps
  everything as text (native behavior), so plain or numbered items are never rewritten
  as tasks. Child cards are written with `-` markers. Metadata (tags, dates, links, block IDs) is read from the card's
  own content only. `itemToMd` writes children one indent unit deeper (`indentLines`,
  tab or four spaces per vault setting). Indented tasks typed into a card's editor
  become children after the existing ones. Hydration, reparse, search (a parent stays
  visible when a child matches), preview cache, duplicate (new child IDs), move to
  top/bottom (within the parent) and lane completion (`path[0]`) handle any depth.
  Archiving moves a card with its children. Lane counts include top-level cards only.
- **Rendering**: `DraggableItem` renders children inside its `Droppable` with a nested
  `Sortable`, the same `Items` component and a `SortPlaceholder`, so child paths are
  `[lane, card, child, ...]` and share the lane's scroll manager. A chevron collapses
  children (per mounted card); collapsed lists are not mounted.
- **Drag between levels**: the hovered target row has two columns.
  `DragManager.getNestIntent` sets `nestIntent` when the pointer is right of 50% of
  the target's width (viewport hitbox, so any canvas scale): left half drops as a
  sibling, right half nests.
  A translucent body-level ghost (`kanban-plugin__drop-ghost`, `SortManager`) fills the
  drop gap: full row width for a sibling, the right half for a child. It is positioned
  from on-screen rects every animation frame while shown and removed on drop/cancel.
- **One drop target**: the `SortManager` that owns the hovered target decides the drop
  once, as a `DropTarget` (`src/dnd/types.ts`): the receiving lane or card by ID (null
  for the board's lanes) and a position: before a sibling's ID, at the end (the list
  placeholder, or nesting), or `new-card` (a collapsed lane: where that board's
  new-card insertion setting puts cards, in the same or another board). Nesting goes
  into the nearest shown card above the gap (so search-hidden cards and the dragged
  card are skipped), as its last child; with no card above, the drop stays a sibling
  drop. `getDropTarget` feeds both the preview (`is-nest-parent` outline and ghost)
  and the drop; `onDrop` receives the target and `DragDropApp` performs exactly it
  (`src/helpers/dropTarget.ts`: `targetPath` resolves the IDs in the current board,
  `moveToTarget` removes the entity and resolves again). A target whose parent or
  anchor sibling is gone, or that lies inside the dragged card, changes nothing (hit
  test filter and `moveToTarget` guard). Nesting also works across boards. Hovering
  inside a card's child list sorts among the children; which hitbox wins where
  nested ones overlap is unchanged (`getBestIntersect`). Hitboxes of nested cards
  register at any depth (`EntityManager.registerDescendants`). Children of a card in
  edit mode cannot be dragged.
- **Note tasks** (`ItemSubtasks.tsx`): when the card's note (`cardNoteLink`, not
  Kanban's last-link `metadata.file`) has non-empty task list items, up to ten
  are previewed under the card with a collapsible `done/total` badge; ticking one
  rewrites only that line through `vault.process`, and only if the line still holds
  that task's text; refreshes on `metadataCache` changes.
- **Card editors** call the latest props for every handler (Enter, Escape, submit,
  flush, change, paste and Ctrl/Cmd+Enter), so a card that moved while being edited
  saves to that card wherever it now is (see Card and List Addressing).

Tests: `test/nested-cards.test.mjs` (seventeen: parse depth, metadata isolation, round-trip,
plain bullets, mixed/numbered lists, cross-depth moves; six drop-target tests: the target
`SortManager` derives for sibling, end, nesting (skipping hidden cards) and collapsed
lanes, and moves to it at any depth, guarded no-ops, lanes and the new-card position; five ID-addressing
tests: the index, updates after the card moved, a deleted card, nested insert/move/split
and list actions with collapse state; Obsidian/Dataview/DOM stubbed) and `test/subtasks.test.mjs` (eight: note tasks, stale toggles, link detection
in both styles, focused-editor routing). Rendering, drag gestures and Obsidian
events are not covered.
