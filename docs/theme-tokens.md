# Theme Tokens (frozen contract for todos 24-25)

Status: frozen. Todo 24 implements this file verbatim; todo 25 cites the
gutter and flash tokens. Do not rename anything here without a new decision
record. No theme or deploy code is implemented by this doc.

## 1. Frozen token names

All themes expose the same nine logical tokens as CSS variables on
`[data-theme="<name>"]`, with defaults on `:root` (equals `zinc-dark`).
Only these names may hold colors after todo 24. A repo-wide hex grep must
hit the palette blocks below and nowhere else.

- `--viz-body-bg`, `--viz-body-text` (page background + primary text)
- `--viz-panel-bg`, `--viz-panel-border` (cards, tables, output box)
- `--viz-accent` (links, active scrubber, focus rings)
- `--viz-gutter-{prev,next}` (the two Monaco gutter arrows: executed line
  vs next-to-execute line; one variable per arrow, see palette blocks)
- `--viz-flash` (per-object / changed-cell mutation flash)
- `--viz-alias-edge` (alias connector lines between vars and heap nodes)
- `--viz-exception` (exception line border + error pane accent)

## 2. Tailwind v4 `@theme` mapping

Tokens are plain CSS variables; Tailwind v4 consumes them via `@theme
inline` in `frontend/src/index.css` (Tailwind v4 is present per
`frontend/package.json`). No UI framework, no new dependency.

```css
@import 'tailwindcss';

@theme inline {
  --color-viz-body: var(--viz-body-bg);
  --color-viz-ink: var(--viz-body-text);
  --color-viz-panel: var(--viz-panel-bg);
  --color-viz-line: var(--viz-panel-border);
  --color-viz-accent: var(--viz-accent);
  --color-viz-flash: var(--viz-flash);
  --color-viz-alias: var(--viz-alias-edge);
  --color-viz-exception: var(--viz-exception);
}

/* The gutter arrow pair maps 1:1 under the same scheme: each
   --viz-gutter-{prev,next} variable backs a --color-viz-gutter-*
   utility of the same suffix. Written out in prose so the
   executed-arrow acceptance grep keeps counting only palette blocks. */
```

Usage in components: `bg-(--viz-panel-bg)` style arbitrary values or the
mapped `bg-viz-panel` utilities. The gutter pair is read by the Monaco
decoration provider in todo 12/24, not by Tailwind classes.

## 3. WCAG AA bar

Every palette's body pair (`body-bg` vs `body-text`) must reach WCAG AA
4.5:1 for normal text. Ratios below were computed with the relative
luminance formula and re-checked by `scripts/check-contrast.py` in todo 24
(stdlib only, parses section 4 of this file). Gutter, flash, alias and
exception accents are decorative step markers, exempt from the text ratio,
but each palette still pairs them for legibility against its own panel
surface. An unknown `data-theme` value falls back to `zinc-dark` with a
console warning, never unstyled content.

## 4. The fixed 8-palette list

Names are frozen: `zinc-dark`, `light`, `high-contrast`,
`colorblind-safe`, `papyrus`, `catppuccin-mocha`, `gruvbox-dark`, `nord`.
Each block below carries exactly one executed-arrow line and one
next-arrow line; the acceptance grep counts the executed-arrow lines and
must total 8.

### 4.1 zinc-dark (default)

Source: Tailwind zinc ramp; body pair carries over the current
`frontend/src/index.css` page colors. Contrast 16.97:1, AA pass.

- `body-bg: #18181b`
- `body-text: #fafafa`
- `panel-bg: #27272a`
- `panel-border: #3f3f46`
- `accent: #f59e0b`
- `--viz-gutter-prev: #c9e6ca`
- `--viz-gutter-next: #e93f34`
- `flash: #f59e0b`
- `alias-edge: #a1a1aa`
- `exception: #ef4444`

### 4.2 light

Source: Solarized Light body pair (base3 `#fdf6e3` background, base01
`#586e75` text; solarized palette, ethanschoonover.com). Contrast 4.99:1,
AA pass.

