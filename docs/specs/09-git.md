# Spec 09 — Git Integration

Status-display only. There is deliberately **no** commit/stage/diff/blame UI
in phase 1.

## What is shown

1. **Title bar branch indicator** (spec 02): branch icon + current branch
   name. When HEAD is detached, show the short SHA. When the repo is in a
   special state, append its label in the warning color:
   `Rebasing`, `Merging`, `Cherry-picking`, `Reverting`.
2. **File status colors** in the file tree (spec 07) and editor tabs:
   per-file status → color (spec 13 palette):
   - modified / renamed → blue
   - added → green
   - untracked → grey-green
   - deleted → red
   - conflicted → red
   - ignored → orange-dim
   Clean files use the normal foreground. Folders get a "dirty descendant"
   dot.

## Data collection (main process)

- Use the **git CLI**, never a JS git implementation.
- **Branch/state**: read `.git/HEAD` (+ presence of `rebase-merge/`,
  `rebase-apply/`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`) — cheap
  file reads, no subprocess.
- **File statuses**: `git status --porcelain=v1 -z --untracked-files=all`,
  parsed to a `path → status` map containing only non-clean files.

## Refresh strategy (performance-critical on big repos)

- Initial: branch immediately at workspace open (file reads); full status
  scan **deferred** until after the tree has rendered.
- File watcher events:
  - Change under `.git/` (HEAD, index, refs) or to any `.gitignore` →
    **full** status rescan.
  - Ordinary file changes → batched (debounce **500ms**) **targeted**
    rescan: `git status --porcelain=v1 -z -- <paths…>`, merged into the
    cached map (a path missing from the result reverts to clean).
- Status results are pushed to the renderer as **diffs**
  (`{path: status|null}`) — never re-send the full map after the first
  scan.
- All git work must be invisible: never block the UI, never delay tree
  rendering, never spin the CPU on watcher storms (the debounce + targeted
  rescan handle `git checkout` of large branches; a checkout that touches
  10k files triggers one full rescan via the `.git/HEAD` rule, not 10k
  targeted ones — full-rescan requests supersede pending targeted ones).
- Non-git workspace: no branch shown, no colors, zero git subprocesses
  after the initial detection.

## Acceptance checklist

- [ ] Branch + state shown; updates within ~1s of `git checkout`/rebase.
- [ ] Edit a file → its tree row turns blue ≤1s later, no UI hitch.
- [ ] `git checkout` switching 5k files on factorial: one full rescan, UI
      stays responsive.
- [ ] Diff-based updates verified (no full-map traffic in steady state).
