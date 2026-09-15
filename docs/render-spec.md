# Render Spec (vendored from research, todos 15/25/26 cite this file)

Status: frozen vendor copy. Transcribed from the Python-Tutor gap
research and the implementation plan
Phase 2/3 sections (the standalone gap-analysis note was never vendored, Downstream todos must cite this file, never the
research directory, and never use absolute-path references.

Conventions: all file references are repo-relative. There are no
absolute paths in this document by rule.

## 1. Shared idioms (apply to every structure)

- Snapshot-per-step: each step renders frames plus heap plus cumulative
  stdout, re-rendered whole; the frontend is a dumb renderer of backend
  snapshots (`frontend/src/store/traceStore.ts`).
- Two-arrow gutter: executed line (per-palette prev color) plus
  next-to-execute line (per-palette next color); return lines map back to
  the call site; exception lines get a red border plus `exception_msg`
  in an error pane.
- Layout constancy: node positions are frozen across steps, objects never
  jiggle; the eye sees change because position is stable.
- No whole-value flash: a single-field mutation flashes only the mutated
  `$id` node or cell, never the whole structure (R6 drop condition).
- Missing data renders `PrimitiveFallback`, never a blank panel.

## 2. Per-structure render-idiom table

| Structure | Visual idiom | Data dependency | Change signal | Fallback |
| Vector / array | Strip of indexed cells, changed-cell flash primitive | ordered values per step | amber flash on changed indices only | PrimitiveFallback |
| Stack | Vertical pile, top pointer marker, push/pop flash | ordered values plus top index | flash on new top cell, fade on popped | PrimitiveFallback |
| Queue | Horizontal lane with head/tail markers | ordered values plus head/tail | flash on enqueued cell and dequeued cell | PrimitiveFallback |
| Binary heap | Array strip plus triangle tree dual view, sift-swap pair flash | array values plus tree edges | both swapped nodes flash together | array strip alone |
| Priority queue | Ordered lane with priority badges | values plus priorities | flash on extracted head and inserted node | PrimitiveFallback |
| Singly-linked list | Node boxes with next-pointer arrows from heap graph | per-step heap table with `$id`/`$ref` | mutated `$id` flashes alone | current flat list text |
| Tree / struct graph | Node-link diagram, frozen layout, `$cycle` badge | heap table with `$id`/`$ref`/`$cycle` | per-`$id` diff flash, hover highlights inbound edges | PrimitiveFallback |
| Graph (algorithms) | Node-link diagram with visited/frontier coloring | adjacency plus per-node state | state-transition flash on newly visited nodes | static adjacency list |
| Grid / DP table | Heatmap cells plus dependency arrows | `changingCells`/`highlightedCells` per step | heat change on written cell, arrows on read deps | plain value grid |
| Trie | Letter-node tree with terminal badges, creation flash | heap nodes with terminal flags | flash on newly created node only | flat key list |
| Hash map | Key buckets with changed-key flash, rehash note in `step_desc` | entries plus bucket count | flash on inserted/updated key | PrimitiveFallback |
| Hash set | Member chips with insert/remove flash | member set per step | flash on added/removed member | PrimitiveFallback |

## 3. R6 gate rules (lazy and opt-in heap rendering)

- R6.1: the heap panel is collapsed by default and expands on demand;
  there is no always-on heap table.
- R6.2: per-`$id` diff replaces whole-value stringify for heap types;
  stringify stays for scalars only.
- R6.3: drop condition, flashing the whole structure on a single-field
  mutation fails the gate; only the mutated `$id` may flash.
- R6.4: aliasing renders connectors: N vars sharing one `$id` point at
  one heap box, hover highlights inbound edges.
- R6.5: dead props must be wired before passing: `currentAddr` from
  `$id` in `LinkedListVisual`, `changingCells`/`highlightedCells` in
  `GridVisual`.

## 4. R7 gate rules (scale SLO and escalation)

- R7.1: benchmark trio legs (10k nested-loop, 50k recursion, 100k
  hot-call) each hold scrub-step p95 at or under 100ms.
- R7.2: collapsed DOM count stays at or under 1000 nodes per leg.
- R7.3: 100 percent raw-step reachability: expand every collapsed group,
  then step all raw indices; any unreachable step fails the gate.
- R7.4: only the 2k tier renders full fidelity; above it the adaptive
  granularity rule applies, never 1-node-per-step at 10k plus.
- R7.5: payload gate, any leg over 25MB total NDJSON fails; re-tune
  granularity, do not excuse.
- R7.6: vector-flash tripwire, median frame time on the 1k-element scrub
  must stay within 1.2x of `frontend/bench/vector-baseline.json`, else
  FAIL with the measured ratio.
- R7.7: any failing leg records a downgrade plus canvas/cap escalation
  note (A1/A2); the todo passes only when honestly recorded, never by
  silent pass.

## 5. Acceptance (for the evidence log)

The table row grep must show the header plus at least 10 data rows.
Cite table rows by structure name; do not add absolute paths.
