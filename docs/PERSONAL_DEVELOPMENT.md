# Personal Canvas Geometry Build

Local branch `fix/personal-canvas-geometry` starts at release tag `2.0.51`
(`8501981`). Runtime marker: `plugin.personalBuild === 'canvas-geometry-4'`
(diagnostics only). Consumers check `plugin.embedApiVersion === 1`, bumped when
the `mountBoard()`/`KanbanMount` contract changes.
Manifest ID/version remain `obsidian-kanban`/`2.0.51`; settings and Markdown
ownership stay native. This is a manually managed experimental build. Do not
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
  and nonuniform/zero source scale. Ancestor transform/zoom changes (checked each
  animation frame and at drop), document scroll changes, source detachment or
  pointer cancellation cancel a drag without a drop. Cancellation restores sort/preview/scroll state. Host resizing during
  a gesture and cross-window dragging are not validated.
- New pickup waits for the previous native drop animation to settle. This
  avoids caching transient sort positions or an old timer affecting a new drag.

Geometry owners: `DragManager`, `DragOverlay`, `SortManager`, `ScrollManager`,
`EntityManager`, manager teardown and scoped overlay CSS. Parser, task state and
Markdown serialization remains native. The personal mount API below is experimental.

## Build & Verification

From this checkout, using the existing Yarn lockfile:

```powershell
corepack yarn@1.22.22 install --frozen-lockfile --non-interactive
node --test test/canvas-geometry.test.mjs test/flush-board.test.mjs test/owned-mount.test.mjs test/file-tags.test.mjs test/subtasks.test.mjs test/nested-cards.test.mjs
corepack yarn@1.22.22 typecheck
corepack yarn@1.22.22 build
```

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

## Save Boundary (build 3)

`KanbanBoard.flush()` commits mounted editors in every view sharing its file,
serializes through the existing StateManager, then awaits the primary native
`TextFileView.save()`. Parse/commit/write failures reject. Renames commit directly
rather than waiting for a Preact effect; new task/list drafts submit only when
nonempty. Editor registrations follow component lifetime; cleanup releases
active editor ownership on desktop as well as mobile.

One editor per board (personal change from upstream): opening a task, list-title
or form editor first runs the other open editors' commits, exactly like Enter
(`registerEditorCommit()`). Starting any drag commits open task edits instead of
upstream's silent cancel. Escape still cancels. This applies to workspace tabs as
well as embeds.

Five save-boundary tests verify shared-editor ordering, primary-only writing,
awaited completion and error propagation (plus 19 geometry, nine owned-mount and two file-tag tests; 35 total). These stub
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
with `view` (diagnostic access), `refreshGeometry()`, `flush()` and `dispose()`.
The signal cancels pending mounting only. Mount requires a connected container
in the main window and an existing valid Kanban Markdown file; it waits for
native parsing/portal layout and rolls back partial registration on failure.

`KanbanBoard.tsx` now owns shared renderer/editor/preview behavior as an Obsidian
Component. `KanbanView.tsx` adapts real workspace tabs to it; `KanbanEmbed.ts`
provides a component/container owner without a leaf. Both use the existing
window Preact root, DnD scopes, parser and per-file StateManager. Editors are
children of their board, not the plugin. Native tabs still save through
TextFileView; an embedded primary uses a serialized Obsidian vault writer.
Only StateManager's selected primary schedules saves. Maguilanote never writes
Kanban Markdown. Read-only mounting does not write.

Explicit disposal disables input, commits/flushes, then unregisters/unloads the
board and removes its own DOM. Repeated disposal shares the pending promise;
failed saving preserves the board and restores interaction. Failed write queues
stay failed and report errors; there is no automatic retry. Scoped file events
refresh clean external changes and report conflicting pending edits, source
conversion or deletion. These guards do not provide concurrent-write merging.

Nine tests cover read-only mount, awaited/idempotent disposal, save failure,
pending cancellation/shutdown, failed registration, shared primary writing and
invalid/converted sources. Renderer, DOM and Obsidian event behavior are stubbed;
the user confirms normal-tab and owned-host interaction, explicit/timed Reset
persistence and shared-source checks on desktop and Ignis. The saved-card
integration's live results are owned by
[Maguilanote's guide](../../maguilanote-obsidian/docs/KANBAN.md).

Maguilanote 1.2.0 persisted canvas cards are the only consumer and the live test
host (the earlier diagnostic companion was removed on 2026-10-28). Global Kanban commands in the canvas, popouts/mobile and guaranteed async
plugin-shutdown saving remain outside current support.
Synchronous shutdown force-cleans components without an awaited flush; it starts
an embed's pending debounced write but does not commit open editor drafts.

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

## Detail Pane, Nested Cards and Note Tasks

Applies to workspace tabs and owned embeds.

- **Detail pane** (`src/helpers/detailPane.ts`): a plain click on an internal link
  in a card opens it in one reused vertical split; later clicks replace its note. A
  closed pane, or one containing the board itself, gets a new split. Ctrl/Cmd or
  middle click keep native `openLinkText`. **New note from card** opens there too.
  Alt+click on a card (not editing, not on a link/checkbox/button) opens the note
  linked in its first line there, or runs New note from card (`newNoteFromCard`,
  `ItemMenu.ts`) when the first line has no `[[link]]`.
  In a card editor, Ctrl/Cmd+Enter with the cursor on a `[[link]]` (`wikilinkAt`) saves
  the card (`onSubmit`) and opens or creates the note there. Obsidian runs these as
  global hotkey commands before any editor keymap, so the existing `executeCommand`
  patch (`main.ts`) routes `editor:follow-link`, `editor:open-link-in-new-leaf` and
  `editor:open-link-in-new-split` to the focused card editor's handler
  (`setFocusedEditorLinkHandler`); without a link at the cursor the command runs as usual.
- **Nested cards (parser contract change).** Task lists indented under a card are
  child cards (`Item.children`), not card text: `splitItemChildren`/`listItemToItem`
  in `parsers/formats/list.ts`. Child lists must trail the card's own content;
  otherwise the card keeps everything as text (native behavior). Non-task nested
  bullets stay text. Metadata (tags, dates, links, block IDs) is read from the card's
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
  from on-screen rects every animation frame while shown and removed on drop/cancel. `SortManager` outlines the card above the gap (`is-nest-parent`); on drop
  `nestIntoPrevious` (`src/helpers/nestCards.ts`) makes the moved card that card's
  last child. Hovering inside a card's child list sorts among the children. Sorting
  geometry itself is unchanged. A card cannot be dropped into its own subtree (hit
  test filter and `handleDrop` guard). Hitboxes of nested cards register at any
  depth (`EntityManager.registerDescendants`). Cross-board drops ignore nesting.
  Children of a card in edit mode cannot be dragged.
- **Note tasks** (`ItemSubtasks.tsx`): when the note linked in a card's first line
  (not Kanban's last-link `metadata.file`) has non-empty task list items, up to ten
  are previewed under the card with a collapsible `done/total` badge; ticking one
  rewrites only that line through `vault.process`; refreshes on `metadataCache` changes.

Tests: `test/nested-cards.test.mjs` (six: parse depth, metadata isolation, round-trip,
plain bullets, nest and cross-depth moves; Obsidian/Dataview/DOM stubbed) and
`test/subtasks.test.mjs` (three: note tasks). Rendering, drag gestures and Obsidian
events are not covered.
