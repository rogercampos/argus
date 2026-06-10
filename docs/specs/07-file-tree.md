# Spec 07 — File Tree

Left panel. Implemented with `@pierre/trees` (virtualized, path-first).

## Content & ordering

- Shows all workspace files/folders from the canonical listing
  (`git ls-files --cached --others --exclude-standard` + fallback walk).
  Gitignored files are NOT listed (matching `git ls-files` semantics) except
  via the "excluded paths" dimming below, which applies to listed files.
- Folders before files; within each, case-insensitive **natural sort**
  (`file2` < `file10`).
- Header row above the tree: the workspace folder name (uppercase, small,
  bold) + a **locate** button.
- Single-child folder chains are flattened (`a/b/c` as one row) —
  @pierre/trees `flattenEmptyDirectories`.
- Root-level content visible without an extra root node.

## Interaction

- **Single click** on a file opens it (no preview-tab concept — a real tab,
  per spec 06). Single click on a folder toggles expand/collapse.
- Keyboard (when tree focused): Up/Down move; Right expands folder / steps
  into; Left collapses / steps to parent; Enter opens file or toggles
  folder. (These come with @pierre/trees.)
- `Cmd+1` toggles + focuses the tree.
- Scrolling is virtualized; expanding huge folders must not jank.

## Locate current file

- The locate button (header, crosshair icon) reveals the active editor's
  file: expand all ancestor folders, scroll the row into view (centered),
  select it. No-op for external files (outside the workspace) — flash the
  header subtly instead.
- Also exposed as `View > Reveal Active File in File Tree`.

## Starred top-level folders

- Only **first-level** folders (direct children of the workspace root) can
  be starred.
- Hover over a first-level folder row reveals a star outline icon on the
  right; clicking toggles. Starred folders show a filled yellow star
  (`#EAB308`) always.
- Starred folders sort **above** all other root entries (stable order
  otherwise preserved).
- Persisted per workspace.

## Excluded paths

One mechanism in Argus (sourcedelve had two; we consolidate):

- Setting `excludedPaths: string[]` (workspace-relative prefixes), default:
  `["vendor", "node_modules", "tmp", ".bundle", "log", "dist", "build",
  ".next", ".pnpm-store"]`.
- Effects:
  - File tree: excluded entries are still listed but rendered dimmed/red
    (excluded styling, spec 13); their contents load only on demand.
  - Global search (spec 03) and Go to File (spec 04): excluded paths are
    **filtered out** entirely.
- Context menu on any file/folder: "Exclude from Project" / "Remove from
  Excluded Paths" — edits the workspace settings entry immediately.

## Git status decoration

Filename color by git status (colors in spec 13 / 09):

| Status | Treatment |
| --- | --- |
| modified / renamed | blue |
| added (staged new) | green |
| untracked | grey-green (RubyMine-style; distinct from clean) |
| deleted | red (row remains until listing refresh) |
| conflicted | red |
| ignored | orange-dim |

Folders show a small dot indicator when any descendant has changes
(@pierre/trees provides this with `gitStatus`).

## Context menu (right-click)

On a file: Open, ───, New File…, New Folder…, ───, Rename…, Duplicate,
Move to Trash, ───, Copy Path (absolute), Copy Relative Path
(`Cmd+Shift+C` copies the relative path of the active file globally), ───,
Exclude from Project, ───, Reveal in Finder, Refresh.

On a folder: same minus Open, plus "Find in Folder…" (opens the search
modal scoped to it, spec 03). On a first-level folder: plus Star/Unstar.

### Inline create/rename/duplicate

- New File/Folder: inline text input appears at the right position in the
  tree; Enter confirms (creating intermediate folders if the name contains
  `/`), Esc cancels, focus-loss confirms if non-empty. Errors (name exists,
  invalid) show inline below the input; input stays open.
- Rename: inline input prefilled with the name, **stem selected** (extension
  unselected). Same confirm/cancel rules. Open tabs for renamed files follow
  the rename.
- Move to Trash uses the OS trash (recoverable). No confirmation dialog for
  files; folders ask for confirmation with item count.

## Watching & refresh

- A file watcher (@parcel/watcher) keeps the tree live: created/deleted/
  renamed files appear/disappear without user action (debounced ~300ms).
  `.git` internals are ignored except as triggers for git-status refresh
  (spec 09).
- Manual Refresh from the context menu forces a full re-list.

## Acceptance checklist

- [ ] factorial tree: instant expand/scroll, flattening works, natural sort.
- [ ] Locate expands + centers + selects the active file.
- [ ] Stars: hover affordance, top placement, persistence.
- [ ] Excluded paths dim in tree and disappear from search/go-to-file;
      context-menu toggle edits settings.
- [ ] Git colors per status; folder dot for dirty descendants.
- [ ] Inline new/rename/duplicate with stem selection + inline errors.
- [ ] External changes show up in the tree without user action.
