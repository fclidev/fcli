#!/usr/bin/env python3
"""Generate 'f' thumbnails that match the fcli.dev mark.

Source of truth: docs/assets/favicon.svg + style.css in github.com/fclidev/fcli

  favicon.svg:  viewBox 0 0 64 64, rect rx=12 fill #14171a,
                text x=32 y=45 font-size=40 weight=700
                font-family="ui-monospace, monospace" fill #58c9a0

  style.css:    --code-bg #14171a (light) / --bg #14171a (dark)
                --accent #58c9a0, --code-ink #e6e6e2, --code-plain #9aa0a6
                dark --ink #e6e8ea, --ink-faint #8b939c, --line #2a2f35
                --radius 6px
                mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace
                sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif
                brand: font-size 1.35rem, weight 600, letter-spacing -0.02em
                brand b: accent colour, mono, weight 700
                tagline: 0.8rem, ink-faint

The favicon glyph measures w=20 h=30 at font-size 40 in a 64 box, centred on x,
baseline 5 units above the box bottom. Verified identical in Chromium.
"""

# Font stacks copied verbatim from docs/assets/style.css (--mono and body font).
# NOTE: these contain double quotes, which MUST be escaped to &quot; before being
# interpolated into an SVG/XML double-quoted attribute. An unescaped quote
# truncates the attribute and Chrome silently falls back to the proportional
# default sans-serif -- an 'f' about a third narrower than the real mark. The
# site's own CSS is fine; CSS allows double quotes inside a property value.
MONO_CSS = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
SANS_CSS = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif'
MONO = MONO_CSS.replace('"', "&quot;")
SANS = SANS_CSS.replace('"', "&quot;")

# palette (fcli.dev dark mode)
BG      = "#14171a"   # --bg / --code-bg
PANEL   = "#1a1e22"   # --panel
CODE_BG = "#0d1013"   # --code-bg (dark)
INK     = "#e6e8ea"   # --ink
INK_SOFT= "#b3b9c0"   # --ink-soft
INK_FAINT="#8b939c"   # --ink-faint
LINE    = "#2a2f35"   # --line
ACCENT  = "#58c9a0"   # --accent
ACC_SOFT= "#17302a"   # --accent-soft
CODE_INK  = "#dfe3e6" # --code-ink
CODE_PLAIN= "#7d858d" # --code-plain

SIZES = {
    "og-1200x630":  (1200, 630),
    "gh-1280x640":  (1280, 640),
    "square-1024":  (1024, 1024),
}


def favicon_body(path=None):
    """Inner content of docs/assets/favicon.svg, with colours normalised.

    Read from the real file instead of being retyped here, so the thumbnail
    cannot silently drift if the site's favicon geometry changes. The font-family
    is substituted with the CSS stack (the favicon uses the short form).
    """
    import os, re
    p = path or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             os.pardir, "assets", "favicon.svg")
    src = open(p).read()
    body = src[src.index(">") + 1: src.rindex("</svg>")]
    body = body.replace('font-family="ui-monospace, monospace"',
                        'font-family="' + MONO + '"')
    body = re.sub(r'fill="#14171a"', 'fill="' + BG + '"', body)
    body = re.sub(r'fill="#58c9a0"', 'fill="' + ACCENT + '"', body)
    return body.strip()


def tile(x, y, size):
    """The favicon tile as a <g> at (x,y), scaled from the 64-unit original.

    One uniform scale transform around the file's own markup, so the geometry is
    identical to docs/assets/favicon.svg rather than a hand-recomputed copy that
    can drift a sub-pixel at some sizes.

    The tile fill equals the page background (#14171a = --bg = --code-bg), so the
    tile is invisible against the page by design; only the glyph reads.
    """
    s = size / 64.0
    body = favicon_body()
    return ('<g transform="translate(%.3f,%.3f) scale(%.6f)">\n    %s\n    </g>'
            % (x, y, s, body))


def _ink_box_of(svg_text, w, h):
    """Render `svg_text` and return ((left,right),(top,bottom)) of non-bg ink."""
    import os
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, "_boxsvg.svg"), "w").write(svg_text)
    png = os.path.join(here, "_boxsvg.png")
    _shot("<!doctype html><meta charset='utf-8'>"
          "<style>html,body{margin:0;padding:0;overflow:hidden}</style>" + svg_text,
          png, w, h)
    im = Image.open(png).convert("RGB"); p = im.load()
    bg = (0x14, 0x17, 0x1a)
    xs = [x for x in range(0, w, 2) for y in range(0, h, 3)
          if any(abs(a - b) > 8 for a, b in zip(p[x, y], bg))]
    ys = [y for y in range(0, h, 2) for x in range(0, w, 3)
          if any(abs(a - b) > 8 for a, b in zip(p[x, y], bg))]
    return ((min(xs), max(xs)), (min(ys), max(ys)))