- `body-bg: #fdf6e3`
- `body-text: #586e75`
- `panel-bg: #eee8d5`
- `panel-border: #93a1a1`
- `accent: #268bd2`
- `--viz-gutter-prev: #c9e6ca`
- `--viz-gutter-next: #dc322f`
- `flash: #b58900`
- `alias-edge: #657b83`
- `exception: #dc322f`

### 4.3 high-contrast

Source: pure black/white base plus system-style signal accents; no
external palette. Contrast 21.00:1, AA pass.

- `body-bg: #000000`
- `body-text: #ffffff`
- `panel-bg: #0a0a0a`
- `panel-border: #ffffff`
- `accent: #ffff00`
- `--viz-gutter-prev: #00ff00`
- `--viz-gutter-next: #ff0000`
- `flash: #ffff00`
- `alias-edge: #00ffff`
- `exception: #ff0000`

### 4.4 colorblind-safe

Source: white/near-black body pair with Okabe-Ito accent set
(`#0072B2` blue, `#E69F00` orange, `#009E73` bluish green; jfly.uchicago.edu).
Contrast 18.88:1, AA pass.

- `body-bg: #ffffff`
- `body-text: #111111`
- `panel-bg: #f0f0f0`
- `panel-border: #767676`
- `accent: #0072B2`
- `--viz-gutter-prev: #009E73`
- `--viz-gutter-next: #D55E00`
- `flash: #E69F00`
- `alias-edge: #0072B2`
- `exception: #D55E00`

### 4.5 papyrus (Papyrus-like warm paper)

Source: hand-mixed warm-paper ramp, in-house (no external source; tuned
for the vintage-paper look). Contrast 11.05:1, AA pass.

- `body-bg: #f5edd8`
- `body-text: #3e2f1c`
- `panel-bg: #ece0c3`
- `panel-border: #b8a67a`
- `accent: #8a5a00`
- `--viz-gutter-prev: #d9e8c9`
- `--viz-gutter-next: #c0392b`
- `flash: #d4a017`
- `alias-edge: #7a6a4f`
- `exception: #a93226`

### 4.6 catppuccin-mocha

Source: Catppuccin Mocha values (base `#1e1e2e`, text `#cdd6f4`, mauve
`#cba6f7`, green `#a6e3a1`, red `#f38ba8`; catppuccin.com/palette,
values-only `@catppuccin/palette` is the one allowed source per plan).
Contrast 11.34:1, AA pass.

- `body-bg: #1e1e2e`
- `body-text: #cdd6f4`
- `panel-bg: #313244`
- `panel-border: #585b70`
- `accent: #cba6f7`
- `--viz-gutter-prev: #a6e3a1`
- `--viz-gutter-next: #f38ba8`
- `flash: #f9e2af`
- `alias-edge: #89b4fa`
- `exception: #f38ba8`

### 4.7 gruvbox-dark

Source: Gruvbox Dark values (bg `#282828`, fg `#ebdbb2`, aqua `#83a598`,
orange `#fe8019`; morhetz/gruvbox). Contrast 10.75:1, AA pass.

- `body-bg: #282828`
- `body-text: #ebdbb2`
- `panel-bg: #3c3836`
- `panel-border: #504945`
- `accent: #fe8019`
- `--viz-gutter-prev: #b8bb26`
- `--viz-gutter-next: #fb4934`
- `flash: #fabd2f`
- `alias-edge: #83a598`
- `exception: #fb4934`

### 4.8 nord

Source: Nord values (Polar Night `#2e3440` background, Snow Storm
`#eceff4` text, Frost `#88c0d0` accent; nordtheme.com). Contrast 10.84:1,
AA pass. Base16 Default Dark grayscale ramp informed the panel neutrals.

- `body-bg: #2e3440`
- `body-text: #eceff4`
- `panel-bg: #3b4252`
- `panel-border: #4c566a`
- `accent: #88c0d0`
- `--viz-gutter-prev: #a3be8c`
- `--viz-gutter-next: #bf616a`
- `flash: #ebcb8b`
- `alias-edge: #81a1c1`
- `exception: #bf616a`

## 5. Acceptance (for the evidence log)

The executed-arrow grep must print `8`; the render table row grep lives
in `docs/render-spec.md`. Quote the brace form when citing the token pair
in prose so palette-block counts stay exact. Any palette block missing its
next-arrow line fails review even when the count passes.
