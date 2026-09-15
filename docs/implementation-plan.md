# DSA Visualiser — Python-Tutor-Style Upgrade: Implementation Plan

> Companion to `docs/python-tutor-gap-analysis.md` (research) and `new_plan.md` (original intent).
> 4 phases · 12 work units · wave-ordered · TDD throughout · additive schema (app stays shippable at every boundary).

---

## Guiding principles

1. **Schema is additive-only.** Every phase adds *new optional fields* to trace events. Old traces and old frontends keep working; the frontend feature-flags on field presence. No breaking rename in any phase.
2. **Backend-first, frontend-later.** Frontend consumers for Phase 2/3 data (per-frame panels, stdout panel, heap panel) are blocked until their backend field lands. Phase 1 frontend work (step descriptions) only needs the schema delta, not the backend runtime.
3. **TDD floor.** Every production change starts with a failing test in the matching existing test file (`backend/tests/test_*.py`, frontend `tests/`), RED captured, then GREEN.
4. **Verification is concrete** — a test id, a compiled-trace check on `backend/tests/fixtures/simple_bsearch.cpp`, or a Playwright assertion. No "should work".

**Environment caveat (from research):** the venv's `clang.cindex` bindings mismatch the bundled libclang 18.1.1 (`Unknown template argument kind 437` corrupts AST child traversal). Empirical instrumenter checks must either (a) pin matching `clang`+`libclang` wheel versions, or (b) use a working system python3. Fix the toolchain as Wave 0 before relying on instrumenter tests.

---

## Wave 0 — Toolchain + Schema Delta Contract (all phases depend on it)

**W0.1 — Fix libclang bindings**
- Files: `backend/pyproject.toml` (pin `clang` to match `libclang==18.1.1`); verify `backend/app/core/instrumenter/ast_walker.py:_find_libclang` globs the right dir (`site-packages/clang/native/`).
- Verify: `pytest backend/tests/test_instrumenter.py` passes with real AST traversal.
- Category: `quick` / `unspecified-low`

**W0.2 — Write the schema-delta contract doc** (`docs/trace-schema-v2.md`)
- New event fields (all optional, additive):
  - `STATE` event: `+stdout` (cumulative program output so far), `+globals` (top-level vars), `+step_desc` (human sentence), `+prev_line` (line of previous event)
  - `BRANCH` event: `+ops` (operand values, e.g. `{"i":3,"n":5}`), `+step_desc`
  - `ENTER` event: `+step_desc`
  - `EXIT` event: `+step_desc`, `+return_line` (call-site line)
  - Stream-level final `cfg` chunk: unchanged (`stdout` stays as terminal fallback)
  - Phase 3 additions: `+heap` table + `$id`/`$ref` object encoding (separate doc section)
- Files: `backend/app/core/trace/models.py`, `frontend/src/types/trace.ts` (mirror)
- Verify: doc exists + both model files updated; backend & frontend typecheck green with optional fields.

---

## Phase 1 — Correctness of visible variables + step explanations (backend)

> Fixes Gap A entirely (nested-statement tracing, post-declaration scope, globals) + adds the Gap-D differentiator (step descriptions).

### Wave 1.1 (parallel, independent)

**T1 — Nested-statement STATE injection** [Gap A, the `mid` bug]
- Context: `ast_walker.py:_walk_stmt` (L354+) currently injects BRANCH/LOOP_ITER/FUNC_EXIT but never STATE for nested statements; STATE only via `_walk_cursor` per unique top-level line (L333-345).
- Change: in `_walk_stmt`, when recursing into compound bodies (IF then/else, LOOP body, SWITCH case bodies), emit `InjectKind.STATE` at each nested statement's line (per-line dedup within scope). Reuse `InjectionPoint` mechanics — no new event type.
- Tests (RED first, `backend/tests/test_instrumenter.py`):
  - `test_state_injected_inside_while_body` — assert injection point at the `int mid = ...` line of `simple_bsearch.cpp`
  - `test_state_injected_inside_if_branches` — assert injection inside then/else bodies
