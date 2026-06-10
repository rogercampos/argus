# Argus — Phase 1 Goals

This file tracks the goals for phase 1 and our progress against them. Check
items off as they land.

**Every section links to a detailed functional spec in [specs/](specs/) —
read the spec before implementing.** Scope decisions locked for phase 1:
**macOS only**, **dark theme only** (see [specs/README.md](specs/README.md)).

Sources for these goals:

- Roger's direct requirements (RubyMine as the reference for design, UX, and
  behavior).
- The abandoned predecessor project at `~/code/lapce` ("sourcedelve", a fork of
  the Lapce editor in Rust): 154 commits that first stripped VS Code-style
  features and then implemented the desired ones. Everything that was *added*
  there is a goal here; everything *removed* there is an explicit non-goal.

## North star

A fast, focused code editor whose look & feel, shortcuts, and feature behavior
match RubyMine. Performance target: instant browsing and searching on ~100k-file
repositories (e.g. `~/code/factorial`).

## Layout

→ Spec: [specs/02-shell-and-layout.md](specs/02-shell-and-layout.md)

- [x] Three-panel layout: file tree left, main editor right (dominant), and a
      full-width bottom panel for searches and their results.
- [ ] Resizable splits; global search results panel uses a 50/50 horizontal
      split (results list left, live preview editor right).
- [x] No draggable/rearrangeable panels — fixed, predictable layout.
- [ ] Status bar showing the current background task.

## ⭐ Flagship feature 1: search a string in the whole codebase

→ Spec: [specs/03-global-search.md](specs/03-global-search.md)

RubyMine-style "Find in Files", behaving as implemented in sourcedelve:

- [ ] Floating search modal (Cmd+Shift+F): text input, flat results list, and
      side-by-side live preview of the selected match. Single click/arrow keys
      select & preview, double click or Enter opens in editor, Cmd+Enter sends
      the search to the full bottom panel.
- [ ] Super fast: streaming results from ripgrep as you type.
- [ ] Bottom panel with hierarchical results grouped by file, expand/collapse
      per file, keyboard navigation (up/down walks visible matches), preview
      editor on the right.
- [ ] **Editable previews**: the preview editor is a real editor — click into
      it to edit in place, click back to the input/results to keep navigating.
- [ ] **Persisted search tabs**: each search lives in its own tab in the bottom
      panel (tab header bar like editor tabs); switching back to a tab
      re-evaluates the search. Close tab / close all tabs commands. Persisted
      per workspace across restarts.
- [ ] Global replace (with per-match and per-file granularity).
- [ ] Filter search by folder (scoped searches); sensible defaults for the
      search folder, not sticky when you didn't ask for it.
- [ ] Smart default search text: prefilled from the current selection
      (RubyMine behavior); local find pre-filled from previous/selected text.
- [ ] Search options: case sensitivity, whole word, regex.

## ⭐ Flagship feature 2: go to file

→ Spec: [specs/04-go-to-file.md](specs/04-go-to-file.md)

RubyMine-style "Go to File" (Cmd+Shift+O):