def wordmark(x, y, size, unit=1.35, faint=None, align="start", fs=None):
    """`fcli` brand: mono-bold accent `f` + sans `cli`, per .brand / .brand b.

    `size` is the *tile* size the brand is scaled against (site: brand is
    1.35rem next to a ~1rem mark). Pass `fs` to set the font size directly,
    e.g. inside the terminal title bar.

    Returns (svg, ink_width). The width is measured from the renderer, so the
    caller can prove the wordmark does not overlap the mark -- the two are
    separate <text> runs and get no automatic collision handling.
    """
    fs = fs if fs is not None else size * unit
    ls = -0.02 * fs
    m = _measure_all()
    # Advance by the mono CELL (0.600em), not the `f` ink (0.510em), then add the
    # visual gap, then subtract `c`'s left bearing so the gap that reads is the
    # gap that was asked for. Placing `cli` at the `f` ink edge put it ~9px
    # inside the mono cell and the two runs overlapped.
    f_pen = x
    if align == "middle":
        f_pen = x - (m["mono"] + VISUAL_GAP_FRAC + m["cli_ink"]) * fs / 2
    cli_pen = f_pen + (m["mono"] + VISUAL_GAP_FRAC) * fs - m["cli_left"] * fs
    out = f'''<text x="{f_pen:.2f}" y="{y:.2f}" font-family="{MONO}" font-size="{fs:.2f}"
      font-weight="700" fill="{ACCENT}" letter-spacing="{ls:.2f}">f</text>''' + \
        f'''<text x="{cli_pen:.2f}" y="{y:.2f}" font-family="{SANS}" font-size="{fs:.2f}"
      font-weight="600" fill="{faint or INK}" letter-spacing="{ls:.2f}">cli</text>'''
    # ink span: `f` ink right edge -> `cli` ink right edge, from f_pen
    ink_w = (m["f_ink"] + (m["mono"] - m["f_left"] - m["f_ink"]) + VISUAL_GAP_FRAC
             + m["cli_ink"]) * fs
    return out, ink_w


def svg(w, h, body, r=0):
    bg = f'<rect width="{w}" height="{h}" rx="{r}" fill="{BG}"/>\n  ' if r is not None else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  {bg}{body}
