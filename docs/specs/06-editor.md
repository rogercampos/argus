# Spec 06 — Editor

CodeMirror 6 hosts the text editing. This spec covers editor behavior and the
editor tab system.

## Documents & buffers

- One document (buffer) per file, shared by every view of it (editor tabs,
  search previews). Edits anywhere update everywhere.
- Line endings preserved as found; new files use LF. Encoding: UTF-8 only in
  phase 1 (binary/undecodable files refuse to open with a notice).
- Large file guard: files > 5MB open read-only with syntax highlighting off;
  files > 50MB refuse to open.

## Auto-save & external changes

- **Auto-save**: a document saves automatically **700ms** after the last
  edit (timer resets per edit). Saving clears the dirty indicator. Manual
  Cmd+S saves immediately.
- No format-on-save in phase 1.
- **External changes always win**: when the file watcher reports a change to
  an open file, reload its content from disk immediately — even if the
  buffer is dirty. Preserve the cursor offset (clamped to the new length)
  and scroll position; clear selection. No prompt, no conflict dialog.
  (Combined with 700ms autosave, real conflicts are rare and the user has
  accepted this trade.)
- File deleted on disk: keep the buffer open, mark the tab "(deleted)";
  saving recreates the file.

## Single cursor, no modal editing

- Exactly one cursor/selection at all times. No multi-cursor gestures
  (no Alt+Click adds, no "add cursor above/below" commands).
- No vim/modal editing.

## Selection behaviors

- Double-click selects the word; double-click+drag extends word-wise.
  Triple-click selects the line.
- **Syntax-aware expand/shrink** — `Alt+Up` expands the selection to the
  next enclosing syntactic node; `Alt+Down` shrinks back one step (an
  expansion stack is kept until the selection is otherwise changed). Backed
  by LSP `textDocument/selectionRange` when available; fall back to
  CodeMirror's syntax tree (Lezer) otherwise.
- `highlightSelectionMatches`: occurrences of the selected text are
  highlighted across the editor.

## Line operations

| Command | Key | Behavior |
| --- | --- | --- |
| Duplicate line/selection | Cmd+D | duplicates current line below (or duplicates the selection after itself); cursor moves to the copy |
| Move line up/down | Alt+Shift+Up/Down | moves the line (or all lines covered by the selection); selection follows |
| Delete line | Cmd+Backspace | deletes the whole line |
| Comment line | Cmd+/ | toggle line comment (language-aware), works on selections |
| New line below/above | Cmd+Enter / Cmd+Shift+Enter | insert line and move cursor, regardless of column |
| Indent / outdent | Tab / Shift+Tab on selection, Cmd+] / Cmd+[ | standard |

## Display

- Line numbers; active line highlight; matching bracket highlight.
- **Sticky header**: the enclosing function/class signature pins to the top
  while scrolling (CM6 panel above the editor driven by the syntax tree /
  LSP document symbols). On in phase 1.
- Diagnostics render as squiggly underlines (severity-colored) plus
  **error lens**: the message inline at end-of-line, dimmed, severity
  colored. Hovering a squiggle shows the diagnostic(s) + LSP hover info in
  one tooltip (spec 08).
- Inlay hints (LSP) on by default; toggle via View menu.
- Word wrap off by default. Font: JetBrains Mono 13px, line-height 1.5
  (spec 13).

## Editor tabs

- A horizontal tab bar above the editor. Tab shows: file type icon,
  filename, and a dirty dot (replacing nothing else — there is **no close ×
  on tabs**).
- **Closing tabs**: middle-click a tab; `Cmd+W` closes the active tab;
  context menu: Close, Close Other Tabs, Close All Tabs. (Auto-save means
  no unsaved-changes prompts.)
- **Insertion order**: a newly opened file's tab is inserted immediately
  **after the active tab**, and becomes active.
- **Navigate-to-open-file rule**: navigating to a file whose tab is already
  open focuses that tab AND moves it to sit immediately next to (after) the
  previously active tab — keeping related files adjacent.
- **Duplicate prevention**: a file has at most one tab per pane.
- **Tab cap / eviction**: at most **50** file tabs; opening beyond the cap
  silently closes the least-recently-used tab (cursor/scroll persisted
  first).
- Overflow: tab bar scrolls horizontally (trackpad/wheel); no dropdown in
  phase 1.
- `Cmd+Shift+]` / `Cmd+Shift+[`: next/previous tab (wraps).
- **External files** (outside the workspace, or anywhere under
  `node_modules/`): tab title and file tree entries render in a distinct
  color (spec 13) to signal "you're not in your code".
- Tab state (open tabs, order, active tab, per-file cursor+scroll) persists
  per workspace (spec 15).

## Splits (minimal in phase 1)

- Commands exist (menu only): Split Right, Split Down, Close Split. Each
  split pane has its own tab set. No default keybindings in phase 1; the
  single-pane flow is primary. Layout persisted.

## Files opened from outside

- Files opened via the definition picker / absolute-path go-to-file that
  live outside the workspace open as external tabs (read/write allowed,
  colored as external). They are never added to the workspace tree.

## Acceptance checklist

- [ ] Autosave at 700ms; dirty dot appears and clears.
- [ ] External edit reloads even when dirty; cursor/scroll kept.
- [ ] Alt+Up/Down expand/shrink selection through nested scopes.
- [ ] Cmd+D / Alt+Shift+arrows / Cmd+Backspace / Cmd+/ behave as specced.
- [ ] New tab inserts after active; re-navigation pulls tab adjacent;
      50-tab LRU eviction.
- [ ] Middle-click and Cmd+W close tabs; no × buttons anywhere.
- [ ] node_modules file opens with external coloring.
