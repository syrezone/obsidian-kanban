# Personal Changes

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
