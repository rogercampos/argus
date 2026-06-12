# Argus — Comprehensive Test Coverage Plan

Goal: lock in everything that works today so it keeps working. We follow the
classic test pyramid:

1. **E2E (few)** — Playwright driving the real packaged Electron app through
   the UI. Covers the main flows and the most important features.
2. **Integration (many)** — exercise full operations without driving a real
   browser window. Two suites: main-process feature tests (real IPC handler
   logic against real temp git repos) and renderer feature tests (components +
   stores in jsdom, backed by the real main-process modules wherever possible).
   Together these must cover **every functionality exposed in the UI**.
3. **Unit (most)** — pure-logic tests pushing coverage toward ~100%, covering
   all edge cases.

Plus a **coverage report** so we can measure and iterate.

**House rules** (already established in this repo, keep them):
- Tests run real code against real temp git repos. No mocking of application
  code. Only truly external things may be faked (e.g. an LSP server binary).
- Vitest for unit/integration, Playwright for E2E.
- macOS only, dark theme only (phase 1 scope).

Track progress by checking items off. Each phase is landable independently.

---

## Current state (baseline, 2026-06-12)

Existing: 14 vitest files, node environment, no coverage tooling, no E2E.

| Area | Tested today |
| --- | --- |
| main | `git` (status parsing), `lsp`, `procRegistry`, `repo`, `schema`, `search`, `state` |
| renderer | `documents`, `fuzzy`, `history`, `lineHighlight`, `ruby/rubyHighlight`, `tabs`, `treeSort` |

Untested: everything else — all React components, `store.ts` (16 KB),
`searchStore.ts`, `lsp.ts` (renderer client), `languages.ts`,
`editorKeymap.ts`, and in main: `ipc.ts`, `menu.ts`, `windows.ts`,
`watcher.ts`, `tasks.ts`, `semgrep.ts`, `procStats.ts`, `index.ts`.

---

## Phase 0 — Test infrastructure

- [x] **Coverage**: add `@vitest/coverage-v8`. Configure in `vitest.config.ts`:
      include `src/**`, exclude `*.test.ts`, `*.d.ts`, `src/shared/types.ts`
      (types only), generated wasm, `out/`, `build/`. Reporters: `text`,
      `html`, `json-summary`. Add script `pnpm test:coverage`.
- [x] **Vitest projects**: split config into two projects — `main`
      (node env, `src/main/**`, `src/shared/**`) and `renderer` (jsdom env,
      `src/renderer/**`). Add `jsdom`, `@testing-library/react`,
      `@testing-library/user-event`, `@testing-library/jest-dom`.
- [x] **jsdom shims for CodeMirror**: setup file providing
      `Range.getClientRects`/`getBoundingClientRect`, `ResizeObserver`,
      `matchMedia` — required for `EditorView` to mount in jsdom.
- [x] **Fixture workspace factory** (`test/fixtures.ts`): helper that builds a
      real temp git repo with a configurable file layout (incl. a small Rails
      shape with `db/schema.rb` and `app/models/*` for schema tests, binary
      files, >5 MB file, nested gitignored dirs). Used by integration and E2E.
      Several main tests already build ad-hoc temp repos — extract and share.
- [x] **`window.api` test adapter** (`test/apiAdapter.ts`): an `ArgusApi`
      implementation for renderer tests that calls the **real** main-process
      modules directly (`repo.ts`, `state.ts`, `search.ts`, `schema.ts`,
      `git.ts` are plain Node modules — import them, no Electron needed).
      Event channels (`onGitState`, `onSearchProgress`, …) exposed as emitters
      the test can drive. This keeps the no-mocking rule: real code end to
      end, minus the IPC wire.
- [x] **E2E harness**: add `@playwright/test`. `e2e/` directory with a fixture
      that runs `electron-vite build` once, then `_electron.launch()` on
      `out/main/index.js` with `ARGUS_OPEN=<temp fixture repo>`.
- [x] **Testability change — isolated user data**: `src/main/index.ts` calls
      `initStateDir(app.getPath('userData'))`. Honor an `ARGUS_USER_DATA` env
      var (`app.setPath('userData', …)` before ready) so E2E runs never touch
      real app state and each test gets a clean slate. (Small, dev-only.)
- [x] **CI**: GitHub Actions (macOS runner) running typecheck, lint,
      `test:coverage`, and the E2E suite. Upload coverage HTML + Playwright
      traces as artifacts.

---

## Phase 1 — E2E suite (Playwright + Electron)

Few, slow, high-value. Each scenario uses a fresh fixture repo and isolated
user data. Target: ~12 specs covering the main flows.

- [x] **Launch & welcome**: launch with no state → welcome window; open a
      workspace from the recent list (pre-seeded state); remove a recent entry.
