#!/usr/bin/env python3
"""Negative control for check_glyph.py.

A check that passes everything is worthless. Each case below corrupts the tile
in a way that a real regression would, and each must be REJECTED. If any prints
"NOT CAUGHT", check_glyph.py is blind to that failure mode.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_glyph  # noqa: E402


CASES = {
    "correct, unmodified":        lambda s: s,
    "font stack truncated":
        lambda s: re.sub(r'font-family="ui-monospace[^"]*"',
                         'font-family="ui-monospace, "', s),
    "sans fallback for the f":
        lambda s: re.sub(r'font-family="ui-monospace[^"]*"',
                         'font-family="ui-sans-serif, sans-serif"', s),
    "baseline nudged 45 -> 41":
        lambda s: s.replace('y="45"', 'y="41"'),
    "font-size 40 -> 44":
        lambda s: s.replace('font-size="40"', 'font-size="44"'),
    "accent recoloured":
        lambda s: s.replace('fill="#58c9a0"', 'fill="#3fbf96"'),
    "glyph nudged off-centre":
        lambda s: s.replace('x="32"', 'x="35"'),
}


def main():
    svg = os.path.join("thumbs", "fcli-wordmark-og-1200x630.svg")
    tx, ty, ts = check_glyph.tile_of(svg)
    uncaught = []
    for name, fn in CASES.items():
        want_pass = name.startswith("correct")
        src = open(svg).read()
        png = os.path.join(HERE, ".neg.png")
        m = re.search(r'width="(\d+)" height="(\d+)"', src)
        check_glyph.shoot(fn(src), png, int(m.group(1)), int(m.group(2)))
        ok = check_glyph.compare(png, tx, ty, ts)
        verdict = "caught" if ok == want_pass else "NOT CAUGHT"
        if ok != want_pass:
            uncaught.append(name)
        print(f"  {'PASS' if ok else 'REJECT':<7} {name:<28} expected "
              f"{'PASS' if want_pass else 'REJECT'}  -> {verdict}\n")
    if uncaught:
        print(f"check_glyph.py is BLIND to {len(uncaught)} failure mode(s): "
              + ", ".join(uncaught))
        return 1
    print("check_glyph.py discriminates: correct art passes, every corruption "
          "is rejected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
