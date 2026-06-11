# Spec 01 — Workspace & Project Model

## Concepts

- **Workspace**: the folder the user opens. The only unit of opening — there
  is no "open one file". Everything (tabs, searches, tree, persistence) is
  scoped to a workspace.
- **Project**: a sub-unit detected *inside* a workspace, for monorepo support.
  A workspace contains 1..N projects. Projects drive LSP server startup
  (see [08-lsp.md](08-lsp.md)) and are shown in the UI.

## Workspace lifecycle

### Opening

- "Open Folder" is available from: the File menu (`File > Open Folder…`), the
  welcome window, and the empty-workspace state. It shows the native macOS
  directory picker (directories only — file selection is not possible).
- Opening a folder when a workspace is already open in the current window
  creates a **new window**. It never replaces the current window's workspace.
- Opening the same folder twice is allowed and creates two independent
  windows with independent state (tabs, cursors, searches). They share
  persisted state on disk; last-closed wins on write.
- One workspace per OS window, always. A window's identity is its workspace.

### Open Recent

- `File > Open Recent` submenu lists the **10** most recently opened
  workspaces, most recent first, by last-open timestamp.
- The workspace open in the current window is filtered out of the list.
- Selecting one opens it in a **new window** (or focuses an existing window
  that already has it open — focusing is preferred over duplicating when
  invoked from the menu).
- If empty, show a disabled "No Recent Workspaces" item.
- Recent list updates (timestamp refresh / insertion) every time a workspace
  is opened.

### Closing

- Closing a workspace window (red traffic light, or `File > Close Window`)
  persists that workspace's state (see [15-persistence.md](15-persistence.md))
  and closes the window.
- `Cmd+W` closes the active editor tab, NOT the window (see
  [14-keybindings.md](14-keybindings.md)).

### The welcome window

- When the last workspace window is closed, the app does NOT quit. Instead a
  **welcome window** opens (if not already open).
- The welcome window is a small fixed window (centered, ~720×460, not
  resizable, no panels) containing:
  - The Argus logo, dimmed (low opacity), centered at top.
  - A **Start** section with an "Open Folder" button.
  - A **Recent** section listing up to **8** recent workspaces. Each row:
    folder name (normal weight) + full path with `~` substitution (dimmed,
    smaller font). Click opens that workspace — the welcome window closes and
    a workspace window opens. A small **×** on hover removes the entry from
    the remembered list (persisted; also reflected in `File > Open Recent`).
- Closing the welcome window **quits the application**.
- App launch with no CLI arguments and no restorable previous session shows
  the welcome window.
- macOS dock-icon reopen (app running, no windows — possible only
  transiently): show the welcome window.

### Startup & restore

- On launch, restore all windows that were open when the app last quit:
  workspace, window geometry (size/position, clamped to sane minimums),
  and per-workspace state. If none, show the welcome window.
- The window must appear immediately; defer everything slow (file listing,
  git status, LSP, env resolution) to after first paint. Show the workspace
  chrome with progressive loading rather than blocking.
- Single-instance app: launching Argus again (e.g. `open -a Argus ~/code/x`
  or CLI) routes the request to the running instance, which opens the folder
  in a new window. The second process exits.

### Quit

- `Cmd+Q` quits: persists every open workspace window's state + the window
  list (for restore), then exits.

## Project model

### Detection

Projects are detected **lazily**: when a file is opened, walk UP from the
file's directory toward the workspace root looking for marker files. The
**deepest** (closest to the file) match wins as that file's project root.
Cache every discovered project for the lifetime of the window.

Marker files → project kind:

| Marker | Kind |
| --- | --- |
| `Gemfile` | ruby |
| `package.json` | javascript |
| `Cargo.toml` | rust |
| `go.mod` | go |
| `pyproject.toml`, `setup.py`, `setup.cfg` | python |
| `mix.exs` | elixir |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | java |
| `Package.swift` | swift |

Additional classification:

- A ruby project containing `config/environment.rb` is a **Rails** project
  (see [11-rails.md](11-rails.md)).
- A project may match multiple kinds (e.g. Rails app with `package.json`):
  it is then both, and both kinds' LSP rules apply.

### Project metadata

For each detected project, capture (lazily, from the project's resolved
shell environment — see [08-lsp.md](08-lsp.md)):

- Root path (workspace-relative).
- Kind(s) + special flavor (Rails).
- Tool versions where detectable: ruby version, node version, etc. (parsed
  from the project env: `MISE_RUBY_VERSION`, `RBENV_VERSION`, nvm/fnm vars,
  or by running `ruby -v` / `node -v` with the project env).

### Projects UI

- A "Projects" view (opened via `View > Show Projects` menu item) lists all
  detected projects as cards: root path, kind badge (e.g. "Rails", "Ruby",
  "JavaScript"), tool versions (e.g. "Ruby 3.2.2"), and the LSP servers
  currently running for it with their state (starting / running / failed).
- Nested projects are indented under their parent.
- The list grows as detection happens (it's lazy); opening the view does not
  force a full workspace scan.

### What projects affect

- **LSP**: which servers start and with which root (see [08-lsp.md](08-lsp.md)).
- **Rails features**: schema panel availability.
- Projects do NOT affect search scope, the file tree, or go-to-file — those
  operate on the whole workspace.

## Acceptance checklist

- [ ] Open folder → new window; never replaces.
- [ ] 10-entry Open Recent in File menu, current workspace filtered out.
- [ ] Close last workspace window → welcome window; close welcome → quit.
- [ ] Welcome window: logo, Open Folder, 8 recent entries with `~` paths.
- [ ] Relaunch restores previous windows + geometry.
- [ ] Second app launch routes to running instance.
- [ ] Opening a Ruby file deep in a monorepo detects the nearest `Gemfile`
      project and caches it.
- [ ] Projects view lists detected projects with kind, versions, servers.
