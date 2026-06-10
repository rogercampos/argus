# Spec 05 — Navigation (Recent Files, History, Go to Line/Symbol/Definition, Modal Pattern)

## The modal pattern (shared by all floating popups)

All quick-navigation features use one shared modal component:

- Rendered centered (slightly above center vertically), floating over a
  full-window transparent overlay.
- **Dismissal**: Esc closes; clicking the overlay (outside the modal)
  closes; completing an action closes; the modal also closes if app focus
  moves elsewhere programmatically.
- **Exclusive**: at most one modal open at a time; opening one closes any
  other.
- **Resizable**: drag any edge/corner (10px hit zone). Each modal type
  remembers its size for the session.
- **Focus**: an app-level focus owner determines keyboard routing (input vs
  list vs preview). When a modal closes, focus returns to where it was.
- Styling per design system (spec 13): panel background, 1px border, 6px
  radius, shadow.
- List behavior shared by all modals: virtualized; selected row highlighted;
  Up/Down wrap; hover highlights; Enter activates; rows use
  `file_icon + name + dimmed hint` layout.

## Recent files popup (Cmd+E)

- Modal, default size **500×450** (min 300×200).
- Lists recently opened files, most recent first. Max **100** entries kept.
- **What counts as "recent" (user intent)**: a file enters/moves to the top
  of the list only when the user deliberately navigates to it — opening via
  file tree click, go-to-file, search result, recent-files itself, or an LSP
  jump. NOT counted: files opened incidentally (restored tabs at startup,
  files reloaded by watchers, preview renders in search).
- Dedup: re-opening moves the entry to the top.
- Input filters the list with fuzzy matching on the **filename only**;
  empty input shows the full recency-ordered list. Input starts empty each
  open.
- Rows: file icon + filename; when two visible entries share a basename,
  append a dimmed workspace-relative directory hint (only for duplicates).
- Enter/click opens the file (cursor restored to its last position);
  Esc closes.
- Persisted per workspace.

## Visited-file history & Back/Forward (Cmd+Alt+Left / Cmd+Alt+Right)

- A navigation history records **jump events**: opening a file (any method),
  go-to-definition, go-to-line, search-result opens. Not recorded: plain
  cursor movement, scrolling, undo/redo.
- Each entry: file path, cursor offset, scroll position.
- Back: saves the current location (if at history head) and moves back.
  Forward: moves forward; no-op at the end. Consecutive duplicate locations
  are not double-recorded.
- History is per window, unbounded within reason (cap 200 entries, drop
  oldest).
- Jumping to a file whose tab was closed re-opens it (position restored).
- UI affordance: none beyond shortcuts + Navigate menu (no toolbar arrows —
  they were deliberately removed in sourcedelve).

## Go to Line (Cmd+L)

- Tiny modal, **300×120** (min 200×80): one input ("Line[:column]") + a
  primary "Go" button.
- Accepts `N` or `N:C` (1-indexed). Enter (or button): if the input parses
  and the active editor exists, jump — place the cursor at column C or the
  first non-blank character of line N, scroll it into view (centered), and
  record jump history. Out-of-range lines clamp to the last line.
- Invalid input or no active editor: the modal just closes (no error UI).
- Also opened by clicking the `line:col` segment of the status bar.

## Go to Symbol (Cmd+O)

- Modal, **800×600** (min 400×300).
- Source: **LSP workspace symbols** (`workspace/symbol`), queried with the
  input text, **debounced 150ms**, stale responses dropped (revision
  counter).
- Filter the response to type-like and definition-like kinds: class, module,
  struct, enum, interface, namespace, method/function, constant. Exclude
  results from Ruby `.rbi`/`.rbs` stub files.
- Rows: kind icon + symbol name (matched chars highlighted) + dimmed
  container name + right-aligned dimmed file path.
- Enter/click: jump to the symbol's location (history recorded). Esc closes.
- With multiple LSP servers (monorepo), fan out and merge results
  (spec 08).

## Go to Definition (Cmd+B, also Cmd+Click)

- Sends `textDocument/definition` for the symbol under the cursor.
- **One result**: jump directly. Scroll only if the target is off-screen;
  when scrolling, center the target line (do NOT recenter if already
  visible).
- **Multiple results**: show a **definition picker** — a small popup
  anchored near the cursor (not the shared centered modal), listing each
  definition: file path + line, with Ruby gem/stdlib paths shortened to
  `(ruby 3.2.2 / activerecord) lib/active_record/base.rb` form when the path
  is inside a gem or ruby install (recognize rbenv/mise/asdf/rvm/Homebrew
  layouts).
- Up/Down + Enter to choose; Esc cancels; click chooses. Jump recorded in
  history.
- Cmd+Click on an identifier = same as Cmd+B at that position.
- `Go to Type Definition` (menu only): same UX, `typeDefinition` request.

## Acceptance checklist

- [ ] One modal at a time; Esc/outside-click/focus-loss close; resize works
      and is remembered.
- [ ] Cmd+E: intent-based recency, duplicate-basename hints, fuzzy filter.
- [ ] Back/Forward across files including closed ones; no duplicate entries.
- [ ] Cmd+L parses `N` and `N:C`, clamps, centers.
- [ ] Cmd+O: 150ms debounce, kind filtering, stub exclusion, merged
      multi-server results.
- [ ] Cmd+B: direct jump on single; picker on multiple; no recenter when
      visible; gem paths shortened.
