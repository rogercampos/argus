# Argus — Code Review

Review date: 2026-06-13. Review-only findings from an exhaustive pass over the
main process, preload, and renderer. Verified empirically where noted (git `-z`
rename token order is correct; LSP `initialize` has no timeout; the LSP restart
counter never resets).

Overall this is a well-architected, disciplined codebase. The main/renderer
split is clean, the performance rules from `TECH_STACK.md` are upheld in code
(single-flight git/relist, worker-offloaded sort/fuzzy, virtualized tree,
debounced diagnostics), and the pure-logic modules (`tabs.ts`, `history.ts`,
`fuzzy.ts`, `parsePorcelain`) are testable and tested. Findings are mostly edge
cases and robustness gaps, not structural problems.

## High-impact

> Both high-impact items below were **fixed on 2026-06-13**. See the resolution
> notes under each.

### 1. LSP `initialize()` has no timeout → a hung server silently kills all LSP features ✅ FIXED
`src/main/lsp/client.ts:88` awaits `connection.sendRequest('initialize', …)`
with no timeout. `startInstance` stores this promise in `this.instances`
(`manager.ts:137`), and every subsequent `instancesForFile` → `ensureInstance`
does `await existing` (`manager.ts:131`). If a server spawns but never answers
`initialize` (mis-set version managers, a wedged tsserver, etc.) the promise
never settles:

- no `exit`/`error` fires, so `onExit` never runs and `MAX_RESTARTS` never
  engages — the server can't recover;
- hover/definition/completion/didOpen/didChange for that language all await a
  promise that never resolves.

Fix: race `initialize()` against a timeout and treat a timeout as a failed
start (kill the child, bump `restarts`).

**Resolution:** `client.ts` now wraps the `initialize` request in a
`withTimeout` helper (default 15s, overridable via `initializeTimeoutMs` for
tests). On timeout (or any handshake failure) the instance kills its child
process and rejects, so `startInstance`'s catch records the failed attempt and
the manager can retry/disable instead of awaiting forever. Covered by
`src/main/lsp/client.test.ts`.

### 2. LSP restart counter only increments, never resets ✅ FIXED
`src/main/lsp/manager.ts:127,187,213` — once `restarts[key] >= 3` that server is
dead for the entire window lifetime. Three transient early failures (first-run
gem/npm install still warming, a one-off OOM) permanently disable the language.
Fix: reset the counter on a successful initialize, or use a sliding window /
backoff instead of a hard lifetime cap.

**Resolution:** `manager.ts` now tracks failure *timestamps* per server key in a
60s sliding window (`restartCount`/`noteRestart`). A server is only disabled
when it fails `MAX_RESTARTS` times *within the window*; older failures age out,
so transient early crashes no longer disable a language for the whole session,
while a genuine crash-loop still trips the cap. A per-attempt `counted` guard
ensures a crash during the handshake (which fires both `onExit` and the catch)
is charged only once. Reset-on-success was deliberately avoided — it would let a
server that crashes immediately after a successful handshake restart forever.

## Medium

> Items #3, #4, and #5 were **fixed on 2026-06-13**. #6 is intentionally left as
> designed (external changes always overwrite the editor buffer). See notes.

### 3. `replaceAll` re-matches with JS RegExp but searched with ripgrep (Rust regex) ✅ FIXED
`src/main/search.ts:201-203`. Matches are found by ripgrep, then replacement
re-derives matches with `new RegExp(source, flags)`. In regex mode:
- `new RegExp(pattern)` is built outside the per-file `try` (line 203) — a
  pattern valid in Rust-regex but invalid in JS throws and rejects the whole
  `replaceAll`.
- JS vs Rust regex semantics differ, so rg-reported matches may not be replaced
  (silent under-count; reported "X replaced" is wrong) or extra lines get
  rewritten.

Also `wholeWord` uses `\b…\b` (line 202), not identical to rg's `--word-regexp`.
Fixed-string mode is fine. At minimum guard the `new RegExp` and surface
invalid-pattern errors.