- [x] **Open workspace & browse**: file tree paints (top-level first, then
      full), expand folders, click a file → opens in editor with content.
- [x] **Edit & save**: type in editor → dirty indicator on tab → Cmd+S →
      file content on disk updated, dirty cleared. Save All with two dirty
      tabs.
- [x] **Tabs**: open several files, switch via click and Ctrl+Tab/menu
      commands, close tab, active tab follows correctly.
- [x] **Go to file**: Cmd+P style modal — fuzzy query, arrow-key navigation,
      Enter opens the right file. Recent-files modal variant.
- [x] **Global search**: search a term → streamed results grouped by file,
      flag toggles (case/word/regex) change results, click result opens file
      at the right line with the match highlighted, search tabs persist.
- [x] **Replace all**: pattern + replacement across the fixture repo →
      files changed on disk, result count reported.
- [x] **File watcher**: create/modify/delete a file on disk externally →
      tree updates, git badge appears.
- [x] **Git presence**: branch name in status bar; modify a file → modified
      decoration in the tree; switch branch externally → status bar updates.
- [x] **Navigation**: go-to-line modal; jump back/forward across files.
- [x] **Persistence (restart)**: open tabs, resize panels, star a folder →
      quit → relaunch → tabs, active tab, layout, starred folders restored;
      cursor/scroll position restored per file.
- [x] **Editor find/replace in file** (CodeMirror search panel) via menu.

Out of E2E scope (covered at lower layers instead): LSP features (need
language servers installed — environment-dependent), process monitor,
semgrep, Rails schema panel.

**Status (done 2026-06-12, 27 specs green): all flows above are covered, with
these bits deferred to Phase 3 (renderer integration): git badges in the tree,
search-tab persistence across restarts, per-file cursor/scroll restore, and
single-match replace from the modal.**

E2E notes:
- Runs are headless-style: `ARGUS_HIDE_WINDOWS=1` (never shows windows, hides
  the dock icon, disables background throttling) and `ARGUS_DISABLE_LSP=1`
  (no server installs/spawns). Set `ARGUS_E2E_HEADED=1` to watch locally.
