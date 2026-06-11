# Spec 02 — Shell & Layout

## Window layout (workspace window)

Fixed three-region layout. No drag-rearranging of panels.

```
┌────────────────────────────────────────────────────────┐
│ Title bar (native traffic lights + custom content)     │
├──────────┬─────────────────────────────────────────────┤
│ File     │  Editor area (tabs + editor)                │
│ tree     │                                             │
│ (left)   │                                             │
├──────────┴─────────────────────────────────────────────┤
│ Bottom panel — FULL WIDTH (search results)             │
├────────────────────────────────────────────────────────┤
│ Status bar                                             │
└────────────────────────────────────────────────────────┘
```

The bottom panel spans the **full window width** (under the file tree too),
like RubyMine's bottom tool windows. When the bottom panel grows, the file
tree and editor shrink together.

- **Left panel** — File tree (spec 07). Also hosts the schema panel section
  when applicable? No — schema is a **right panel** (see below).
- **Editor area** — editor tab bar + active editor. Supports splits
  (spec 06), but phase 1 default is a single pane.
- **Bottom panel** — global search results with persisted tabs (spec 03).
  Hidden by default; opens when a search is sent to it.
- **Right panel** — Rails schema panel (spec 11). Hidden by default; only
  appears for Rails model files.

### Sizes & resizing

- Default left panel width: **250px**. Default bottom panel height: **300px**.
  Default right panel width: **250px**.
- All three panels resizable by dragging their inner edge. Sizes persisted
  per workspace.
- Panels are toggleable (visible/hidden). Visibility persisted per workspace.
- `Cmd+1` toggles+focuses the file tree (RubyMine). Toggling the bottom panel
  happens via search commands; there are also View-menu items for each panel.
- Minimum panel sizes: 150px (left/right), 100px (bottom). Window minimum:
  600×400.

## Title bar

- Native macOS traffic lights (hiddenInset style — content extends to top,
  with ~75px left inset reserved).
- Left: workspace folder name (bold-ish, normal foreground).
- Next to it: **git branch indicator** (spec 09): branch icon + branch name;
  when the repo is in a special state, append the state label (e.g.
  "(Rebasing)") in the warning color. Hidden when not a git repo.
- The whole title bar is a drag region (excluding interactive controls).
- Right: nothing in phase 1 (no settings gear — settings live in the app
  menu).

## Status bar

Height **25px**, background = secondary background color, top border.
Left → right:

1. **Background task indicator** (spec 10): pulsing gear icon + name of the
   most recent active task. Click toggles the tasks popup. Hidden when idle.
3. *(spacer)*
4. **Cursor position**: `line:col` (1-indexed). Click → opens Go to Line
   modal (spec 05).
5. **Language label** of the active editor (e.g. "Ruby", "TypeScript").

## Native macOS menus

Full menu bar. All commands the app supports must be reachable from menus
(there is no command palette). Structure:

```
Argus
├── About Argus
├── Settings…                Cmd+,
├── ───────
├── Hide Argus / Hide Others / Show All     (standard)
└── Quit Argus               Cmd+Q

File
├── Open Folder…
├── Open Recent              ▸ (10 entries; "No Recent Workspaces" when empty)
├── ───────
├── New File                 Cmd+N
├── Save                     Cmd+S
├── Save All                 Cmd+Alt+S
├── ───────
├── Close Tab                Cmd+W
└── Close Window             Cmd+Shift+W

Edit (standard macOS edit menu)
├── Undo Cmd+Z / Redo Cmd+Shift+Z
├── Cut/Copy/Paste/Select All
├── ───────
├── Find                     Cmd+F
├── Replace                  Cmd+R
├── Find in Files            Cmd+Shift+F
└── Replace in Files         Cmd+Shift+R

View
├── Toggle File Tree         Cmd+1
├── Toggle Search Panel
├── Toggle Schema Panel
├── ───────
├── Show Projects
├── Reveal Active File in File Tree
├── ───────
├── Zoom In Cmd+= / Zoom Out Cmd+- / Reset Zoom
└── Toggle Inlay Hints

Navigate
├── Go to File…              Cmd+Shift+O
├── Go to Symbol…            Cmd+O
├── Recent Files…            Cmd+E
├── Go to Line…              Cmd+L
├── ───────
├── Back                     Cmd+Alt+Left
└── Forward                  Cmd+Alt+Right

Code
├── Go to Definition         Cmd+B
├── Go to Type Definition
├── ───────
├── Show Hover Info
├── Show Quick Fixes         Alt+Enter
├── ───────
├── Rename Symbol            Shift+F6
├── Format Document
├── ───────
├── Comment Line             Cmd+/
├── Duplicate Line           Cmd+D
├── Move Line Up             Alt+Shift+Up
└── Move Line Down           Alt+Shift+Down

Window (standard) 
├── Minimize / Zoom
└── (open windows list)

Help
├── Open Logs Directory
└── Show Environment        (debug: dump resolved env per project)
```

Menu items are enabled/disabled by context (e.g. Save disabled with no
editor; Close Tab disabled with no tabs). File menu shows "Open Folder…"
always (a new window is created, so no Close Folder concept).

## Settings

- No GUI settings panel in phase 1. `Settings…` (Cmd+,) opens the JSON
  settings file (`~/Library/Application Support/Argus/settings.json`) in an
  editor tab. The file is watched: changes apply live where feasible.
- All settings mentioned across these specs live in this file, with defaults
  compiled into the app. Unknown keys are ignored with a logged warning.

## Empty workspace state

(Reached only transiently — workspace windows always have a folder. Kept for
the welcome window, spec 01.)

## Acceptance checklist

- [ ] 3 panels + status bar render with default sizes; resize + toggle
      persist per workspace.
- [ ] Title bar shows workspace name + git branch and is draggable.
- [ ] Status bar: diagnostics counts, task indicator, cursor pos, language.
- [ ] All menus present; every command reachable; shortcuts displayed.
- [ ] Cmd+, opens settings.json in a tab; edits hot-reload.
