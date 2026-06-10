# Spec 15 — Persistence

All persistence is JSON files under
`~/Library/Application Support/Argus/` (the Electron `userData` dir).
Writes are async and atomic (write temp + rename); the UI never blocks on
persistence. **No backward-compatibility guarantees during phase 1** — on
schema mismatch, discard the stale file and start fresh.

## Layout

```
userData/
├── settings.json                 # user settings (spec 02), user-edited
├── state/
│   ├── app.json                  # window list for restore, welcome-window geometry
│   ├── recent-workspaces.json    # [{path, lastOpen}]
│   └── workspaces/<hash>/        # hash = sha256 of workspace absolute path
│       ├── workspace.json        # everything per-workspace (below)
│       └── files/<sha256-of-relpath>.json   # per-file cursor/scroll
└── lsp-servers/…, lsp-update-markers/…       # spec 08
```

## `app.json`

- Open windows at last quit: workspace path + window bounds + maximized.
- Used at launch to restore the session (spec 01). Window bounds < 10px are
  discarded (defaults used).

## `recent-workspaces.json`

- Up to 50 entries `{path, lastOpen}` (menus show 10 / welcome shows 8).
- Entry upserted on every workspace open. Entries whose path no longer
  exists are dropped lazily when listed.

## `workspaces/<hash>/workspace.json`

| Section | Contents |
| --- | --- |
| `editor` | open tabs in order (file path, external flag), active tab index, split layout (phase 1: single pane allowed shape) |
| `panels` | visibility + sizes of left/bottom/right panels |
| `searchTabs` | per tab: pattern, caseSensitive, wholeWords, isRegex, scopeFolder; plus activeTabIndex (spec 03) |
| `searchOptions` | last global case/word/regex toggles + last modal pattern |
| `recentFiles` | up to 100 workspace-relative paths, recency order (spec 05) |
| `starredFolders` | workspace-relative first-level folders (spec 07) |
| `excludedPaths` | workspace-relative prefixes (spec 07) — note: workspace-scoped setting, lives here, not in settings.json |

## `files/<hash>.json`

`{cursorOffset, scrollTop}` per file. Written when: a tab closes, a tab is
evicted (LRU), the editor loses focus to another tab, the window closes.
Read when the file opens. These power "reopen where I left".

## When saves happen

- Workspace.json: on window close, on app quit, and debounced (~2s) after
  any contributing state changes (tab open/close/reorder, panel resize,
  search tab change, star/exclude change). Crash-safety matters more than
  write volume.
- app.json + recent-workspaces.json: on workspace open/close and quit.

## What is intentionally NOT persisted

- Search results (recomputed; tabs restore lazily, spec 03).
- Jump history (session-only).
- Tree expansion state (fresh tree each open; the editor restores context
  via tabs + locate).
- Modal sizes (session-only).

## Acceptance checklist

- [ ] Quit & relaunch: windows, tabs, active tab, cursor/scroll, panel
      sizes, search tabs (lazy), stars all restored.
- [ ] Corrupt/old state file → silently reset, app still opens.
- [ ] Kill -9 during use loses at most the last ~2s of layout changes.
