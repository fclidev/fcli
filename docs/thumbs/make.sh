#!/usr/bin/env bash
# One command: regenerate every thumbnail and verify it against the site's mark.
#
#   ./make.sh              build + render + verify
#   ./make.sh --clean      same, from a scratch directory first
#
# Exits non-zero if any glyph drifts from docs/assets/favicon.svg, if any
# thumbnail runs off its canvas, or if the verifier itself stops discriminating.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--clean" ]; then
  rm -rf thumbs __pycache__ .check.html .check_ref.png .render .neg.html .neg.png
  rm -f _*.png _*.html _*.svg
fi

command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }
python3 -c "import PIL" 2>/dev/null || {
  echo "Pillow required:  python3 -m pip install pillow" >&2; exit 1; }
command -v chromium >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1 || {
  echo "chromium required (librsvg/Inkscape resolve the font stack differently" >&2
  echo "and draw a different glyph -- see README.md)" >&2; exit 1; }

echo "generate"
python3 generate.py thumbs >/dev/null
echo "render"
./render_all.sh thumbs >/dev/null
echo "verify glyphs against docs/assets/favicon.svg"
python3 check_glyph.py thumbs
echo "verify the verifier still catches regressions"
python3 check_glyph_negative.py | tail -1

rm -rf __pycache__ .check.html .check_ref.png .render .neg.html .neg.png
rm -f _*.png _*.html _*.svg
echo

# The PNGs are committed, so say whether this run reproduced the committed bytes.
# A mismatch is expected after a Chromium upgrade (the font stack resolves per
# renderer); check_glyph.py above is the correctness gate, this is just drift.
if [ -f SHA256SUMS ]; then
  if (cd thumbs && sha256sum -c ../SHA256SUMS --quiet 2>/dev/null); then
    echo "ok — byte-identical to the committed SHA256SUMS"
  else
    echo "note — output differs from SHA256SUMS. If this was a Chromium upgrade"
    echo "       that is expected; refresh with:"
    echo "         (cd thumbs && sha256sum *.png *.svg > ../SHA256SUMS.new)"
    echo "       (keeping the header), then commit both."
  fi
fi
echo
echo "ok — thumbnails in ./thumbs"
