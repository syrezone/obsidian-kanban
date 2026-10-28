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
node --test test/canvas-geometry.test.mjs test/flush-board.test.mjs test/owned-mount.test.mjs test/file-tags.test.mjs
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
