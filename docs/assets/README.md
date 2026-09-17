# docs/assets — single-SVG rule

- `screenshots/` — screenshots only (Playwright captures, social preview lives at
  `docs/assets/social-preview.png`). Never put diagrams here.
- `diagrams/` — ABSENT (no-custom-diagram-needed, recorded 2026-09-17).

## Why no diagrams/ dir

Survey (todo 26): every graphic in `docs/ARCHITECTURE.md` is a Mermaid fenced block
(flowchart + sequenceDiagram) — Mermaid-covered, so all are skipped per the rule.
No genuinely custom (non-Mermaid-renderable) diagram exists anywhere in `docs/`.
Committing triple copies of Mermaid-renderable diagrams is forbidden.

## If a custom diagram is ever needed

Single-SVG rule: one `*.svg` + same-basename `.drawio` source in
`docs/assets/diagrams/`, nothing else (no `.png` there). Export recipe lives in
`docs/README-FORMAT.md` (`drawio --export --format svg <name>.drawio`).
Constraints for that future commit: orphan SVG ⇒ add source or record
`source-lost (UNVERIFIED-reproducible)` for the gate GAP list; `find
docs/assets/diagrams -size +200k` must come back empty or justified; a source
newer than its export fails CI (informational — re-export before pushing).
