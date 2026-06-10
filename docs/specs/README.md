# Argus — Functional Specifications

These specs expand every goal in [../PHASE_1_GOALS.md](../PHASE_1_GOALS.md)
into implementable functional specifications. They are the source of truth for
behavior. When implementing a feature, read its spec file fully first.

File numbering is thematic, NOT build order — the implementation order lives
in the "Implementation roadmap" section of
[../PHASE_1_GOALS.md](../PHASE_1_GOALS.md).

## Provenance

Behaviors come from two sources, in this priority order:

1. **RubyMine** — the north star for look & feel, shortcuts, and UX.
2. **sourcedelve** (`~/code/lapce`) — Roger's abandoned predecessor editor
   (a fork of Lapce, in Rust). Its implementation was mined commit-by-commit
   for the exact behaviors specced here. When a spec cites a constant (a
   debounce, a limit, a color), it comes from sourcedelve unless stated
   otherwise.

Where the two disagreed, RubyMine behavior wins (this resolution has already
been applied in these specs — they are internally consistent).

## Scope decisions (locked)

- **macOS only.** Native macOS menu bar, Cmd-based keymap, macOS conventions.
  No Windows/Linux work in phase 1.
- **Dark theme only.** One theme, specced in the design system.
- **No**: terminal, debugger, remote dev, multi-cursor, vim/modal editing,
  plugins, external themes, command palette, file preview tabs, draggable
  panels.

## Files

| Spec | Covers |
| --- | --- |
| [01-workspace-and-project-model.md](01-workspace-and-project-model.md) | Workspace lifecycle, welcome window, project detection (monorepos) |
| [02-shell-and-layout.md](02-shell-and-layout.md) | 3-panel layout, title bar, status bar, native menus, panel system |
| [03-global-search.md](03-global-search.md) | ⭐ Search modal, bottom panel, search tabs, global replace, backend |
| [04-go-to-file.md](04-go-to-file.md) | ⭐ Go to file modal |
| [05-navigation.md](05-navigation.md) | Recent files, jump history, go to line/symbol/definition, modal pattern |
| [06-editor.md](06-editor.md) | Auto-save, external reload, tabs, selection, line ops, in-editor find |
| [07-file-tree.md](07-file-tree.md) | Tree behavior, starred folders, exclusions, locate, context menu |
| [08-lsp.md](08-lsp.md) | Server lifecycle per language, env handling, features, diagnostics |
| [09-git.md](09-git.md) | Branch display, file status colors, update strategy |
| [10-background-tasks.md](10-background-tasks.md) | Task reporting UI, slow operation report |
| [11-rails.md](11-rails.md) | Rails detection, ActiveRecord schema panel |
| [12-quality-reports.md](12-quality-reports.md) | ESLint, Semgrep |
| [13-design-system.md](13-design-system.md) | Colors, typography, spacing, modal styling, icons |
| [14-keybindings.md](14-keybindings.md) | Complete keymap |
| [15-persistence.md](15-persistence.md) | Everything persisted, where, and when |

## Architecture context

The implementation stack is documented in [../TECH_STACK.md](../TECH_STACK.md).
Key constraint that applies to every spec: **the renderer process never touches
the filesystem or spawns processes** — all fs/git/ripgrep/LSP work happens in
the Electron main process (or utility processes), exposed over typed IPC.
Sourcedelve had the same split (UI process + proxy process); when a spec says
"backend", it means the Electron main/utility process side.
