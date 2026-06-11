# Spec 03 — ⭐ Global Search (Find in Files)

The most important feature, together with Go to File. Two surfaces share one
engine: a quick **search modal** and a **bottom panel** with persisted tabs.

## Backend engine

- Implemented in the main process by spawning **ripgrep** (`@vscode/ripgrep`).
- Inputs: pattern, flags (case sensitive, whole word, regex), optional scope
  folder (workspace-relative), max results.
- Respects `.gitignore` (all levels) and the workspace `excludedPaths`
  setting (spec 07). Hidden files ARE searched (dotfiles not excluded), but
  `.git/` is.
- Literal mode by default (pattern escaped); regex mode passes the pattern
  through. Whole word wraps with `\b`. Case-insensitive by default.
- **Streaming**: results are flushed to the renderer in batches every
  **150ms** while ripgrep runs. Each match carries: file path, 1-indexed line
  number, line text, match start/end offsets within the line.
- Long lines: if line text exceeds **200 chars**, truncate for display to
  ±100 chars around the first match (adjust highlight offsets accordingly).
- Result caps: **100** matches for the modal, **1000** for a panel tab.
  When the cap is hit, kill ripgrep and report "capped".
- A new search cancels the previous in-flight search (kill the process).
- Every keystroke triggers a new search — no debounce, cancellation handles
  the churn. Empty pattern = no search, clear results.

## Search modal (Cmd+Shift+F)

A floating modal (see modal pattern in spec 05) for quick search-and-jump.

### Layout

- Width ≈ 80% of window width (resizable; min 700×400; size remembered per
  workspace, session-scoped).
- Rows top→bottom:
  1. **Search input** (single-line) with three toggle buttons right-aligned
     INSIDE the input row: `Aa` (case), `W` (word), `.*` (regex). Toggles
     highlight when active. Toggle state is global to the search feature and
     shared between modal and panel; persisted per workspace.
  2. **Scope row**: "Folder: All files" or "Folder: app/models" — clickable;
     opens a folder picker (filterable list of workspace directories, same
     modal style). Picking sets the scope and re-runs the search.
  3. **Body, 50/50 split**: left = flat results list (virtualized, row
     height 26px); right = **preview editor**.
  4. **Footer**: left = status ("Found N results", "Found N results so
     far…", or "Showing first 100 — refine your search"); right = a button
     "Open in Search Panel ⌘⏎".

### Prefill

On open: if the active editor has a selection, prefill with the selection
and select-all the input text (typing replaces). Otherwise prefill with the
last pattern used (session memory), selected. Search fires immediately on
open if the input is non-empty.

### Scope default

- If the modal is invoked while the file tree has focus and a folder is
  selected, scope = that folder.
- Otherwise scope = All files. (Never silently inherit a previous scope —
  this was a sourcedelve bug, fixed: scope resets to All files each open
  unless invoked from the tree.)

### Results list

Each row: highlighted line text (match in highlight color) left, then
right-aligned dimmed `filename:line`. Selected row uses the selection
background. First incoming match is auto-selected and auto-previewed.

### Preview

- Real editor component, read-only NOT — it is **editable** (see panel
  preview semantics below; same component).
- Shows the selected match's file, scrolled so the match line is visible
  (centered), with the match highlighted.
- Clicking inside the preview focuses it for editing; `Esc` returns focus to
  the input/results.

### Keyboard

| Key | Action |
| --- | --- |
| typing | edits the search input (when preview not focused) |
| Up / Down | move selection in results; updates preview; wraps at ends |
| Enter | open selected match in a real editor tab at that line; close modal |
| Cmd+Enter | send this search to the bottom panel as a new tab; close modal |
| Esc | if preview focused → unfocus preview; else close modal |

### Mouse

- Single click on a result row: select + preview.
- Double click: open in editor tab, close modal.
- Click in preview: focus preview (edit mode).

### Close behavior

Closes on Esc, Enter-open, Cmd+Enter, or focus loss (clicking outside).
On close, remember the pattern for the next prefill.

## Bottom search panel

Opens (and becomes visible) when a search is sent from the modal via
Cmd+Enter. Hosts one **tab per search**.

### Tab bar

- Horizontal, scrollable, styled like editor tabs.
- Per tab: search icon (or spinner while running), the pattern text
  (truncated to **30 chars** with ellipsis), match count `(N)`, and a close
  `×` shown when the tab is active or hovered.
- Right side of the bar: "close all tabs" button.
- A new search always creates a new tab (no dedup), appended at the end,
  activated immediately.

### Tab content — 50/50 split, divider draggable

**Left: hierarchical results tree** (virtualized):

- Grouped folder → file → matches. Rows:
  - Folder row: chevron, folder icon, name, `(N)` total descendant matches.
  - File row: chevron, file type icon, filename, `(M)` match count.
  - Match row: `line: line text` with the match highlighted.
- Everything expanded by default when results (re)load. Collapse state is
  per-tab, session-only (not persisted).
- Above the tree: a toolbar row with: re-run button (reloads the search),
  the scope row ("Folder: …", clickable like the modal), and the three
  option toggles.

**Right: preview editor** — same component as the modal preview:

- Shows the selected match, centered, highlighted.
- **Editable in place**: click into the preview and type — this edits the
  real document (same buffer as a normal editor; autosave applies, spec 06).
  This is a flagship behavior: fix small things directly from search
  results.
- While the results list has focus, Up/Down move across visible match rows
  (skipping group rows), updating the preview live.

### Keyboard (panel focused)

| Key | Action |
| --- | --- |
| Up / Down | previous/next visible row (folders, files, matches); wraps |
| Enter on folder/file row | toggle expand/collapse |
| Enter on match row | open in editor tab at that line (panel stays open) |
| Esc | if preview focused → back to results; else focus editor |

Single click on a match selects + previews it. Single click on a file row
toggles the group AND selects/previews the file's first match (so picking a
file always shows its preview). Double click on a match opens it in an
editor tab.