- [x] Floating modal, fuzzy matching over all repo paths, instant on ~100k
      files (index kept in memory, filtering off the UI thread). *(Measured:
      60ms keystroke→rendered results on factorial's 98k files.)*
- [x] Reuses the previous query when reopened (RubyMine behavior).
- [x] Accepts absolute paths (jump straight to any file on disk).
- [ ] Large, comfortable modal size; colored file type icons in results.
      *(Size done; file icons pending an icon system.)*

## Navigation

→ Spec: [specs/05-navigation.md](specs/05-navigation.md)

- [x] Recent files popup (Cmd+E): floating modal with fuzzy filename search,
      keyboard navigation, file icons. Recency updated only on real user
      intent (not incidental opens). *(File icons pending icon system.)*
- [x] History of visited files; jump back / jump forward (Cmd+Alt+Left/Right).
- [x] Go to line (Cmd+L) as its own modal.
- [ ] Go to symbol as its own modal.
- [ ] Go to definition (Cmd+B); when there are multiple definitions, show them
      in a results panel. Don't re-center the viewport unnecessarily.
- [x] No command palette: features have their own shortcuts/modals, and all
      commands are reachable through the native macOS menu bar (File, View,
      Code, Window, Settings, Help).

## Editor behavior

→ Spec: [specs/06-editor.md](specs/06-editor.md)

- [x] Auto-save by default (~700ms debounce after edits).
- [x] Always reload on external file changes (external changes win over
      unsaved buffer content).
- [x] Single cursor only — no multi-cursor. No modal (vim) editing.
- [ ] Independent find & replace state per editor view.
- [x] Word-wise selection; syntax-aware expand/shrink selection (Alt+Up/Down).
- [x] Duplicate line (Cmd+D), move line up/down (Alt+Shift+Up/Down).
- [ ] Diagnostics shown on hover directly in the editor; inline (ghost text)
      completion off by default.
- [x] Editor tabs: no close-X clutter; opening an already-open file moves its
      tab next to the current one; files outside the workspace (and inside
      node_modules) rendered as "external" in a different color.

## File tree

→ Spec: [specs/07-file-tree.md](specs/07-file-tree.md)

- [ ] Virtualized, instant on huge repos (already in place via @pierre/trees).
- [ ] "Locate current file" button (reveal active editor file in the tree).
- [ ] Colored file type icons (devicon-style) used consistently across tree,
      modals, and results.
- [ ] Git status coloring: modified files in blue, gitignored files dimmed,
      untracked/added states visible.
- [ ] Starred (pinned) top-level folders shown at the top of the tree.
- [ ] User-configurable excluded paths (hidden from tree and searches).
- [ ] Copy path to clipboard shortcut.

## LSP integration

→ Spec: [specs/08-lsp.md](specs/08-lsp.md)

Main languages: Ruby, TypeScript/JavaScript, plus shell.

- [ ] LSP client infrastructure with pull diagnostics support, forwarding the
      project environment to the server process.
- [ ] Ruby: ruby-lsp auto-installed and auto-updated; setting to skip gems
      indexing (on by default); Sorbet support; don't spawn a second ruby-lsp
      for a subfolder when a parent already runs one.
- [ ] TypeScript/JS: vtsls, with memory sized dynamically by project size.
- [ ] Bash LSP.
- [ ] Servers start per detected project, not per workspace (see "Workspace &
      Project model").
- [ ] Resolve project envs lazily (don't block startup).

## Git integration

→ Spec: [specs/09-git.md](specs/09-git.md)

- [ ] Current branch in the title bar; repo-wide state surfaced (e.g.
      rebasing).
- [ ] File status coloring in tree and tabs (see File tree above).
- [ ] Status updates optimized and deferred — never block the UI on git.

## Workspace & Project model

→ Spec: [specs/01-workspace-and-project-model.md](specs/01-workspace-and-project-model.md)
(persistence details: [specs/15-persistence.md](specs/15-persistence.md))

Two core concepts that everything else hangs from:

**Workspace** — the folder the user opens. The only way to open anything:
there is no "open one file"; it's always a folder.

- [x] One workspace per OS window, always. Multiple workspaces can be open at
      the same time, each in its own window.
- [x] "Open Recent" in the main application menu to reopen recently closed
      workspaces.
- [x] Closing every workspace window leaves a minimal welcome window listing
      recently opened workspaces with an easy way to open them (plus an
      "Open Folder" button). Closing that window quits the application.
- [ ] Per-workspace persistence: open tabs, panel sizes, search tabs, starred
      folders, recent files. *(Done: tabs, panel sizes, recent files.
      Pending: search tabs, starred folders.)*

**Project** — a sub-unit inside a workspace, for monorepo support. A workspace
like factorial contains many projects (some Ruby, some JavaScript, some Rust,
…).

- [ ] Detect the projects inside a workspace (by language/tooling markers:
      Gemfile, package.json, Cargo.toml, …).
- [ ] Use detected projects to decide which LSP servers to start, per project.
- [ ] Show the workspace's projects in the UI.

## Windows & app lifecycle

→ Spec: [specs/01-workspace-and-project-model.md](specs/01-workspace-and-project-model.md)
and [specs/02-shell-and-layout.md](specs/02-shell-and-layout.md)

- [x] Native macOS menu bar with all commands (no command palette).
      "Open Folder" always opens a new window. Cmd+Q quits.
- [x] Window appears immediately on start; initializations deferred.

## Ruby on Rails niceties

→ Spec: [specs/11-rails.md](specs/11-rails.md)

- [ ] Detect Rails projects.
- [ ] Show the DB schema of the ActiveRecord model in the side panel when
      viewing a model file.
- [ ] Rake file support (treated as Ruby).

## Code quality reports

→ Spec: [specs/12-quality-reports.md](specs/12-quality-reports.md)

- [ ] ESLint reports integration.
- [ ] Semgrep integration.
- [ ] Problems view listing all diagnostics, grouped by file.

## Background tasks & responsiveness

→ Spec: [specs/10-background-tasks.md](specs/10-background-tasks.md)

- [ ] Central UI for pending background tasks; current task in the status bar.
- [ ] Report of slow operations (instrumentation to catch UI-blocking work).

## Design & keybindings

→ Specs: [specs/13-design-system.md](specs/13-design-system.md)
and [specs/14-keybindings.md](specs/14-keybindings.md)

- [x] RubyMine-inspired dark design. Inter + JetBrains Mono bundled.
      Gradient background shell, tuned editor tab styles, `~` for home dir
      everywhere, resizable modals. *(Editor tab styles + modals land with
      their features.)*
- [ ] RubyMine keymap (macOS only). Core bindings (full table in spec 14):

  | Shortcut | Action |
  | --- | --- |
  | Cmd+Shift+O | Go to file |
  | Cmd+Shift+F | Global search modal |
  | Cmd+E | Recent files popup |
  | Cmd+B | Go to definition |
  | Cmd+L | Go to line |
  | Cmd+O | Go to symbol |
  | Cmd+D | Duplicate line |
  | Cmd+Alt+Left/Right | Jump back / forward |
  | Alt+Up/Down | Expand / shrink selection (syntax-aware) |
  | Alt+Shift+Up/Down | Move line up / down |
  | Alt+Enter | Quick fixes / intentions |
  | Cmd+1 | Focus file tree |
  | Cmd+Backspace | Delete line |
  | Cmd+Shift+] / [ | Next / previous editor tab |
  | Cmd+Alt+S | Save all |

## Implementation roadmap

The order to build phase 1, sequenced by dependencies and risk (spec numbers
in parentheses):

1. **Foundations** — design tokens + gradient shell + three-panel layout +
   status bar + menus skeleton (13, 02); workspace/window model: one
   workspace per window, welcome window, recent workspaces (01); persistence
   skeleton (15).
2. **Editor core** (06) — document/buffer architecture (one buffer per file,
   shared by all views — required later by search's editable previews),
   editor tabs with insertion/reordering/eviction rules, autosave,
   external-change reload.
3. **Navigation modals** — the shared modal pattern (05), then Go to File as
   its first consumer (04), validating the in-memory index + worker fuzzy
   filtering on factorial. Recent files and jump history ride along.
4. **Global search** (03) — modal, bottom panel, search tabs, global
   replace. De-risked by 2 (shared buffers make editable previews work) and
   3 (modal pattern).
5. **Git + background tasks** (09, 10) — independent and small; tasks UI
   must land before LSP (installs/env resolution are its first clients).
6. **LSP and dependents** (08) — servers, env handling, diagnostics; then
   quality reports (12) on top of the diagnostics store, and Rails niceties
   (11) last.

Keybindings (14) are not a phase: each feature lands its own bindings, with
the spec as the registry.

## Non-goals for phase 1

Deliberately out of scope — these were removed from sourcedelve and are not
wanted here:

- Integrated terminal and debugger.
- Remote development.
- Multi-cursor editing and modal (vim) editing.
- Plugin system, external themes.
- Command palette (replaced by native menus + per-feature modals).
- File preview mode (single-click temporary tabs).
- Draggable/rearrangeable panels.

## Progress log

| Date | Update |
| --- | --- |
| 2026-06-10 | Project scaffolded (Electron, React, Tailwind, @pierre/trees, CodeMirror 6). Virtualized file tree browsing 98k-file repo verified. |
| 2026-06-11 | Functional specs written for all goals under docs/specs/ (16 files), mined from the sourcedelve implementation. Scope locked: macOS only, dark theme only. |
| 2026-06-11 | Stage 1 (Foundations) done: design tokens + Inter/JetBrains Mono + gradient shell, 3-panel layout with resize/toggle persistence, native menu bar with Open Recent, one-workspace-per-window + welcome window + session restore + single instance, JSON persistence with atomic writes. Verified via CDP on the real app. |
| 2026-06-11 | Stage 3 (Navigation) done: shared resizable modal pattern, Go to File with worker-thread fuzzy matching (60ms on 98k files, 200-cap, previous-query reuse, absolute paths), Recent Files popup with intent-based recency + duplicate-basename hints, jump history with back/forward, Go to Line (N / N:C) from menu and status bar. CDP-verified end to end on factorial. |
| 2026-06-11 | Stage 2 (Editor core) done: document manager (one buffer per file, state survives tab switches), editor tabs with insert-after-active / move-next-to-active / LRU-50 / middle-click + context-menu close, 700ms autosave, external-changes-win reload via @parcel/watcher, line ops + syntax-aware expand/shrink selection, per-file cursor/scroll persistence, tab restore. CDP-verified: autosave to disk, external reload, tab rules, restore across relaunch. |
