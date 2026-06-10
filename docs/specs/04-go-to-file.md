# Spec 04 — ⭐ Go to File (Cmd+Shift+O)

RubyMine's "Go to File", tuned to be instant on ~100k-file repos.

## Index

- The candidate set is **all workspace files**: the same listing the file
  tree uses (`git ls-files --cached --others --exclude-standard`, falling
  back to a pruned walk; see TECH_STACK.md), minus the `excludedPaths`
  setting (spec 07).
- The list is fetched once per workspace open, held in memory in the
  renderer-side feature (or main process — implementation's choice), and
  refreshed by the file watcher (debounced; a stale index for a few hundred
  ms is acceptable).

## Modal

- Floating modal (pattern in spec 05). Initial size: width ≈ 800px, height ≈
  75% of the window height. Min 300×200. Resizable; size remembered for the
  session.
- Contents: a single-line input on top, a virtualized results list below
  (row height 25px), optional truncation notice at the bottom.
- No preview pane — speed and density win (matches RubyMine and the
  sourcedelve implementation).

### Input behavior

- On open: the input contains the **previous query**, fully selected — so
  typing replaces it, but Enter immediately reuses it (RubyMine behavior:
  reopening with the same query is a frequent flow).
- Matching is **case-insensitive fuzzy** matching tuned for paths
  (filename-heavy scoring): a match on the basename scores higher than the
  same match spread across directories; consecutive runs and
  word-boundary/CamelCase hits score higher. Order: score desc, then path
  asc. (Reference algorithm: nucleo's `match_paths` config; an fzf-style
  scorer with a basename bonus is acceptable.)
- Query is matched against the **workspace-relative path** (not just the
  filename).
- **Absolute paths**: if the query starts with `/`, `~/`, or is exactly `~`,
  treat it as a filesystem path: expand `~`, and
  - if the path is inside the workspace → convert to workspace-relative and
    fuzzy-match normally;
  - if outside the workspace → offer that exact file as the single result
    (if it exists); opening it opens an **external file** (spec 06).
- Empty query: show the full list ordered by recency (recently opened files
  first, then the rest alphabetically).

### Filtering performance

- Filtering must happen off the UI thread (worker) for 100k+ entries; only
  the newest query result is applied (drop stale results).
- Display cap: **200** results, with a footer notice "Showing first 200
  results — refine your search".

### Result rows

`[file icon] [filename with matched characters highlighted]   [dimmed parent
directory, right-aligned]`. The directory is workspace-relative (or absolute
for external files), with `~` substitution.

### Keyboard & mouse

| Key | Action |
| --- | --- |
| Up / Down | move selection (wraps) |
| Enter | open the selected file in the editor area; close modal |
| Esc | close modal, restore previous focus |
| click | open the clicked file; close modal |

### Opening semantics

- Opens in the active editor pane. If the file is already open in a tab,
  focus that tab (and apply the "move next to current" rule, spec 06).
- The jump is recorded in jump history (spec 05).

## Non-goals

- No "include non-project items" toggle in phase 1.

## Acceptance checklist

- [ ] Open on factorial: modal appears instantly; typing filters with no
      perceptible lag; first keystroke < 50ms to filtered list.
- [ ] Previous query restored selected; Enter reuses it.
- [ ] `~/code/factorial/Gemfile` style absolute queries resolve.
- [ ] 200-cap notice shows on broad queries.
- [ ] Fuzzy quality: `usrmod` finds `app/models/user.rb` near the top in a
      Rails repo.