### Re-evaluation

- Activating a tab re-runs its search ("re-evaluate") so results are always
  fresh. Exception: the active tab right after its initial run.
- On workspace restore, tabs are recreated **lazily**: only the previously
  active tab runs its search; others run when first activated.

### Persistence (per workspace)

Per tab: pattern, case/word/regex flags, scope folder. Plus the active tab
index, and panel visibility/height. Results are never persisted.

## Global replace (Cmd+Shift+R)

Same modal as search with an added **replace input** below the search input.

- Results show as in search. Selecting a match previews it.
- **Replace selected** (Enter on a match with replace input non-empty, or a
  "Replace" button): replaces that single match — re-locating the match in
  the current file content first (file may have changed); writes through the
  document buffer if the file is open (dirty + autosave), else directly to
  disk. The match disappears from the list; selection advances to the next.
- **Replace All** button: replaces every remaining match. Runs in the
  backend as a background task (spec 10) reporting progress "X/Y files
  (Z replaced)". Open buffers are updated in memory; closed files written on
  disk. No confirmation dialog. Per-file undo works in open editors.
- Regex replace supports `$1`-style capture group references.

## In-editor find/replace (Cmd+F / Cmd+R)

Scoped to one editor, independent state **per editor view**.

- Cmd+F opens a find bar docked at the top-right of the editor, with input +
  the three option toggles + match counter `k/N` + prev/next buttons +
  close.
- Prefill: current selection if any; else this editor's previous find text.
- All matches highlighted; current match distinct; Enter/Shift+Enter =
  next/previous (wraps); Esc closes and clears highlights.
- Cmd+R opens the same bar with a replace row: replace input + "Replace" +
  "Replace All" buttons. Tab moves between find and replace inputs.
- Highlights update live as the document changes.

## Acceptance checklist

- [ ] Typing in the modal streams results live; first match auto-previews.
- [ ] Enter opens match; Cmd+Enter creates a panel tab.
- [ ] Scope defaults correct (tree-focus → folder; else All files).
- [ ] Panel tabs: create/activate/close/close-all; re-run on activate;
      lazy restore.
- [ ] Preview is editable and writes through the real document.
- [ ] Caps: 100 modal / 1000 panel, with "capped" status text.
- [ ] Replace: single-match replace advances; Replace All reports progress.
- [ ] Searching factorial (~98k files) for a common string stays responsive
      (first results < 150ms after keystroke on warm FS cache).
