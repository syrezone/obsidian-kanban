# Personal Canvas Geometry Build

Local branch `fix/personal-canvas-geometry` starts at release tag `2.0.51`
(`8501981`). Runtime marker: `plugin.personalBuild === 'canvas-geometry-4'`.
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
  state; child refs may initialize first. Hidden lane scroll containers retain
  their last visible scale. Auto-scroll
  edge thickness remains 35 screen pixels, with the original local speed policy.
- Support positive uniform scale and translation. Reject rotation/skew and
  nonuniform/zero source scale. Ancestor transform/zoom changes, document scroll
  changes, source detachment or pointer cancellation cancel a drag without a
  drop. Cancellation restores sort/preview/scroll state. Host resizing during
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
node --test test/canvas-geometry.test.mjs test/flush-board.test.mjs test/owned-mount.test.mjs
corepack yarn@1.22.22 typecheck
corepack yarn@1.22.22 build
```

Eighteen tests cover 0.5/1/2 scale, fractional border boxes, asymmetric margins,
destination scale, pan/pointer anchoring, nested scroll shifts, real manager
refresh/sorting/cancellation, child-before-parent initialization and the animation gate. Host boundaries are stubbed;
these tests do not prove real DnD, auto-scroll, saving or restore. Type checking,
production build and ESLint on changed TypeScript files pass. Repository-wide
lint fails on existing checkout CRLF and unrelated violations; no broad cleanup
was applied.

Use only `plugin-dev` and Ignis/Chromium `kanban-spike`. Keep release rollback
artifacts under each vault's `.obsidian/plugin-build-backups/obsidian-kanban/2.0.51/`.
Deploy only runtime artifacts, preserve `data.json`, then reload Kanban and the
diagnostic companion. The companion records the runtime build marker. Use
**Mount diagnostic Kanban view**, not the counter-scaled host; host-side cache
refresh must be off. Repeat standalone/50/100/200%/pan tests, then scrolling,
auto-scroll, cancellation, task order and Markdown persistence.

## Save Boundary (build 3)

`KanbanView.flush()` commits mounted editors in every view sharing its file,
serializes through the existing StateManager, then awaits the primary native
`TextFileView.save()`. Parse/commit/write failures reject. Renames commit directly
rather than waiting for a Preact effect; new task/list drafts submit only when
nonempty. Editor registrations follow component lifetime; cleanup releases
active editor ownership on desktop as well as mobile.

Five save-boundary tests verify shared-editor ordering, primary-only writing,
awaited completion and error propagation (plus 18 geometry and nine owned-mount tests; 32 total). These stub
the native save boundary; Obsidian/Ignis save behavior and the actual editor
callbacks have passed user-guided timed Reset checks on desktop and Ignis: active task/column renames, new-task draft submission and no blank task from an empty form. Concurrent edits during flush, external writes,
plugin unload and automatic teardown are not guaranteed by this operation.

The companion's explicit Reset now awaits flush and keeps the host on failure;
its former 100 ms wait is removed. Use **Arm save and reset in 10 seconds** to
leave an existing-task rename active until Reset, then reopen the Markdown.
Repeat for a new task draft and a column rename on both hosts. Empty new-task
forms must not create blank tasks. Dependency/plugin disable and detached-host
recovery still use the old synchronous cleanup and do not establish save safety.

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

Use **Mount owned Kanban experiment** in the companion after checking a normal
Kanban tab. Check editing/DnD/resize, explicit Reset and timed Reset persistence;
then two mounts plus a normal tab, external edits and file rename/delete.
Maguilanote 1.2.0 implements persisted canvas cards and reconciliation using this
API. Global Kanban commands in the canvas, popouts/mobile and guaranteed async
plugin-shutdown saving remain outside current support.
Synchronous shutdown force-cleans components without an awaited flush. Automatic
diagnostic orphan cleanup is best effort; do not promote it into production.

Workspace docs own deployment hashes, raw measurements and current runtime
results. The contracts above describe the implemented personal API; they do not
guarantee failed-write recovery or source deletion during active editing.
