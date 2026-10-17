# Thumbnails

`f` marks for social cards, derived from `../assets/favicon.svg` and the palette
in `../assets/style.css`. Nothing here is committed to the site: `build.js` and
`check.js` read only `content/` and `assets/`, so this folder never reaches
`dist/` and cannot break a deploy.

| design | what it is |
|---|---|
| `f-tile` | the favicon scaled up, nothing else |
| `fcli-wordmark` | tile + `fcli` brand + tagline, at the site's own type ratios |
| `f-terminal` | a mock `f help` session in window chrome |

Each in three sizes: 1200x630 (Open Graph), 1280x640 (GitHub social card, needs
>= 1280x640), 1024x1024.

## Replicating them

```sh
python3 -m pip install pillow     # the only third-party dependency
./make.sh                         # generate + render + verify, in one go
```

`./make.sh --clean` does the same from a scratch directory. Requires Chromium and
Python 3. Verified with Chromium 154.0.8037.97, Python 3.14.8, Pillow 12.3.0.
Both `chromium` and `google-chrome` are accepted names.

Step by step, if you want the stages separately:

```sh
python3 generate.py thumbs           # writes 9 SVGs
./render_all.sh thumbs               # SVG -> PNG at each file's declared width/height
python3 check_glyph.py thumbs        # every tile vs the site favicon, same size
python3 check_glyph_negative.py      # proves that check can actually fail
```

The rendered PNGs **are** committed, so the social cards are visible on GitHub
without running anything. They are renderer-specific (see below): treat `make.sh`
as the way to refresh them, and regenerate on any machine whose Chromium differs
from the one recorded in `SHA256SUMS`.

## Why Chromium and not librsvg or Inkscape

This is the single easiest way to get a wrong result silently.

The favicon's stack is `ui-monospace, monospace`. Each renderer resolves
`ui-monospace` differently — librsvg lands on a narrow face where the glyph is
0.20 of the tile width, Chromium on Noto Sans Mono where it is 0.32. Both
"succeed"; the marks are visibly different shapes. `render_all.sh` and
`check_glyph.py` therefore both drive headless Chromium, which is what fcli.dev
itself draws with.

## Verification

**`check_glyph.py`** renders the untouched `../assets/favicon.svg` and each
thumbnail's tile at the *identical* pixel size, then compares the two glyphs:
ink width, height, horizontal centring, the gaps above and below, and the peak
pixel colour.

Same-size comparison is mandatory; a tolerance table cannot work. Measured on the
original favicon alone, the glyph's width fraction is 0.312 at a 64px tile and
0.320 at 1024px, and its ink centre drifts 0.633 → 0.522 over that range. Raster
quantization dominates at small sizes, so any fixed tolerance either waves
through real defects at one size or fails correct art at another.

**`check_glyph_negative.py`** is the control on the control. It injects seven
changes into a correct thumbnail and requires the check to accept exactly one:
unmodified, truncated font stack, sans fallback, nudged baseline, resized glyph,
recoloured accent, off-centre glyph. If it ever prints `NOT CAUGHT`, the check
has gone blind to that failure mode.

That last case is load-bearing history. The check originally verified geometry
only, and a recoloured glyph has a byte-identical ink box — it passed. `compare()`
now inspects the peak pixel too.

## Layout is measured from pixels, not estimated

`generate.py` obtains font advances and side bearings by rendering strings and
measuring the ink (`measure_advance`, `ink_box`), then asserts nothing leaves the
canvas (`_ink_box_of`).

Font tables are unusable for this. `hmtx` reports a 0.600em advance for *both*
weights of Noto Sans Mono, but the bold `f`'s ink is only 0.510em, and sans `c`
ink begins 0.048em inside its own advance. Placing `cli` at the `f`'s ink edge
instead of advancing a full mono cell overlapped the two `<text>` runs by 43px —
undetectable in the SVG source, and the glyph metrics were all "correct".

Two related traps, both hit while building this:

- **Escape quotes in SVG attributes.** The CSS stack contains `"SF Mono"` etc.
  Interpolated raw into `font-family="…"` the first inner quote closes the
  attribute, so Chromium sees `font-family="ui-monospace, "`, falls back to
  proportional sans, and renders an `f` a third too narrow. The site's own
  `style.css` is fine — CSS permits double quotes in a property value. Hence the
  `&quot;` escaping and a guard in `generate.py`.
- **Centre on ink, not on font size.** `.brand` at 1.35rem is *larger* than the
  tile it sits beside, so centring the block with `h/2 - tag_fs*0.7` pushed the
  wordmark flush to the top edge (margin 0) and left the square at 170px above
  against 298px below. Vertical centring now measures the rendered ink box and
  re-centres on it.

## Two quirks of the original that are reproduced on purpose

- **The glyph is not centred.** `text-anchor="middle"` centres the 0.6em
  *advance* on `x=32`, but the bold `f`'s ink is 0.51em sitting 0.068em inside
  that cell, so the ink lands ~0.9 units right of the tile centre. The thumbnails
  inherit this rather than "fixing" it, so they sit flush with fcli.dev. Centring
  the ink would be a visible difference from the site.
- **The tile is invisible.** Its fill is `#14171a`, which is both `--bg` and
  `--code-bg`. On a banner of the same colour only the `f` reads. That matches
  the site exactly; a visible tile means deliberately changing the background.

## Colours

From `style.css`, dark scheme: tile `#14171a` (`--bg`/`--code-bg`), glyph
`#58c9a0` (`--accent`), ink `#e6e8ea`, faint `#8b939c`, rule `#2a2f35`, panel
`#1a1e22`, code background `#0d1013`.

## Files

| file | role |
|---|---|
| `make.sh` | one command: generate, render, verify |
| `generate.py` | the three designs; also holds the measurement + fit guards |
| `render_all.sh` | SVG → PNG via headless Chromium |
| `check_glyph.py` | glyph A/B against `../assets/favicon.svg` |
| `check_glyph_negative.py` | negative control on that check |
| `thumbs/` | output — committed, 9 SVG + 9 PNG |
| `SHA256SUMS` | checksums of the committed output, with the Chromium build that produced them |
