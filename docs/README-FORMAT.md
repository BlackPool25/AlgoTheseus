# README Fonts, Formats, and Diagram Policy

Design spec for README rendering. Repo files win over this spec on any contradiction.

## Fonts

- HTML snippets in Markdown use the system stack, never a webfont hotlink in README:
  `font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
- Code (inline and fenced) uses the reader's monospace default. Never set a custom webfont for code.
- Rationale: no network dependency, no FOUT, renders identically on github.com and mirrors.

## Formats

- Body prose is Markdown (ATX headings, fenced code blocks with language tag).
- Screenshots: PNG, max 500KB each. Compress before committing.
- Motion: GIF only if under 2 minutes and 5MB or less; anything longer or heavier becomes a linked video, never an oversized GIF in the README.
- Never commit `.vsdx`, `.docx`, or `.pages` without an open-format export alongside them.

## Diagrams

- Mermaid fenced blocks are the primary diagram format. They render natively on GitHub and stay diffable.
- A single SVG export is allowed only where Mermaid is insufficient (layout Mermaid cannot express).
- `.drawio` source is kept ONLY for those SVG-exception diagrams, never as a blanket triple-format rule.
- Export recipe: `drawio --export --format svg <name>.drawio`.
- Why no triple-format blanket rule (grill reframe): requiring Mermaid plus SVG plus `.drawio` for every diagram triples maintenance cost and guarantees the three copies drift; the exception-only rule keeps one source of truth per diagram.

## Badges

- Shields.io, `flat-square` style, maximum 5 badges (current roster: CI status, License MIT, Python 3.11+, Docker-Compose, PRs-welcome).
- Use the `logo` / `logoColor` convention, e.g. `?logo=python&logoColor=white&style=flat-square`.
- Hero image uses the `<picture>` dark/light pattern copied from README.md:2-6:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="resources/AlgoTheseus.png">
  <img src="resources/AlgoTheseus.png" alt="AlgoTheseus" width="720"/>
</picture>
```

## Assets

- Screenshots live in `docs/assets/screenshots`; diagram sources and exports in `docs/assets/diagrams`.
- Reference assets by relative path from the repo root.

## Sources

- Badge roster and `<picture>` pattern: repo-local, README.md:2-6 (hero) and README.md:32-38 (badges).
- System-stack, Mermaid-primary, shields conventions: UNVERIFIED (no librarian/Context7 rules found in `.omo/notepads/algotheseus-oss-docs/`; re-verify in todo 27).
