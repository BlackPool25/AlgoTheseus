#!/usr/bin/env python3
"""check-contrast.py — WCAG AA gate for docs/theme-tokens.md (todo 24).

Parses the section-4 palette blocks of docs/theme-tokens.md, extracts each
palette's body-bg / body-text pair, and asserts WCAG AA 4.5:1 for normal
text using the relative-luminance formula. Stdlib only, no I/O besides the
doc file and stdout.

Gutter, flash, alias-edge and exception accents are decorative step markers,
exempt from the text ratio (they never render body copy); each palette still
pairs them for legibility against its own panel surface.

Exit 0 iff all 8 frozen palettes are present, complete, and pass AA.
Any missing palette, missing body pair, unparsable hex, or ratio below 4.5
exits nonzero.
"""

import re
import sys

EXPECTED_PALETTES = [
    "zinc-dark",
    "light",
    "high-contrast",
    "colorblind-safe",
    "papyrus",
    "catppuccin-mocha",
    "gruvbox-dark",
    "nord",
]

MIN_RATIO = 4.5


def luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    channels = [int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]

    def linearize(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linearize(c) for c in channels)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(bg: str, fg: str) -> float:
    lighter = max(luminance(bg), luminance(fg))
    darker = min(luminance(bg), luminance(fg))
    return (lighter + 0.05) / (darker + 0.05)


def parse_palettes(text: str) -> dict:
    """Map palette name -> {token: hex} for each `### 4.N name` block."""
    palettes: dict = {}
    current = None
    block_re = re.compile(r"^### 4\.\d+\s+([a-z-]+)")
    # Token lines look like: - `body-bg: #18181b` (gutter lines use the
    # full variable form: - `--viz-gutter-prev: #c9e6ca`).
    token_re = re.compile(r"^- `--viz-gutter-(prev|next): #([0-9a-fA-F]{6})`$")
    plain_re = re.compile(r"^- `([a-z-]+): #([0-9a-fA-F]{6})`$")
    for line in text.splitlines():
        line = line.strip()
        m = block_re.match(line)
        if m:
            current = m.group(1)
            palettes[current] = {}
            continue
        if current is None:
            continue
        m = token_re.match(line)
        if m:
            palettes[current][f"gutter-{m.group(1)}"] = "#" + m.group(2)
            continue
        m = plain_re.match(line)
        if m:
            palettes[current][m.group(1)] = "#" + m.group(2)
    return palettes


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} docs/theme-tokens.md", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        text = f.read()

    palettes = parse_palettes(text)
    failures = []

    missing = [p for p in EXPECTED_PALETTES if p not in palettes]
    if missing:
        failures.append(f"missing palette blocks: {', '.join(missing)}")

    for name in EXPECTED_PALETTES:
        tokens = palettes.get(name, {})
        bg = tokens.get("body-bg")
        fg = tokens.get("body-text")
        if bg is None or fg is None:
            failures.append(f"{name}: incomplete body-text pair (bg={bg}, text={fg})")
            continue
        ratio = contrast_ratio(bg, fg)
        status = "PASS" if ratio >= MIN_RATIO else "FAIL"
        print(f"{name}: body {bg} vs text {fg} = {ratio:.2f}:1 ({status}, AA bar 4.5:1)")
        if ratio < MIN_RATIO:
            failures.append(f"{name}: ratio {ratio:.2f}:1 below AA 4.5:1")

    print(
        "Exemption (decorative, not body text — no ratio asserted): "
        "gutter-prev, gutter-next, flash, alias-edge, exception."
    )

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1
    print(f"OK: all {len(EXPECTED_PALETTES)} palettes pass WCAG AA on body-text pairs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
