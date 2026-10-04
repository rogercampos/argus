# Argus

A desktop code editor built on Electron, designed to stay fast on very large
repositories (~100k files).

Stack and architecture decisions are documented in
[docs/TECH_STACK.md](docs/TECH_STACK.md).

## Development

```bash
pnpm install
pnpm dev                              # run the app with HMR
ARGUS_OPEN=~/code/some-repo pnpm dev  # auto-open a folder on startup
```

## Checks

```bash
pnpm typecheck
pnpm lint      # biome check
pnpm format    # biome format --write
pnpm test      # vitest
```

## Packaging

```bash
pnpm build:mac    # also: build:win, build:linux
```

## Installing on macOS

```bash
pnpm install:mac
```

Pulls the latest `main`, reinstalls dependencies if the lockfile moved,
builds, copies the app to `/Applications/argus.app`, and relaunches it.

| Option      | Effect                                    |
| ----------- | ----------------------------------------- |
| `--no-pull` | Build what's in the working tree as-is    |
| `--no-open` | Install but don't relaunch the app        |

Pass them after `--`, e.g. `pnpm install:mac -- --no-pull`.

- The script refuses to pull over a dirty working tree. Commit, stash, or
  use `--no-pull`.
- If Argus is running it gets quit first, so open windows are saved and
  restored on relaunch.
- The build isn't signed with a Developer ID; the script applies an ad-hoc
  signature, which is enough to run it on this machine.

### Command line

The app has no shell command of its own; add these to `~/.zshrc`:

```zsh
# argus [folder]      open a folder as a workspace (default: current directory)
argus() { ( /Applications/argus.app/Contents/MacOS/argus "${${1:-.}:A}" &>/dev/null & ) }

# argus-diff [target] review a diff of the repo you're in:
#   (none) uncommitted · staged · HEAD~1 · main... · '#123' or a PR URL
argus-diff() { ( /Applications/argus.app/Contents/MacOS/argus "--diff=$1" "$PWD" &>/dev/null & ) }
```

## Dev scripts

- `scripts/bench-factorial.mjs <repo>` — times file listing + tree preparation
  against a real repository.
- `scripts/cdp-*.mjs` — drive a running dev instance over the Chrome DevTools
  Protocol (launch with `pnpm dev -- -- --remote-debugging-port=9222`):
  screenshots, evaluating expressions, opening files.