**Resolution:** `replaceAll` no longer re-implements matching. It runs ripgrep
with `-r` and `--json`, which makes ripgrep compute each replacement with the
*same* engine that matched (capture groups included), and reports per-submatch
`absolute_offset`/byte ranges plus the resolved `replacement.text`. Each file is
then rewritten by byte-splicing those ranges into the `Buffer`, so multi-byte
UTF-8 is handled correctly and there is no JS-vs-Rust regex divergence and no
`new RegExp` that can throw. In literal (non-regex) mode `$` is escaped to `$$`
so it stays literal. Covered by new tests in `search.test.ts` (literal `$`,
multi-byte UTF-8, missing trailing newline, and the error path).

### 4. ripgrep stderr is discarded → invalid pattern looks like "no results" ✅ FIXED
`src/main/search.ts:69` uses `stdio: ['ignore','pipe','ignore']`; a non-zero rg
exit (bad regex) produces an empty, "done" result. The user can't distinguish a
malformed pattern from a genuine no-match. Capture stderr and propagate an error
flag in `SearchProgress`.

**Resolution:** `runSearch` now pipes stderr and inspects the exit code (0 =
matches, 1 = no matches, anything else = error) and sets `SearchProgress.error`
on the final batch. `replaceAll` returns `{ error }` and does nothing on a bad
pattern. The search modal and the search panel render the error in red instead
of "No results", and Replace All shows "Replace failed: …".

### 5. `~` expansion in Go-to-File guesses the home dir from the workspace path ✅ FIXED
`src/renderer/src/components/GoToFileModal.tsx:57`:
`root.split('/').slice(0, 3).join('/')` only yields the real home when the
workspace lives under `/Users/<name>`. The main process already knows the real
home (`process.env.HOME`, used in `menu.ts:28`) — expose it via `windowInit` or
IPC rather than reconstructing it renderer-side.

**Resolution:** `WindowInitData` now carries `homeDir`, populated by the preload
from `process.env.HOME` (falling back to `USERPROFILE`). Go-to-File expands `~`
using that real home instead of slicing the workspace path.

### 6. External-change reload can clobber unsaved edits — WON'T FIX (by design)
`src/renderer/src/documents.ts:149-180` — "external wins" applies even when the
doc is `dirty`. Per the maintainer this is intended: external changes should
always overwrite whatever is in the editor. Left as-is deliberately.

## Low / robustness

> Items #7, #8, and #9 were **fixed on 2026-06-13**. #10 was partially addressed
> (the two cheap, high-value parts); the remaining parts are intentional. See
> notes under each.

### 7. Session state may not flush on quit ✅ FIXED
`src/main/index.ts:59-62`: `before-quit` does `void persistAppState()` (async)
without `preventDefault()`/await, so the app can exit before the write lands.
Debounced saves cover most cases, but a change in the final ~2s before quit can
be lost. Persist synchronously here, or use `preventDefault` → await →
`app.exit()`.

**Resolution:** `before-quit` now `preventDefault()`s on the first pass, awaits
`persistAppState()`, then re-issues `app.quit()` (a guarded flag prevents a
loop). The second pass runs normally, so window-close cleanup (LSP servers,
watchers, ripgrep) still happens — unlike `app.exit()`, which would skip it.

### 8. Modal search has no generation token → stale rows during fast typing ✅ FIXED
`src/renderer/src/searchStore.ts:160-172` keys all modal results on
`MODAL_SEARCH_ID = 0`. In-flight `search:progress` events from a superseded
query get appended to the new (reset) result set. Add a per-query epoch and drop
non-matching progress.

**Resolution:** each modal query now takes a fresh, unique id counting down from
0 (`-1, -2, …`), tracked in `modalSearchId`; tab ids stay `≥ 1`, so `searchId <=
0` still identifies modal progress. The progress handler drops any modal batch
whose id ≠ the current `modalSearchId`, and `openModal`/`runModalSearch` cancel
the prior id and bump to a new one. Covered by a new `searchStore.test.ts` case.

