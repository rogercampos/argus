#!/usr/bin/env bash
# Pull the latest code, rebuild, and install the app into /Applications.
#
# Usage:
#   scripts/install-macos.sh            # pull, build, install, relaunch
#   scripts/install-macos.sh --no-pull  # build what's in the working tree
#   scripts/install-macos.sh --no-open  # install but don't relaunch
#
# Your data (sessions, recents, keymap) lives in ~/Library/Application Support
# and survives reinstalls.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="argus"
TARGET="/Applications/$APP_NAME.app"

# node_modules is laid out by pnpm 10; a newer global pnpm wants to wipe and
# reinstall it, so always run the pinned version.
PNPM=(npx -y pnpm@10.29.2)

PULL=1
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-open) OPEN=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only. Use 'pnpm build:linux' instead." >&2
  exit 1
fi

if [[ $PULL -eq 1 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty — commit, stash, or rerun with --no-pull." >&2
    exit 1
  fi
  LOCK_BEFORE="$(shasum pnpm-lock.yaml | cut -d' ' -f1)"
  echo "→ Fetching latest changes…"
  git pull --ff-only
  if [[ "$(shasum pnpm-lock.yaml | cut -d' ' -f1)" != "$LOCK_BEFORE" ]]; then
    echo "→ Dependencies changed, reinstalling…"
    CI=true "${PNPM[@]}" install --frozen-lockfile
  fi
elif [[ ! -d node_modules ]]; then
  CI=true "${PNPM[@]}" install --frozen-lockfile
fi

echo "→ Building…"
"${PNPM[@]}" build:unpack

BUILT="$(find dist -maxdepth 2 -name "$APP_NAME.app" -type d | head -n1)"
if [[ -z "$BUILT" ]]; then
  echo "Build finished but no $APP_NAME.app found under dist/." >&2
  exit 1
fi

if pgrep -f "$TARGET/Contents/MacOS/" >/dev/null 2>&1; then
  echo "→ Quitting the running app…"
  osascript -e "quit app \"$APP_NAME\"" || true
  # Give the main process time to save open windows/tabs before we overwrite it.
  for _ in {1..20}; do
    pgrep -f "$TARGET/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.25
  done
fi

echo "→ Installing to ${TARGET}…"
rm -rf "$TARGET"
cp -R "$BUILT" "$TARGET"

# electron-builder skips signing (no Developer ID certificate), but macOS
# refuses to launch unsigned arm64 binaries at all — an ad-hoc signature is
# the minimum.
codesign --force --deep --sign - "$TARGET" 2>/dev/null

xattr -cr "$TARGET"

echo "✓ Installed $APP_NAME ($(git rev-parse --short HEAD))"

if [[ $OPEN -eq 1 ]]; then
  open -a "$TARGET"
fi