- Verify (GREEN + surface): compile injected `simple_bsearch.cpp`, run, grep trace for `"mid"` — must appear; event count grows beyond the old 14.
- Category: `ultrabrain` (AST traversal logic) or `deep`

**T2 — Post-declaration scope snapshot** [Gap A off-by-one]
- Context: `scope_tracker.py` records `vars_at_line` *before* the statement's own DECL_STMT vars; `injector.py:_trace_state` (L65-75) merges from it → `int result = f(x)` STATE omits `result`.
- Change: in `scope_tracker`, after processing a DECL_STMT, also register the declared names for that same line (post-state); `injector` emits the post-state set. Build both `vars_at_line_pre` and `vars_at_line_post`; STATE uses `post`.
- Tests (`backend/tests/test_instrumenter.py` or new `test_scope.py`):
  - `test_declared_var_included_in_same_line_state` — `int x = 5;` STATE includes `x:5`
  - `test_params_plus_declared_vars` — bsearch: `int lo=0, hi=n-1;` STATE includes lo/hi
- Verify: compiled-trace check on `simple_bsearch.cpp` — `state l18` must include `result`.
- Category: `ultrabrain`

**T3 — Globals capture** [Gap A: no globals]
- Context: `scope_tracker` walks function bodies only; global/namespace-scope vars never appear.
- Change: extend walker+scope_tracker to collect top-level (translation-unit, non-function) variable declarations; STATE events carry a new `globals` field, emitted only when changed vs previous STATE (dedup identical snapshots to bound trace size).
- Tests: `test_globals_captured_in_state` (global `const int N = 10;` appears in `globals` of a STATE in `main`); `test_globals_dedup` (unchanged globals don't repeat).
- Verify: trace for a fixture with a global shows the globals field.
- Category: `ultrabrain`

**T4 — Parser-synthesized per-step explanations** [Gap D differentiator]
- Context: `backend/app/core/trace/parser.py` — flat event stream, dynamic depth recompute (L75-90).
- Change: synthesize `step_desc` per event from type+payload:
  - `enter` → `Entered {func} (depth {d})`
  - `state` → `Line {l} in {func} — {n} var(s) updated` (or `Assigned result = 15` where derivable)
  - `branch` → `{cond} → {taken ? "true" : "false"}` (with ops: `3 < 5 → true`)
  - `iter` → `Iteration {it} of loop at line {l}`
  - `exit` → `Returned {r} from {func}`
- Location: new pure function in `backend/app/core/trace/descriptions.py` (no I/O), called from `parse()`.
- Tests (new `backend/tests/test_descriptions.py`): table-driven per event type with exact expected strings; `test_desc_branch_with_ops`.
- Verify: `pytest` green; NDJSON stream includes `step_desc`.
- Category: `unspecified-low` / `quick`

### Wave 1.2 (after T1-T3)

**T5 — Phase 1 frontend consumption**
- Context: `frontend/src/types/trace.ts`, `StatePanel.tsx`, `App.tsx`, `useTraceNavigation.ts`.
- Change: type `step_desc`; render as a header line in `StatePanel` (above vars) and in the scrubber step label (`useTraceNavigation.ts:30-32`). Render `globals` section (collapsible) above current-frame vars when present.
- Tests: extend `frontend/tests/mockData.ts` with a `step_desc`-carrying trace; Playwright assertion in `tests/visual.spec.ts` that the description text renders at step 0.
- Verify: `bun --filter frontend typecheck`; Playwright green.
- Category: `visual-engineering` + `frontend` skill

**Phase 1 boundary gate:** root typecheck, backend pytest, Playwright green. Old traces render unchanged (fields optional). Manual: run `simple_bsearch.cpp` through the API, scrub, confirm `mid`/`result`/globals visible + description text.

---

## Phase 2 — Python-Tutor-style data model (frames + incremental stdout + two-arrow highlight)

### Wave 2.1 (parallel backend: T6, T7, T8)

**T6 — Reconstruct `stack_to_render` in parser** [per-frame visibility]
- Context: `parser.py` — flat stream has FUNC_ENTER/EXIT in order + per-event depth; frontend `CallStackView` shows names/depth only.
- Change: parser maintains a live call-stack model while iterating: each frame = `{func, frame_id, depth, vars}`; `vars` updated from each STATE event's `v`; parent frame vars persist until FUNC_EXIT. Attach `stack_to_render` (frames, most-recent-first, each with `encoded_locals` + `ordered_varnames`) to every event — or lazily via a parallel per-index structure to avoid bloating every event (prefer a parallel `frames_at_step` array).
- Tests (`backend/tests/test_streaming.py`): `test_stack_to_render_two_frames` (main calls bsearch, mid-execution event shows both frames with correct locals); `test_stack_to_render_recursion` (recursive call shows N frames keyed by unique frame_id); `test_parent_vars_persist`.
- Verify: JSON of a nested-call trace contains both frames' locals.
- Category: `ultrabrain`

**T7 — Incremental stdout (per-event cumulative)** [Gap C]
- Context: `tracer.h` writes trace to stderr; real stdout captured whole by sandbox; `execute.py:132-142` emits stdout only on final `cfg` chunk; `docker_runner.py` collects stdout after run.
- Change (two parts):
  - C++ side (`tracer.h` + injected preamble): at program start, redirect fd 1 to a temp file via `freopen`/`dup2` so both `cout` and `printf` land there. Each `__TRACE_*` macro emits the file's bytes-since-last-read as `"o":"..."` in the event JSON. stderr keeps trace lines (contract unchanged).
  - Python side (`parser.py`, `models.py`): accumulate cumulative `stdout` field per event; final chunk keeps terminal `stdout` for backward compat.
- Tests: `backend/tests/test_streaming.py` — `test_stdout_incremental_per_step` (program printing in a loop: event N has first N lines). New fixture `backend/tests/fixtures/print_loop.cpp`.
- Verify: run fixture through API; frontend receives growing `stdout`; last event's stdout == full output.
- Category: `deep` (C++ + Python + sandbox plumbing)

**T8 — Branch operand values** [Gap D]
- Context: `tracer.h` BRANCH emits `c` (condition text) + `tk`; `ast_walker` provides `condition_text`.
- Change: in BRANCH emission, also serialize the condition's referenced variables' current values as `ops` (walker collects free vars of the condition expression; tracer serializes them): `__TRACE_BRANCH(line, func, depth, "cond", cond, {"i":i,"n":n})`.
- Tests: `backend/tests/test_instrumenter.py` — `test_branch_ops_vars_collected` (condition `arr[mid] == target` yields ops keys `arr,mid,target`); `backend/tests/test_streaming.py` — ops values match trace.
- Verify: branch event JSON has `ops`.
- Category: `ultrabrain`

### Wave 2.2 (after T6/T7 land)

**T9 — Phase 2 frontend: frame panels + stdout panel + two-arrow highlight**
- Context: `StatePanel.tsx` (flat vars render L25-41), `CallStackView.tsx`, `CodeEditor.tsx` (single decoration L67-93), `App.tsx` stdout banner (L145-149), `types/trace.ts`, `traceStore.ts`.
- Changes (three sub-units, one task — same files):
  1. **Per-frame var tables**: when `stack_to_render`/`frames_at_step` present, render globals frame + each frame's `encoded_locals`/`ordered_varnames` (keyed by `frame_id`), replacing the flat current-frame list; keep flat fallback when absent.
  2. **ProgramOutputBox**: new component rendering `currentEvent.stdout` cumulative text (monospace panel, grows as you step); retire the static `App.tsx` banner when per-step stdout present.
  3. **Two-arrow Monaco highlight**: from `prev_line`/`line`, add a second gutter decoration — executed line (light green `#c9e6ca`) vs next-to-execute (red `#e93f34`), red border on exception lines; update `index.css` classes.
- Tests: `tests/mockData.ts` traces with frames + per-step `stdout`; Playwright assertions: two frames visible, stdout grows between step 1 and step 3, gutter shows two arrow glyphs.
- Verify: `bun --filter frontend typecheck`; Playwright green.
- Category: `visual-engineering` + `frontend` skill

### Wave 2.3 (integration)

**T10 — End-to-end Phase 2 wiring**
- Context: `App.tsx` handleExecute, `utils/api.ts` streamExecute, `traceStore.ts`.
- Change: pass new fields through stream → store → panels; ensure `compressedSteps` grouping still works with per-step stdout (a group of identical *vars* can still have growing stdout — adjust compression key to include stdout when present).
- Tests: `backend/tests/test_api_endpoints.py` — response carries new fields; frontend Playwright full-workflow spec (01-full-workflow) updated.
- Verify: full `docker compose` manual run of a print-loop program: scrub, watch output panel grow line-by-line.
- Category: `deep` + `visual-engineering` (integration QA)

**Phase 2 boundary gate:** typecheck + full pytest + Playwright + manual docker run. Schema additions optional → old fixtures render.

---

## Phase 3 — Heap object identity (the big lift)

### Wave 3.1 (parallel: T11a, T11b)

**T11a — Build `serializer_gen.py`**
- Context: referenced by `tracer.h` comment + `new_plan.md` §5.1 but **absent from the repo**. Currently pointers serialize as `{"$addr":"0x..."}` only (`tracer.h` L305-322), so `TreeNode*`/`ListNode*` render as opaque strings and LinkedListVisual/StructGraphVisual/MultiStructureSyncView are dead code.
- Change: generate per-struct serializers emitting object graphs with identity:
  - Each heap object: `{"$id": <int>, "val":5, "left":{"$ref":7}, "right":null}` — `$id` stable per address across steps (map `void*` → int via `std::map<void*,int>` in tracer.h), `$ref` = id of pointed-to object, cycle-guard via visited set (already in tracer.h).
  - Containers (vector/map/set/stack/queue/pq) also get `$id` so aliasing between a var and a struct field pointing to the same vector is visible.
  - Keep the LLM-schema cross-check design from `new_plan.md` §5.4 (field names validated against AST; graceful `{"structs":[]}` fallback).
- Tests (`backend/tests/test_serializers.py`): `test_struct_serializer_emits_id_ref` (TreeNode with left/right → `$id`+`$ref`), `test_cycle_detection` (self-referential node → `$cycle`), `test_aliasing` (two vars → same `$id`).
- Verify: compile+run a linked-list fixture; trace values contain `$id`/`$ref` instead of `$addr`.
- Category: `ultrabrain` (codegen) — this is the riskiest unit; consider Oracle review of the design before implementation.

**T11b — Parser builds heap table** [proper change-over-time]
- Context: `parser.py` + `models.py`; frontend currently diffs whole values via `JSON.stringify` (`StatePanel.tsx:81-84`).
- Change: parser extracts every `$id`-carrying object into a per-step `heap` table (`{id → {type, fields, refs}}`); events reference heap ids. Frontend can then diff **by object id** between steps → per-object mutation flash + aliasing rendering, replacing the shallow whole-value stringify diff.
- Tests (`backend/tests/test_streaming.py`): `test_heap_table_contains_structs`, `test_heap_dedup_same_object_across_steps` (id stable), `test_mutation_detected_by_id` (value change on same id).
- Verify: trace JSON contains `heap`; two consecutive steps share object ids.
- Category: `ultrabrain`

### Wave 3.2 (after T11a/T11b)

**T12 — Frontend heap panel + per-object mutation flash + alias connectors**
- Context: `registry.tsx` (struct → `PrimitiveFallback` today), `useContainerType.ts` ($addr heuristic), `StatePanel.tsx` (stringify diff), `LinkedListVisual.tsx` (`currentAddr` prop never populated), `GridVisual.tsx` (`changingCells`/`highlightedCells` never populated), `MultiStructureSyncView.tsx` + `schemaRenderer.ts` (dead, awaiting this data).
- Change:
  1. **HeapPanel**: new component rendering the per-step heap table (objects + `$ref` edges), like Python Tutor's heap box.
  2. **Per-object mutation flash**: diff heap by `$id` between steps → highlight changed objects (amber flash), replacing whole-value stringify.
  3. **Aliasing**: two vars with same `$id` render with a connector/pointer to the same heap object.
  4. Wire `currentAddr`/`changingCells` props into LinkedListVisual/GridVisual now that data exists.
- Tests: `tests/mockData.ts` heap traces; Playwright: linked list renders nodes from `$id` graph, changed node flashes, alias connector visible.
- Verify: `bun --filter frontend typecheck`; Playwright green; manual docker run of a linked-list program.
- Category: `visual-engineering` + `frontend` skill

**Phase 3 boundary gate:** full pytest + Playwright + manual linked-list run. Traces without heap data still render (fallback to flat vars).

---

## Phase 4 — Polish (optional, cheap)

**T13 — Expression-level steps for simple statements** (optional)
- Context: injector already wraps return exprs in temps (`__trace_ret_0`); same pattern for simple assignments: `int x = a + b*c;` → emit `b*c` temp step then assignment step.
- Tests: `test_instrumenter.py` — `test_expression_temp_injected`; `test_streaming.py` — intermediate value appears.
- Category: `ultrabrain`
- Note: Python Tutor's deployed site doesn't do this either — genuinely optional.

**T14 — Compression UX refinement**
- Context: `traceStore.ts` compression (L96-139) collapses identical-state groups; `TraceScrubber.tsx` group ticks (L117-131). Today `next/prev` may skip silently.
- Change: ensure `next`/`prev` land on group boundaries with visible "N identical steps" affordance (keep collapse; never hide a step from scrubbing).
- Tests: frontend — `tests/visual.spec.ts` scrubber-compressed spec (15-scrubber-compressed) updated to assert boundary landing.
- Category: `visual-engineering` + `frontend` skill

**Phase 4 boundary gate:** Playwright green; manual scrub check.

---

## Wave / dependency summary

| Wave | Tasks | Depends on | Ships |
|---|---|---|---|
| W0 | W0.1 toolchain, W0.2 schema doc | — | toolchain fix, schema contract |
| W1.1 | T1, T2, T3, T4 (parallel) | W0 | correct vars + step_desc (backend) |
| W1.2 | T5 | T1-T3 (schema) | step descriptions in UI |
| W2.1 | T6, T7, T8 (parallel) | W0 | frames + stdout + branch ops (backend) |
| W2.2 | T9 | T6, T7 | frame panels, output panel, 2-arrow highlight |
| W2.3 | T10 | T9 | end-to-end wiring |
| W3.1 | T11a, T11b (parallel) | W0 | serializer_gen + heap table |
| W3.2 | T12 | T11a, T11b | heap panel + mutation flash + aliasing |
| W4 | T13, T14 | W2.x | expression steps + compression UX |

## Suggested delegation map

| Task | Category | Skills |
|---|---|---|
| W0.1, T4 | quick / unspecified-low | — |
| T1, T2, T3, T6, T8, T11a, T11b, T13 | ultrabrain | — |
| T7, T10 | deep | — |
| T5, T9, T12, T14 | visual-engineering | frontend |
| W0.2 | writing | — |

## Shippability at every boundary

- Every phase's schema additions are **optional fields** — old traces render, new traces degrade gracefully on old frontends.
- Backend pytest + root typecheck + Playwright must stay green at each gate before the next wave starts.
- Phase 3 is the only phase with real design risk (codegen + heap identity) — get an Oracle review of the T11a design before implementation.

