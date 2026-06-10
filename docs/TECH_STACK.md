# Argus — Tech Stack & Architecture Decisions

Argus is a desktop code editor built on Electron. This document records the
stack choices and the performance rules behind them. The benchmark target:
browsing a repository with ~100k tracked files (e.g. `~/code/factorial`, 98k
files) must feel instant.

## Core stack

| Concern        | Choice                          | Why |
| -------------- | ------------------------------- | --- |
| Shell          | Electron                        | Product requirement. |
| Build tooling  | electron-vite + electron-builder| Standard modern setup: Vite HMR for the renderer, proper main/preload builds, packaging later. |
| Language       | TypeScript everywhere           | Main, preload, and renderer share types via `src/shared/types.ts`. |
| UI framework   | React 19                        | Largest ecosystem. The two hot paths (editor, file tree) do not render through React anyway, so framework overhead is not where performance is decided. |
| Styling        | Tailwind v4 (`@tailwindcss/vite`)| Product requirement. |
| State          | Zustand                         | Minimal API, usable outside components (`useRepoStore.getState()` from imperative callbacks like CodeMirror keymaps and tree selection handlers). |
| Editor         | CodeMirror 6                    | Lighter and faster than Monaco on huge files; small core + extensions design makes custom features (decorations, widgets, behaviors) first-class. Lezer for incremental parsing; `web-tree-sitter` can be layered later for real ASTs. |
| File tree      | `@pierre/trees`                 | Purpose-built virtualized file tree (Apache-2.0, by the Pierre Computer Company). Path-first API, built-in virtualization, git status badges, search, flattened empty directories, drag & drop, context menus. Beta-status is the accepted trade-off. |

### Why CodeMirror 6 over Monaco

- Significantly lighter; handles documents Monaco struggles with.
- Designed as a small core + extensions — custom decorations/widgets/behaviors
  are first-class, while Monaco fights you when deviating from "embedded VS Code".

## Performance architecture

**The rule: the renderer process never touches the filesystem, and nothing
loads eagerly per-node.**

- **All fs/git work happens in the main process**, exposed to the renderer
  through a typed `contextBridge` API (`window.api`, typed by
  `src/shared/types.ts`). Implementation lives in `src/main/repo.ts`.
- **File listing**: `git ls-files --cached --others --exclude-standard -z` —
  one process spawn returns all ~100k paths in well under a second and
  respects `.gitignore`. Fallback for non-git folders is a manual walk that
  prunes `node_modules` and `.git`.
- **File tree rendering**: `@pierre/trees` virtualizes — only visible rows are
  mounted. Paths are pre-processed with `prepareFileTreeInput()` before being
  handed to the model (`model.resetPaths(paths, { preparedInput })`).
- **Git status decorations**: `git status --porcelain=v1 -z` parsed in the main
  process, fed to `model.setGitStatus()`. Never use JS git implementations
  (isomorphic-git etc.) — too slow at this scale.
- **File reads are guarded**: 5MB size cap, binary detection (NUL byte scan),
  and path traversal protection (reject paths escaping the repo root).
- **Search (planned)**: bundle ripgrep (`@vscode/ripgrep`), spawn from the main
  process, stream results over IPC. Never implement content search in JS.
- **File watching (planned)**: `@parcel/watcher` (native, used by VS Code) —
  not chokidar, which struggles at 100k files. Ignore `node_modules`/`.git`.
- **IPC**: keep payloads structured-cloneable; if a payload grows beyond a few
  MB, stream it in chunks instead of one giant message.

## Tooling

- **pnpm** — package manager.
- **Biome** — lint + format in one fast tool (`pnpm lint`, `pnpm format`).
  Replaced the scaffold's eslint + prettier.
- **Vitest** — unit tests (`pnpm test`). Tests run real code against real
  temp git repos — no mocking of application code.
- **Playwright** — planned for E2E against the Electron app.

## Project layout

```
src/
  main/      Electron main process (window, IPC handlers, repo.ts fs/git ops)
  preload/   contextBridge — exposes typed window.api
  shared/    types shared across processes (ArgusApi, GitStatusEntry, ...)
  renderer/  React app (App.tsx, store.ts, components/)
```

## Commands

- `pnpm dev` — run the app with HMR
- `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm test`
- `pnpm build:mac` — package for macOS