- Menu commands are sent over the real 'menu' channel via webContents (native
  macOS menus can't be driven by synthesized keys); the menu template itself
  is covered in Phase 2.
- Two real bugs found and fixed by this phase: (1) a symlinked workspace root
  (e.g. /var -> /private/var) broke watcher relPaths for open-document
  reloads; (2) external rewrites surfacing as 'create' events (FSEvents
  coalescing, atomic-rename writers) did not reload open documents.

---

## Phase 2 — Integration: main process

Exercise each IPC handler's implementation against real temp repos. Most
handlers delegate to modules that are already partially tested — this phase
completes the matrix so **every channel** has tests. Where the logic lives in
`ipc.ts` itself, extract it into a testable module function (handlers should
be one-line wiring).

- [x] `repo:list-files` — git repo (respects .gitignore), non-git fallback
      walk (prunes node_modules/.git), empty repo, unicode/space filenames.
- [x] `repo:list-top-level` — dirs get trailing slash, ordering.
- [x] `repo:git-status` — all status letters, renames, ignored, mid-merge.
- [x] `file:read` / `file:read-abs` — happy path, 5 MB cap, binary (NUL)
      detection, path-traversal rejection, missing file, permission error.
- [x] `file:write` / `file:write-abs` — happy path, traversal rejection,
      creating parent dirs (or error, whichever is the behavior), failure path.
- [x] `file:exists`.
- [x] `search:start` / `search:cancel` — real ripgrep: streaming batches,
      case/word/regex flags, scope folder, excluded paths, max-results cap +
      `capped` flag, cancel mid-search kills the process, no zombie procs.
- [x] **replaceAll** — multi-file replacement counts, regex capture groups,
      respects same flags/scope as search.
- [x] `workspace:save-state` / `load-state` / `load-file-state` — round-trip,
      corrupt JSON on disk → safe default, schema defaults for missing keys
      (`defaultWorkspaceState`), per-workspace keying.
- [x] `app:recent-workspaces` / `remove-recent-workspace` — ordering by
      lastOpen, limit, dedupe, removal.
- [x] `watch:start` — real `@parcel/watcher` on a temp dir: create/update/
      delete events arrive with correct relPaths, node_modules/.git ignored,
      debounce/batching behavior.
- [x] **Git monitor** (`git.ts` beyond parsing) — branch detection, rebase/
      merge/cherry-pick state detection from `.git` files, status diff
      computation (entry added / removed / changed → `null` semantics).
- [x] `rails:schema-for` — model→table inference (pluralization,
      `self.table_name`), columns/indexes/line numbers, non-Rails repo → null.
- [x] **LSP manager** (`src/main/lsp/`) — project discovery (kinds, isRails,
      tool versions), routing a file to the right project, server lifecycle
      against a **fake LSP server script** (a tiny Node stdio process speaking
      LSP — external binary, fair to fake): didOpen/didChange/didClose
      sequencing, hover/completion/definition/symbols request-response,
      diagnostics push, server crash → restart or graceful degradation.
- [x] **procRegistry / procStats** — register/unregister, descendant rollup,
      activity aggregation windows, `app:slow-ops` recording and retrieval.
- [x] **semgrep.ts** — invocation and result parsing (skip if binary not
      present; gate behind availability check).
- [x] **tasks.ts** — queued→started→progress→finished update sequence.
- [x] **menu.ts** — menu template builds; every `MenuCommand` in
      `shared/types.ts` is reachable from some menu item (guards against
      adding a command and forgetting the menu entry).
- [x] **windows.ts** — session restore decision logic (ARGUS_OPEN wins,
      saved windows, fallback to welcome); bounds save/restore. Extract pure
      decision logic from Electron wiring where needed.

**Status (done 2026-06-12, 84 new tests; main suite 137 tests total): every
IPC channel and main-process module covered. Coverage: `src/main` 97.4% lines,
`src/main/lsp` 89.3% lines.** Implementation notes:

- The Electron runtime is replaced in tests by `test/electronStub.ts` via a
  vitest alias (Electron is the external platform — application code runs
  unmodified). `ipc.ts` is tested by invoking the real registered handlers
  with stub windows; `menu.ts`/`windows.ts` run against stub Menu/windows.
- The fake LSP server (`test/fakeLspServer.mjs`, a real stdio child process
  speaking JSON-RPC) drives manager+client integration: lifecycle, hover,
  completion, definition (Location and LocationLink), workspace symbols,
  push and pull diagnostics, crash handling, dispose.
- Two injection seams added (optional constructor params, defaults
  unchanged): `LspManager(registryFor)` and `SemgrepRunner(envFor)`.
- Two more real bugs found and fixed: (3) `writeJsonAtomic` temp names
  collided for same-millisecond concurrent writes (session restore with two
  windows crashed the write); (4) a crashed LSP server left in-flight
  requests hanging forever — the connection is now disposed on process exit.
  Plus a renderer race: Go to File opened during startup kept fuzzy-matching
  against the top-level skeleton; the modal now refeeds its worker when the
  path list changes.

---

## Phase 3 — Integration: renderer (jsdom + real backend modules)

Render real components with `@testing-library/react`, real Zustand stores,
and the `window.api` adapter from Phase 0 backed by real main modules and a
real temp fixture repo. This is where we cover **all UI-exposed functionality**
that E2E only samples.

Workspace shell & layout
- [ ] `WorkspaceShell` — initial load sequence: top-level paint → full file
      list → git status; panel toggles (left/bottom/right) via menu commands;
      `Resizer` drag updates widths and persists layout.
- [ ] `Welcome` — recent list rendering, open/remove actions.
- [ ] `TitleBar`, `StatusBar` — branch/git state display, task updates,
      diagnostics summary, proc stats display.

File tree (`Sidebar`)
- [ ] Tree renders from file list; expand/collapse; select opens file.
- [ ] Git status badges from status entries; updates on diff events.
- [ ] Starred folders: star/unstar, persisted, shown in star section.
- [ ] Excluded paths dimmed; skeleton → full swap keeps expanded folders
      (regression: commit 9f41c3d).
- [ ] Watch events: create/delete files update the tree.
- [ ] Context-menu actions: reveal in Finder (api called), copy relative
      path (clipboard api called), copy path.

Editor area
- [ ] `EditorPane` — mounts CodeMirror with file content; language chosen by
      extension (`languages.ts`); read-only/binary/too-large fallbacks render
      a message, not a crash.
- [ ] `EditorTabs` — open/activate/close/dirty markers; next/previous-tab
      commands; close-tab on dirty file behavior.
- [ ] Dirty tracking + save/save-all through real `documents.ts` →
      `writeFile` → content really on disk.
- [ ] File view state: cursor/scroll saved on switch, restored on return.
- [ ] Menu-command keymap actions: comment-line, duplicate-line,
      move-line-up/down on real CodeMirror state.
- [ ] Line highlight on jump (`lineHighlight` in situ).

Modals (all via `Modal.tsx` host)
- [ ] `GoToFileModal` — fuzzy results (real worker logic, run synchronously),
      keyboard navigation, enter opens, path tail truncation (`PathTail`).
- [ ] `RecentFilesModal` — ordering, missing files filtered.
- [ ] `GoToLineModal` — parse `:line:col`, clamp out-of-range.
- [ ] `GoToSymbolModal` — symbols from api, filtering, selection jumps.
- [ ] `DefinitionPicker` — multiple definition targets, pick one.
- [ ] `ProjectsModal` — detected projects listing.
- [ ] `SlowOpsModal` — rows from `slowOps()`.
- [ ] `SearchModal` — query → streamed results, arrow-key nav **after
      clicking a result** (regression: commit 9c9a415), syntax-highlighted
      match lines (regression: fa61ed4), enter opens at line.

Search panel
- [ ] `SearchPanel` + `searchStore` — start search → batches accumulate;
      flag toggles re-run search (regression: 2e27649); scope to folder;
      multiple search tabs (create/switch/close/persist); capped indicator;
      cancel on new input.
- [ ] `SearchPreview` — match context rendering, click-to-open.
- [ ] Replace-all flow from the panel, confirmation, result toast/counts.

LSP client (`renderer/src/lsp.ts`)
- [ ] didOpen/didChange/didClose lifecycle tied to tab lifecycle.
- [ ] Diagnostics → CodeMirror lint decorations.
- [ ] Hover/completion/definition wiring (fake server from Phase 2).

Stores (direct, where component tests don't reach the edge cases)
- [ ] `store.ts` (WorkspaceStore) — every action and derived value: open
      file, open external file (absolute path tabs), close, reorder,
      recent-files tracking, starred folders, excluded paths, panel state,
      persistence debounce → `saveWorkspaceState` payload shape.
- [ ] `searchStore.ts` — tab model edge cases, id allocation, stale-result
      rejection (results for an old searchId ignored).
- [ ] `procStore.ts`, `tasksStore.ts` — snapshot/update handling.

---

## Phase 4 — Unit tests to ~100%

Fill remaining gaps, edge-case heavy. Run `pnpm test:coverage`, sort by
uncovered lines, iterate. Known targets beyond what Phases 2–3 reach:

- [ ] `fuzzy.ts` — scoring ties, empty query, case boundaries, very long
      paths, non-ASCII (extend existing).
- [ ] `treeSort.ts` — dirs-first, locale/numeric ordering, hidden files
      (extend existing).
- [ ] `tabs.ts` / `history.ts` / `documents.ts` — exhaustive edge cases:
      close-active-tab successor rules, history truncation on new jump,
      duplicate suppression, unsaved-changes interactions (extend existing).
- [ ] `languages.ts` — every extension mapping, unknown extension fallback.
- [ ] `editorKeymap.ts` — each binding dispatches the right command.
- [ ] `editorTheme.ts` — sanity (exports valid extension).
- [ ] `lineHighlight.ts`, `ruby/rubyHighlight.ts` — boundary cases (extend).
- [ ] `fuzzyWorker.ts` / `treeSortWorker.ts` — message protocol (run worker
      module body with a stubbed `self`, or extract logic — already mostly in
      `fuzzy.ts`/`treeSort.ts`).
- [ ] main `git.ts` parsing — exotic porcelain lines: renames with arrows in
      names, quoted paths, submodules, detached HEAD.
- [ ] main `schema.ts` — defaults with commas, multi-column indexes,
      `t.index` vs `add_index` forms, malformed schema.
- [ ] main `state.ts` — concurrent writes, atomicity (write-then-rename if
      implemented), migration of older shapes.
- [ ] main `procStats.ts` — ps output parsing edge cases.
- [ ] `shared/types.ts` helpers — `defaultWorkspaceState` invariants.

**Coverage thresholds** (ratchet, never lower):
- [x] Start: record baseline after Phase 0: **23.4% lines / 19.3% branches** (2026-06-12).
- [ ] After Phase 2: `src/main/**` ≥ 90% lines/branches.
- [ ] After Phase 3: `src/renderer/src/*.ts` (non-component logic) ≥ 90%.
- [ ] After Phase 4: global ≥ 90%, logic modules ≥ 95–100%. Components are
      covered primarily via Phase 3; accept somewhat lower branch coverage
      there only with justification (e.g. defensive rendering branches).
- [ ] Enforce thresholds in `vitest.config.ts` so CI fails on regression.

What we deliberately do NOT count toward coverage: `src/main/index.ts`
bootstrap, `main.tsx`, `env.d.ts`, asset/wasm files, `App.tsx` shell-only
wiring — keep this exclusion list short and documented in the config.

---

## Suggested execution order

1. Phase 0 (infrastructure) — everything else depends on it.
2. Phase 2 (main integration) — cheapest wins, hardens the contract the rest
   of the app sits on.
3. Phase 1 (E2E) — locks the main flows early while the rest proceeds.
4. Phase 3 (renderer integration) — the bulk of the work.
5. Phase 4 (units + coverage ratchet) — iterate until thresholds hold.

## Commands (once Phase 0 lands)

```bash
pnpm test                 # vitest, unit + integration
pnpm test:coverage        # same + coverage report (HTML in coverage/)
pnpm test:e2e             # playwright electron suite (builds first)
```
