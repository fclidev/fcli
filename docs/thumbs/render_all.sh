#!/usr/bin/env bash
# Render the thumbnail SVGs to PNGs at their declared size using headless
# Chromium. Chromium, not rsvg/inkscape: the favicon font stack
# (`ui-monospace, "SF Mono", ...`) only resolves the way fcli.dev resolves it in
# a real browser, and librsvg picks a different monospace, which changes the
# glyph's shape (measured: ink width 0.32em vs 0.20em of the tile).
set -euo pipefail
out="${1:-thumbs}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$here/.render"
mkdir -p "$tmp"

command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1 || {
  echo "need chromium or google-chrome on PATH" >&2; exit 1;
}
browser="$(command -v chromium || command -v google-chrome)"

shopt -s nullglob
for svg in "$out"/*.svg; do
  base="$(basename "$svg" .svg)"
  w=$(sed -n 's/.*<svg[^>]*width="\([0-9]*\)".*/\1/p' "$svg" | head -1)
  h=$(sed -n 's/.*<svg[^>]*height="\([0-9]*\)".*/\1/p' "$svg" | head -1)
  [ -n "$w" ] && [ -n "$h" ] || { echo "no width/height on $svg" >&2; exit 1; }
  {
    printf '<!doctype html><meta charset="utf-8">'
    printf '<style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style>'
    cat "$svg"
  } > "$tmp/page.html"
  "$browser" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$w,$h" \
    --screenshot="$out/$base.png" "file://$tmp/page.html" >/dev/null 2>&1
  printf '%-36s %sx%s\n' "$base.png" "$w" "$h"
done