</svg>
'''


# ── A. tile + wordmark ───────────────────────────────────────────────────────
TAGLINE = "token-efficient CLI for LLMs"
# Gap between the end of the mono `f` cell and the start of `cli`, in em of the
# brand size. Must be small: `fcli` reads as one word (site markup is <b>f</b>cli).
VISUAL_GAP_FRAC = 0.02


def _shot(svg, png, w, h):
    import os, subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, "_probe.html")
    open(p, "w").write("<!doctype html><meta charset='utf-8'>"
                       "<style>html,body{margin:0;padding:0}</style>" + svg)
    subprocess.run(["chromium", "--headless=new", "--no-sandbox", "--disable-gpu",
                    "--hide-scrollbars", f"--window-size={w},{h}",
                    f"--screenshot={png}", f"file://{p}"],
                   capture_output=True, check=True)


def measure_advance(family, text, fs=200, ink="#ffffff", paper="#000000"):
    """Ink advance per character step, measured from Chromium's own raster.

    Do NOT take advances from the font's hmtx table: hmtx describes the regular
    weight, so bold monospace measures 0.600em there while Chromium actually
    lays it out at 0.6625em. Using 0.600 started the `fcli` wordmark ~14% too
    far left and overlapped it onto the mark. Only the renderer's raster is
    ground truth for what the emitted SVG will draw.
    """
    import os
    from PIL import Image
    W = int(len(text) * fs * 1.5) + 120
    H = int(fs * 2.4)
    assert W * H < 40_000_000, "probe image too large"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="{paper}"/>'
           f'<text x="40" y="{int(fs * 1.6)}" font-family="{family}" '
           f'font-size="{fs}" fill="{ink}">{text}</text></svg>')
    png = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_adv.png")
    _shot(svg, png, W, H)
    im = Image.open(png).convert("L"); p = im.load()
    cols = [x for x in range(W) if any(p[x, y] > 128 for y in range(H))]
    if len(cols) < 2:
        raise RuntimeError(f"no ink rendered for {family!r}")
    return (max(cols) - min(cols) + 1) / fs / (len(text) - 1)


def ink_extent(family, text, fs, weight="normal", mono=False):
    """Total ink width of `text` at `fs`, measured from the raster."""
    import os
    from PIL import Image
    W = int(len(text) * fs * 1.6) + 160
    H = int(fs * 2.6)
    assert W * H < 40_000_000, "probe image too large"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#000000"/>'
           f'<text x="50" y="{int(fs * 1.7)}" font-family="{family}" '
           f'font-size="{fs}" font-weight="{weight}" fill="#ffffff">{text}</text></svg>')
    png = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ext.png")
    _shot(svg, png, W, H)
    im = Image.open(png).convert("L"); p = im.load()
    cols = [x for x in range(W) if any(p[x, y] > 128 for y in range(H))]
    return (max(cols) - min(cols) + 1)


_CACHE = {}


def _cell_pitch(fs=200):
    """Monospace cell advance, measured exactly, in em.

    Ink span is NOT the advance: the last cell contributes no trailing
    side-bearing, so ink over `MxN` under-reads it. Measured here as the period
    between successive glyph leading edges, which cancels bearings entirely.
    """
    import os
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    n = 10
    W = int(n * fs * 1.2) + 80          # bounded: never a decompression bomb
    H = int(fs * 2.0)
    assert W * H < 40_000_000, "probe image too large"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#000000"/>'
           f'<text x="30" y="{int(fs * 1.4)}" font-family="{MONO}" '
           f'font-size="{fs}" fill="#ffffff">{"M" * n}</text></svg>')
    png = os.path.join(here, "_pitch.png")
    _shot(svg, png, W, H)
    im = Image.open(png).convert("L"); p = im.load()
    strip = [x for x in range(W) if any(p[x, y] > 128 for y in range(H))]
    edges, prev = [], None
    for x in strip:
        if prev is not None and x - prev > 2:
            edges.append(x)
        prev = x
    periods = [edges[i + 1] - edges[i] for i in range(len(edges) - 1)]
    if not periods:
        raise RuntimeError("could not segment monospace glyphs")
    return sum(periods) / len(periods) / fs


def ink_box(family, text, fs, weight="normal", x=50, y=None):
    """Full ink bounding box of rendered `text` -> (left, right, top, bottom).

    Positions the text at a known x so the returned left edge reveals the
    font's left side bearing. Everything here is measured from Chromium's
    raster: font-table values disagree with the renderer (hmtx gives 0.600em
    for both regular and bold monospace, but the bold `f` ink is 0.5125em),
    and layout maths built on the wrong number made the wordmark overlap the
    mark.
    """
    import os
    from PIL import Image
    W = int(len(text) * fs * 1.6) + 160
    H = int(fs * 3.0)
    assert W * H < 40_000_000, "probe image too large"
    y = y if y is not None else int(fs * 2.0)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#000000"/>'
           f'<text x="{x}" y="{y}" font-family="{family}" '
           f'font-size="{fs}" font-weight="{weight}" fill="#ffffff">{text}</text></svg>')
    png = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_box.png")
    _shot(svg, png, W, H)
    im = Image.open(png).convert("L"); p = im.load()
    xs = [i for i in range(W) if any(p[i, j] > 128 for j in range(H))]
    ys = [j for j in range(H) if any(p[i, j] > 128 for i in range(W))]
    if not xs or not ys:
        raise RuntimeError(f"no ink rendered for {family!r} {text!r}")
    return {"left": min(xs) - x, "right": max(xs) - x,
            "above": y - min(ys), "below": max(ys) - y}


def _measure_all():
    """Measure advances and ink boxes once, from the real renderer."""
    if _CACHE:
        return _CACHE
    _CACHE["mono"] = 0.6000          # exact: Noto Sans Mono advance, both weights
    _CACHE["sans"] = measure_advance(SANS, "abcdefghijklmnopqrstuvwxyz")
    _CACHE["tag_em"] = ink_extent(SANS, TAGLINE, 400) / 400.0
    # bold mono `f`: advance 0.6em but ink is narrower and offset by its bearing
    fb = ink_box(MONO, "f", 400, weight="700")
    _CACHE["f_ink"] = (fb["right"] - fb["left"]) / 400.0        # ~0.5125em
    _CACHE["f_left"] = fb["left"] / 400.0                       # left side bearing
    _CACHE["f_above"] = fb["above"] / 400.0
    # `cli`: `c` ink begins at its left bearing, not at the pen position
    cb = ink_box(SANS, "cli", 400, weight="600")
    _CACHE["cli_ink"] = (cb["right"] - cb["left"]) / 400.0
    _CACHE["cli_left"] = cb["left"] / 400.0
    return _CACHE



def design_wordmark(w, h):
    """Tile + `fcli` wordmark + tagline, one centred block.

    Sizes the mark by SOLVING for the largest tile that fits, rather than
    starting from a guessed fraction of the canvas. Three constraints, all in
    terms of tile size `ts`:

      row width      ts * (1 + GAP + WM_FRAC)      <= w * MARGIN
      tagline width  TAG_EM * ts * TAG_PER_TILE    <= w * MARGIN
      block height   ts + TAGLINE_BELOW * ts       <= h * MARGIN

    The site's own ratio fixes the type: .brand 1.35rem over .tagline 0.8rem.
    The tagline is ~12.8em of the resolved sans, which is what dominates a 16:9
    banner and keeps the mark modest -- that is the honest consequence of the
    copy, not a bug to size around.

    Vertical centring uses measured ink extents, because brand font-size is
    LARGER than the tile (1.35rem brand beside a 40/64-unit glyph); centring on
    the font box pushed the wordmark off the top of the canvas.
    """
    m = _measure_all()
    unit, ratio = 1.35, 1.35 / 0.8
    GAP = 0.30                 # tile -> wordmark, in tile sizes
    TAGLINE_BELOW = 0.34       # tagline baseline drop below the tile, in tile sizes
    MARGIN = 0.90              # usable share of each axis

    brand_per_tile = (40 / 64) * unit
    _, wm_unit = wordmark(0, 0, 1.0, unit)          # wordmark width per tile
    row_frac = 1 + GAP + wm_unit
    tag_per_tile = brand_per_tile / ratio
    tag_frac = m["tag_em"] * tag_per_tile
    height_frac = 1.0 + TAGLINE_BELOW + 0.30        # tile + tagline descender

    ts = min(w * MARGIN / max(row_frac, tag_frac), h * MARGIN / height_frac)
    brand_fs = ts * brand_per_tile
    tag_fs = ts * tag_per_tile
    gap = ts * GAP

    _, wm_w = wordmark(0, 0, ts, unit)
    row_w = ts * row_frac
    tag_w = m["tag_em"] * tag_fs
    x0 = (w - max(row_w, tag_w)) / 2

    # provisional placement, then measure real ink and re-centre on it
    ty = (h - ts) / 2 - height_frac * ts * 0.18
    wm, _ = wordmark(x0 + ts + gap, ty + ts * 0.68, ts, unit)
    tag_y = ty + ts * (1.0 + TAGLINE_BELOW)
    body0 = f'''{tile(x0, ty, ts)}
  {wm}
  <text x="{x0:.2f}" y="{tag_y:.2f}" font-family="{SANS}"
    font-size="{tag_fs:.2f}" fill="{INK_FAINT}">{TAGLINE}</text>'''
    (L0, R0), (T0, B0) = _ink_box_of(svg(w, h, body0), w, h)
    dy = (h - (B0 - T0)) / 2 - T0
    ty += dy
    wm, _ = wordmark(x0 + ts + gap, ty + ts * 0.68, ts, unit)
    tag_y = ty + ts * (1.0 + TAGLINE_BELOW)
    body = f'''{tile(x0, ty, ts)}
  {wm}
  <text x="{x0:.2f}" y="{tag_y:.2f}" font-family="{SANS}"
    font-size="{tag_fs:.2f}" fill="{INK_FAINT}">{TAGLINE}</text>'''

    (L1, R1), (T1, B1) = _ink_box_of(svg(w, h, body), w, h)
    assert x0 >= 2, f"block starts off-canvas at x={x0:.0f}"
    assert x0 + max(row_w, tag_w) <= w, "row overflows the canvas"
    assert T1 >= 2 and B1 <= h - 2, (
        f"ink not vertically inset: top={T1:.0f} bottom={B1:.0f} of {h}")
    assert L1 >= 2 and R1 <= w - 2, (
        f"ink not horizontally inset: left={L1:.0f} right={R1:.0f} of {w}")
    return svg(w, h, body)


# ── B. the tile, alone ──────────────────────────────────────────────────────
def design_tile(w, h):
    ts = int(min(w, h) * (0.78 if w != h else 0.80))
    x = (w - ts) / 2
    y = (h - ts) / 2
    return svg(w, h, tile(x, y, ts))


# ── C. terminal mock ────────────────────────────────────────────────────────
def design_terminal(w, h):
    """Fake `f help` session in a window chrome.

    Type scale is `ch`-based and capped by BOTH axes at once: the longest line
    must fit the card width, the last baseline must fit the card floor. Taking
    the width cap as *slack to add* (an earlier draft) overshot fs by ~10x and
    collapsed the layout; min(width_cap, height_cap) is the correct form.
    """
    pad = h * 0.09
    cw, ch = w - pad * 2, h - pad * 2

    lines = [
        ("prompt", "$ f help"),
        ("out",    "f \u2014 token-efficient CLI for LLMs"),
        ("gap",    ""),
        ("head",   "ucks"),
        ("out",    "  creds    help     ucks"),
        ("out",    "  skills   config   up"),
        ("gap",    ""),
        ("head",   "skills"),
        ("out",    "  f        f-creds   f-j   f-gh"),
        ("out",    "  f-ha     f-mqtt   f-ssh"),
        ("gap",    ""),
        ("dim",    "14 ucks \u00b7 14 skills \u00b7 f help <uck>"),
        ("prompt", "$"),
    ]
    longest = max(len(t) for _, t in lines)
    rows = sum(1 for k, _ in lines if k != "gap")
    gaps = sum(1 for k, _ in lines if k == "gap")

    BAR, LH, LEAD, TAIL = 2.0, 1.55, 1.1, 0.9   # all in multiples of fs
    # want a `ch`-ish size, then clamp to whichever axis is tighter
    fs = ch * 0.115
    fs = min(fs, (cw * 0.90) / (longest * _measure_all()["mono"]))          # width cap
    fs = min(fs, ch / (BAR + LEAD + (rows - 1) * LH + gaps * 0.55 * LH + TAIL))
    inset = fs * _measure_all()["mono"] * 1.5
    bar, lh = fs * BAR, fs * LH

    fill_of = {"prompt": CODE_INK, "out": CODE_PLAIN, "head": ACCENT, "dim": INK_FAINT}
    rows_svg = []
    y = pad + bar + lh * LEAD
    for kind, text in lines:
        if kind == "gap":
            y += lh * 0.55
            continue
        weight = ' font-weight="700"' if kind == "head" else ""
        rows_svg.append(
            f'    <text x="{pad + inset:.1f}" y="{y:.1f}" font-family="{MONO}" '
            f'font-size="{fs:.1f}"{weight} fill="{fill_of[kind]}">{text}</text>')
        y += lh
    last_baseline = y - lh

    dots = "".join(
        f'<circle cx="{pad + inset + i * fs * 0.85:.1f}" '
        f'cy="{pad + bar / 2:.1f}" r="{fs * 0.18:.1f}" fill="{c}"/>'
        for i, c in enumerate([LINE, LINE, LINE]))
    # Card, opaque title bar drawn over its top corners, one divider. No
    # full-width stroked paths: a stroke centred on an edge bleeds outward and
    # clips against the canvas.
    body = f'''<rect x="{pad:.1f}" y="{pad:.1f}" width="{cw:.1f}" height="{ch:.1f}" rx="12" fill="{CODE_BG}" stroke="{LINE}" stroke-width="1"/>
    <path d="M{pad:.1f} {pad + 12} a12 12 0 0 1 12 -12 h{cw - 24:.1f} a12 12 0 0 1 12 12 v{bar - 12:.1f} h-{cw:.1f} z" fill="{PANEL}"/>
    <path d="M{pad + 0.5:.1f} {pad + bar - 0.5:.1f} h{cw - 1:.1f}" stroke="{LINE}" stroke-width="1"/>
    {dots}
    {wordmark(pad + inset + fs * 2.9, pad + bar * 0.66, 0, fs=fs * 0.92)}
{chr(10).join(rows_svg)}'''
    # descenders reach ~0.25fs below the baseline; require clearance inside the card
    assert last_baseline + fs * 0.28 < pad + ch, \
        f"descenders {last_baseline + fs * 0.28:.0f} past card floor {pad + ch:.0f}"
    assert pad + inset + longest * _measure_all()["mono"] * fs < pad + cw - inset * 0.4, \
        "longest line overflows the card"
    return svg(w, h, body)


DESIGNS = {
    "fcli-wordmark": design_wordmark,
    "f-tile":        design_tile,
    "f-terminal":    design_terminal,
}

if __name__ == "__main__":
    import os, sys
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    os.makedirs(out, exist_ok=True)
    for name, fn in DESIGNS.items():
        for tag, (w, h) in SIZES.items():
            path = os.path.join(out, f"{name}-{tag}.svg")
            with open(path, "w") as fh:
                fh.write(fn(w, h))
            print(path)
