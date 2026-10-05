#!/usr/bin/env bash
# Render every icon/logo asset from the SVG sources in resources/brand/.
#
# Requires (macOS): rsvg-convert and magick (brew install librsvg imagemagick);
# iconutil ships with Xcode command line tools.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="$ROOT/resources/brand"
ICON_SVG="$BRAND/argus-icon.svg"
MARK_SVG="$BRAND/argus-mark.svg"

render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# Standalone PNGs, up to a 4096px poster-size version
mkdir -p "$BRAND/png"
for size in 16 32 64 128 256 512 1024 2048 4096; do
  render "$ICON_SVG" "$size" "$BRAND/png/argus-icon-$size.png"
done
for size in 256 1024 4096; do
  render "$MARK_SVG" "$size" "$BRAND/png/argus-mark-$size.png"
done

# macOS .icns (packaged app icon)
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  render "$ICON_SVG" "$size" "$ICONSET/icon_${size}x${size}.png"
  render "$ICON_SVG" "$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$ROOT/build/icon.icns"

# Windows .ico
magick "$BRAND/png/argus-icon-"{16,32,64,128,256}.png "$ROOT/build/icon.ico"

# Linux build icon + runtime window/dock icon
cp "$BRAND/png/argus-icon-1024.png" "$ROOT/build/icon.png"
cp "$BRAND/png/argus-icon-512.png" "$ROOT/resources/icon.png"

echo "✓ Icons generated"
