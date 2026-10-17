#!/usr/bin/env python3
"""Same-scale A/B: is the thumbnail's `f` the site's `f`?

Renders the untouched docs/assets/favicon.svg and the thumbnail's tile at the
IDENTICAL tile size, then compares the two glyphs' ink box: width, height,
horizontal centring, and the gaps above/below.

Why same-scale rather than a tolerance table: raster quantization dominates at
small tile sizes. Measured on the original favicon alone, the glyph's width
fraction is 0.312 at a 64px tile and 0.320 at 1024px, and its ink centre drifts
from 0.633 to 0.522 across that range. Any fixed tolerance either waves through
real defects at small sizes or fails correct art at large ones.

Renders with Chromium: librsvg resolves the favicon's font stack to a different
monospace and the glyph shape changes (ink width 0.20em vs 0.32em of the tile).

Usage:  python3 check_glyph.py            # every thumbnail with a tile
        python3 check_glyph.py <png> <tx> <ty> <ts>
"""
import os
import re
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate  # noqa: E402  (reuse tile(), favicon_body())

ACCENT = (0x58, 0xc9, 0xa0)
TOL = 0.008


def _browser():
    for b in ("chromium", "google-chrome", "chromium-browser"):
        p = subprocess.run(["bash", "-c", f"command -v {b}"],
                           capture_output=True, text=True).stdout.strip()
        if p:
            return p
    raise SystemExit("need chromium on PATH")


BROWSER = _browser()


def shoot(svg, png, w, h):
    page = os.path.join(HERE, ".check.html")
    open(page, "w").write(
        "<!doctype html><meta charset='utf-8'>"
        "<style>html,body{margin:0;padding:0;overflow:hidden}"
        "svg{display:block}</style>" + svg)
    subprocess.run([BROWSER, "--headless=new", "--no-sandbox", "--disable-gpu",
                    "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={w},{h}", f"--screenshot={png}",
                    f"file://{page}"], capture_output=True, check=True)


def ref_svg(size):
    """The site's favicon, untouched, rasterised at `size`."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="{s}" height="{s}" '
            'viewBox="0 0 64 64">{body}</svg>').format(s=size, body=generate.favicon_body())


def accent_box(im, box, require_exact=None, report=None):
    """Ink box of accent-green pixels, plus an exact-colour sanity check.

    Geometry alone is not enough: a recoloured glyph has an identical ink box.
    When `require_exact` is given, the brightest pixel found must actually be
    that colour, so a wrong --accent cannot pass as "matches the site".
    """
    W, H = im.size
    p = im.convert("RGB").load()
    x0, y0 = max(0, box[0]), max(0, box[1])
    x1, y1 = min(W, box[2]), min(H, box[3])
    xs, ys = [], []
    best, best_px = -1, None
    for x in range(x0, x1):
        for y in range(y0, y1):
            c = p[x, y]
            if c[1] > 90 and c[1] - c[0] > 30 and c[1] - c[2] > 15:
                xs.append(x); ys.append(y)
                if c[1] > best:
                    best, best_px = c[1], c
    if report is not None:
        report["peak"] = best_px
    if not xs:
        return None
    return (min(xs), max(xs), min(ys), max(ys))


def metrics(box, ox, oy, ts):
    x0, x1, y0, y1 = box
    return dict(gw=(x1 - x0 + 1) / ts, gh=(y1 - y0 + 1) / ts,
                cx=((x0 + x1) / 2 - ox) / ts,
                top=(y0 - oy) / ts, bot=(oy + ts - y1) / ts)


def compare(png, tx, ty, ts, tol=TOL):
    S = int(round(ts))
    ref = os.path.join(HERE, ".check_ref.png")
    shoot(ref_svg(S), ref, S, S)
    ra, rb = {}, {}
    a = accent_box(Image.open(ref), (0, 0, S, S), report=ra)
    b = accent_box(Image.open(png), (tx, ty, tx + S, ty + S), report=rb)
    if a is None or b is None:
        print(f"    FAIL  no glyph found (reference={a is not None}, "
              f"thumbnail={b is not None})")
        return False
    ma, mb = metrics(a, 0, 0, S), metrics(b, tx, ty, S)
    bad = False
    for k in ("gw", "gh", "top", "bot", "cx"):
        if abs(mb[k] - ma[k]) > tol:
            bad = True
    # colour: the glyph's peak pixel must match the site's, not merely be greenish
    if ra.get("peak") != rb.get("peak"):
        print(f"    FAIL  glyph colour differs: thumbnail {rb.get('peak')} "
              f"vs site {ra.get('peak')}")
        bad = True
    line = "  ".join(f"{k}={mb[k]:.4f}/{ma[k]:.4f}" for k in ("gw", "gh", "top", "bot", "cx"))
    print(f"    {'FAIL' if bad else 'ok  '}  {line}   "
          f"colour {rb.get('peak')}/{ra.get('peak')}   (thumbnail/site)")
    return not bad


def tile_of(svg_path):
    s = open(svg_path).read()
    m = re.search(r"translate\((-?[\d.]+),(-?[\d.]+)\)\s*scale\(([\d.]+)\)", s)
    if not m:
        return None
    x, y, sc = (float(m.group(i)) for i in (1, 2, 3))
    return round(x), round(y), round(64 * sc)


def main():
    if len(sys.argv) == 5:
        return 0 if compare(sys.argv[1], *[int(v) for v in sys.argv[2:5]]) else 1
    out = sys.argv[1] if len(sys.argv) > 1 else "thumbs"
    ok = True
    checked = 0
    for name in sorted(os.listdir(out)):
        if not name.endswith(".svg") or "terminal" in name:
            continue                       # design C has no tile by design
        t = tile_of(os.path.join(out, name))
        if not t:
            continue
        png = os.path.join(out, name[:-4] + ".png")
        if not os.path.exists(png):
            print(f"  {name}: render the PNG first"); ok = False; continue
        print(f"  {name[:-4]}  tile {t[0]},{t[1]} size {t[2]}")
        ok &= compare(png, *t)
        checked += 1
    print(f"\n{'OK' if ok else 'FAILED'}: {checked} thumbnails compared against the site favicon")
    return 0 if ok and checked else 1


if __name__ == "__main__":
    sys.exit(main())
