# Personal Changes

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