### 9. Git monitor debounce can starve under a continuous event stream ✅ FIXED
`src/main/git.ts:134-135`: every `noteChanges` batch resets the 500ms timer. A
sustained event stream (a build, a large checkout) keeps resetting it and the
flush never fires until the storm ends. Add a max-wait cap.

**Resolution:** `noteChanges` now tracks when the oldest un-flushed change
arrived and caps the wait via `debounceWait()` (pure, unit-tested) at a 2s
deadline — a continuous stream still flushes at least every ~2s instead of never.

### 10. Arbitrary-path file IPC + weakened isolation ◑ PARTIALLY FIXED
`file:read-abs` / `file:write-abs` (`ipc.ts:183-185`, `repo.ts:163,179`) accept
any absolute path with no containment check; `repo:*`/`file:*` trust a `root`
arg from the renderer instead of `eventWorkspace(event)`; `electronAPI` is
exposed wholesale (`preload/index.ts:108`); windows run with `sandbox: false`
(`windows.ts:96`). Threat model is limited (renderer never executes repo
content), but deriving `root` from the window and narrowing the exposed
`electron` object would be cheap defense-in-depth.

**Resolution (partial):**
- `repo:list-files` / `repo:list-top-level` / `repo:git-status` / `file:read` /
  `file:write` now derive the root from `eventWorkspace(event)` and ignore the
  renderer-supplied path, so a window can only read/list inside the folder it
  owns.
- The broad `electronAPI` is no longer bridged to the renderer (it was unused);
  only the typed `api` is exposed, and the `window.electron` global was removed.
- Left as designed: `file:read-abs`/`file:write-abs` still take absolute paths —
  that is the mechanism for opening external files (go-to-definition into gems /
  node_modules outside the repo). `sandbox: false` is required by the preload's
  Node usage and is unchanged.

## Cleanups / minor

All items below were addressed on 2026-06-13 (one commit each).

- ✅ **`replaceAll` dead branch** (`search.ts:224-227`): both arms of the
  `typeof replaceWith === 'string'` ternary were identical. Already removed when
  `replaceAll` was rewritten for #3 (it no longer uses a JS RegExp at all).
- **semgrep duplicated parse** (`semgrep.ts:82-99` vs `107-126`): success and
  catch paths duplicate the whole parse/map block and parse `stdout` twice.
  Extract a `parseReport(stdout)` helper. The single `this.queue` chain also
  serializes scans across all files globally, not per-file.
- **fuzzy empty-query cost** (`fuzzy.ts:86-87`): `recents.filter(p =>
  paths.includes(p))` is O(recents × paths); use `new Set(paths)`. The full
  `[...paths].sort()` on every empty query (100k items) could be precomputed.
- **`binaryOnPath` uses `F_OK`** (`servers.ts:63`): a non-executable file on
  PATH would be selected; use `fs.constants.X_OK`.
- **Per-file view-state files leak** (`state.ts:126`):
  `workspaces/<hash>/files/<filehash>.json` are never GC'd when the repo file is
  deleted.
- **`window-all-closed` always quits** (`index.ts:64`): non-standard on macOS;
  makes the `activate` handler (`index.ts:53`) unreachable. Confirm intent.
- **Side-effect during render** (`Sidebar.tsx:193`): `starredRef.current = new
  Set(...)` mutates a module ref in the render body; move into an effect/memo.
- **EditorPane 5s polling safety-net** (`EditorPane.tsx:102-115`): likely dead
  code since `noteViewUpdate` keeps `doc.state` authoritative; drop it or find
  the desync it papers over.
- **`projectForFile` / `ancestorWithKind` prefix checks** (`projects.ts:57,109`):
  `dir.startsWith(workspaceRoot)` matches `/foo/bar-baz` against `/foo/bar`.
  Harmless at current call sites but latent; compare against `workspaceRoot +
  sep`.
