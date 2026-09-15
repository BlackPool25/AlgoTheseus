# Python Tutor vs. DSA Visualiser — Execution Visualization Gap Analysis

> Research report · Aug 2026 · Companion to `new_plan.md`
> Scope: how Python Tutor visualizes execution, why DSA Visualiser differs, and a 4-phase plan to close the gap.

---

## TL;DR

The visualiser is **not** "worse than Python Tutor by a little" — it's architecturally different at the root:

- **Python Tutor traces a Python interpreter.** `sys.settrace` gives it per-line events with the *entire call stack, every frame's locals, the full heap object graph, and cumulative stdout* — all essentially for free, at runtime.
- **DSA Visualiser statically instruments C++.** libclang injects trace calls at compile time, so it only ever sees *exactly what was chosen to inject*. The current implementation chose: **per-line STATE in top-level function statements only, flat vars of the current function, no globals, no object identity, stdout delivered once at the end**.

Everything requested — variable visibility, value changes over time, incremental output, per-step calculation highlighting — is downstream of that data model. **The fixes are mostly backend protocol changes, not frontend polish.** Several of the highest-leverage fixes are cheap.

---

## 1. How Python Tutor actually works

Source: public mirrors of `pgbovine/OnlinePythonTutor` (`ajesse11x/OnlinePythonTutor` @ `1d6c06f`, `zetaloop/OnlinePythonTutor-Backup` @ `473848d`). The canonical repo went private ~Aug 2020.

> **Correction to a common premise: the deployed pythontutor.com is NOT React.** Verified against the live `build/visualize.bundle.js` (1.38 MB): zero React/Redux markers. It is the v5-unity stack: jQuery + D3 data-joins + jsPlumb connectors. The React "v6" frontend was never released publicly.

### 1.1 Backend tracing (`v5-unity/pg_logger.py`)

- **Mechanism**: `PGLogger(bdb.Bdb)` — a subclass of Python's stdlib debugger, which is `sys.settrace(self.trace_dispatch)` based (`CPython 3.12 Lib/bdb.py` L355). Fires `user_line` / `user_call` / `user_return` / `user_exception` → one trace entry per executed line.
- **Every trace entry is a full snapshot, not a diff**:
  ```python
  trace_entry = dict(line, event, func_name,
                     globals, ordered_globals,
                     stack_to_render,   # ALL live frames, each with encoded_locals + ordered_varnames
                     heap,              # object graph keyed by stable small IDs (aliasing via id())
                     stdout)            # CUMULATIVE output buffer so far
  ```
- **Variable visibility is decided backend-side**, then rendered verbatim:
  - `IGNORE_VARS = {__builtins__, __name__, __exception__, __doc__, __package__}` filtered everywhere.
  - Per-frame `encoded_locals` + `ordered_varnames` (co_varnames first, then alpha, `__return__` last).
  - Parent-frame redundancy eliminated — a local identical to a lexical parent's var is not re-shown.
  - Frames keyed by backend-computed `unique_hash` (`func_f<frame_id>_p/_z`) so recursion/closure frames are distinct identities.
  - Optional `#pythontutor_hide:` comment hides specific vars.
- **Heap**: `pg_encoder.py` maps `id()` → small stable IDs (persisting across the whole run) so aliasing is visible: two vars pointing at the same object render one heap box with two pointers. Full heap re-encoded every step (mutations = new heap).
- **Step semantics**: bdb fires *before* the line executes → the trace's `line` is "next line to execute". Consecutive same-line events are deduped.
- **Why the C-instrumented CPython existed**: the `f_valuestack` patch (exposes the interpreter's raw evaluation stack) and the Py2crazy fork (bytecode-level column/extent info via a custom disassembler) let it see objects **not bound to names** — e.g. the list being built inside a list comprehension. **Not used on pythontutor.com since ~2018** — a footnote, not the goal.

### 1.2 Frontend rendering (`v5-unity/js/pytutor.ts`)

- **Navigation**: `curTrace[curInstr]` array; `stepForward/stepBack/renderStep`; slider → `renderStep(ui.value)` (O(1) index jump, full re-render). Bidirectional, instant.
- **Variable visibility**: one **globals frame** + **every frame in `stack_to_render`**, each with its own var table. Never "only the top frame".
- **Value change over time**: honest finding — **Python Tutor has no diff/mutation-arrow mechanism either.** Every step re-renders the whole heap; change is communicated by (a) the two-arrow line highlight and (b) the highlighted active frame (`is_highlighted`, light blue). Layout constancy (`precomputeCurTraceLayouts`) keeps objects from jiggling so the eye sees what changed. Aliasing highlights on hover.
- **Incremental output**: `ProgramOutputBox.renderOutput(curTrace[curInstr].stdout)` — each entry carries the *cumulative* stdout string; the panel shows only what's printed *so far*. A string swap per step, not a stream.
- **Step highlighting**: `CodeDisplay` draws **two gutter arrows** — light-green "line that just executed" (prev) and red "next line to execute" (cur), with a legend. Return lines map back to the call site. Exception entries get red borders + `exception_msg` in an error pane.
- **Call stack**: every frame rendered with its locals, `__return__` shown as "Return value", zombie frames (cumulative mode) dimmed with dotted borders.

**Mental model**: Python Tutor = *interpreter-level, snapshot-per-line, full-frame + heap + stdout*. The frontend is a dumb renderer.

---

## 2. How DSA Visualiser actually works (evidence-based)

From the source + an empirical run of the instrumenter on `backend/tests/fixtures/simple_bsearch.cpp` (compiled injected output, captured real trace). Pipeline: `libclang AST walker → injector (injects __TRACE_* calls) → g++ -O0 → TRACE: JSON lines on stderr → parser → NDJSON stream → React frontend`.

Trace contract (`new_plan.md` §6, live in `backend/app/core/instrumenter/tracer.h`):
```
TRACE:{"t":"enter","l":5,"f":"bsearch","d":0,"p":{...}}   # FUNC_ENTER: params
TRACE:{"t":"state","l":7,"f":"bsearch","d":0,"v":{"arr":...,"lo":0,"hi":4}}  # STATE: all in-scope vars
TRACE:{"t":"branch","l":9,"f":"bsearch","d":0,"c":"arr[mid] == target","tk":false}
TRACE:{"t":"iter","l":7,"f":"bsearch","d":0,"it":0}
TRACE:{"t":"exit","l":9,"f":"bsearch","d":0,"r":3}
```

What the empirical trace **actually showed** for that binary search (14 events total):

```
state l7   v:{arr, target, lo:0, hi:4}     ← pre-loop
iter  l7   it:0
branch l9  arr[mid]==target → false        ← mid=2, arr[2]=5
state l7   v:{arr, target, lo:3, hi:4}     ← lo changed by line 10, but line 10 has NO state!
iter  l7   it:1
branch l9  → true
exit  l9   r:3
state l17  v:{}                            ← EMPTY: arr declared on line 17
state l18  v:{arr}                         ← result MISSING: declared on line 18
state l19  v:{arr, result:3}
```

---

## 3. The gap analysis — mapped to the four questions

### Gap A — "Which variables are visible"

| Python Tutor | DSA Visualiser | Why |
|---|---|---|
| Full call stack with **per-frame locals + globals** every step | **Flat vars of current function only**; globals never captured | `scope_tracker` walks only function bodies; STATE emits a flat dict |
| Backend filters (IGNORE_VARS, parent-frame dedup, ordered names) | Frontend renders `Object.entries(vars)` verbatim — no filtering | No filtering logic anywhere |
| Frames keyed by unique_hash (recursion/closure-safe) | CallStackView shows names/depth only, no per-frame vars | Data model has no per-frame tables |
| **Off-by-one in the scope snapshot**: STATE fires *after* a statement but captures *pre-declaration* visibility | `int result = bsearch(...)` STATE omits `result`; `int lo=0,hi=...` STATE omits `lo/hi` | `scope_tracker` records `vars_at_line` *before* processing the DECL_STMT (`ast_walker.py:333-345`, `injector.py:65-75`) |

**The single biggest visibility bug**: `mid` (declared on line 8, *inside* the while body) **never appears in any state** — because STATE is injected per *unique top-level line of the function body*, and statements nested inside loop/if bodies get BRANCH/LOOP_ITER but **no STATE**. For DSA, the most interesting work happens inside loops. This is gap #1 to fix.

### Gap B — "How variables change over time"

| Python Tutor | DSA Visualiser |
|---|---|
| Heap with object identity → aliasing visible, mutations = new heap snapshot, layout constancy keeps the eye on what changed | **No object identity** — pointers serialize as `{"$addr":"0x..."}` only. `serializer_gen.py` (planned in `new_plan.md`, referenced in `tracer.h`) **doesn't exist** → `TreeNode*` / `ListNode*` vars render as opaque address strings; LinkedListVisual/StructGraphVisual are dead code awaiting backend support |
| No diff markers — change via re-render + line arrows | Change via `JSON.stringify` whole-value comparison (`frontend/src/components/StatePanel/StatePanel.tsx:81-84`) — marks the *entire variable* changed on any deep mutation; can't pinpoint an element |

The frontend diff is actually *more* explicit than Python Tutor for scalar changes — but it's shallow (whole-value) and meaningless for structures, because the structure data isn't there.

### Gap C — "Incremental output display"

| Python Tutor | DSA Visualiser |
|---|---|
| `stdout` field in **every** trace entry (cumulative buffer) → output panel grows as you step | stdout arrives **once**, as a string on the final `cfg` NDJSON chunk (`backend/app/api/routes/execute.py:132-142`), shown as a static banner (`frontend/src/App.tsx:145-149`). **No per-step output exists in the protocol** — impossible to render incrementally without a backend change |

### Gap D — "Calculation steps highlighting / what's happening each step"

| Python Tutor | DSA Visualiser |
|---|---|
| Two-arrow gutter (prev=light-green "just executed", cur=red "next to execute") + legend + return-line mapping + exception borders + frame highlight | Single Monaco whole-line decoration at `currentEvent.line` (`frontend/src/components/Editor/CodeEditor.tsx:67-93`). No prev/cur semantics, no return-site mapping, no exception styling on the line |
| Branch conditions evaluated live; `event` types include exception/uncaught_exception | Branch carries condition text + bool only — no **operand values** (`i < n` → `3 < 5 = true` missing) |
| Expression-level column info existed in the C-fork experiments | `int x = a + b*c;` = 1 step; no sub-expression steps, no intermediate values |
| — | Differentiator: **CFG/flowchart + container visuals** (Vector/Stack/Queue/Heap visuals, React Flow CFG) — Python Tutor has none of these. Keep it |

---

## 4. The plan — 4 phases, ordered by leverage ÷ cost

All backend-first; each phase unlocks frontend wins. Reference paths are real files in this repo.

### Phase 1 — Cheap, high-impact (backend parser + injector, no schema break)

1. **Fix nested-statement tracing** (fixes Gap A, the `mid` bug). In `backend/app/core/instrumenter/ast_walker.py` `_walk_stmt`, inject STATE at statement level inside compound bodies (loop/if/else), not just unique top-level lines. This is where DSA steps actually live.
   - *Verify*: `mid` appears in trace for `simple_bsearch.cpp`.
2. **Fix post-declaration scope snapshot** (fixes Gap A off-by-one). In `scope_tracker`/`injector`, add vars declared on the current line *before* emitting the STATE for that line.
   - *Verify*: `result` present in the l18 state.
3. **Capture globals**. `scope_tracker` also walks top-level declarations; STATE (or a separate globals field) includes them.
4. **Synthesize per-step explanation in the parser** (directly answers "what's actually happening in each step"). From event type + payload, generate a description string per step: *"Entered solve (depth 1, n=5)"*, *"Branch l16: 3 < 5 → true, iter 2"*, *"result = 15 ← returned from bsearch"*. One field added to the trace event; frontend renders it under the panel header. **Python Tutor has no equivalent — a differentiator for a DSA learning tool.**

### Phase 2 — Medium cost, unlocks the Python-Tutor-style UI

5. **Reconstruct `stack_to_render` in the parser** (fixes per-frame visibility). FUNC_ENTER/EXIT already arrive in order — the parser can build the live call stack per step, keeping last-known vars per frame, exactly like `pg_logger`'s `stack_to_render`. **No injection change needed.** Frontend then renders: globals frame + each frame's own var table (keyed by `func + frame_id`), like Python Tutor.
6. **Incremental stdout** (fixes Gap C). At program start, redirect stdout to a temp file (handles both `cout` and `printf`); each trace event reads the file's bytes-since-last-read and appends to a cumulative `stdout` field in the event. Protocol change: add `stdout` to trace entries; frontend renders a ProgramOutputBox-style panel driven by `curTrace[curInstr].stdout`.
7. **Two-arrow line highlight** (fixes Gap D). The parser already knows prev/cur line per step (prev = previous event's line). Monaco supports gutter decorations — render the Python-Tutor pair: executed (light) + next (dark red), plus red border on exception lines. Return lines map to the call site via FUNC_ENTER/EXIT.
8. **Branch operand values**. In `tracer.h` BRANCH emission, serialize the condition's operand values alongside the text: `c:"i < n", ops:{i:3, n:5}, tk:true` → frontend tooltip/step line: `3 < 5 → true`.

### Phase 3 — The big lift: heap object identity

9. **Build `serializer_gen.py`** (already in the plan, never built). Generate per-struct serializers that emit **object IDs + fields + pointer edges** instead of `$addr` strings: each `TreeNode*` → `{"$id": 3, "val":5, "left": {"$ref":7}, "right":null}`. Give containers IDs too.
10. **Parser builds a heap table** (id → object, refs as edges), mirroring `pg_encoder`'s small-ID scheme. Then the frontend can render a **heap panel** with aliasing (two vars → same `$id`) and **per-object mutation flash** (diff heap by `$id` between steps — proper change-over-time, replacing the whole-value stringify diff). This unlocks LinkedListVisual/StructGraphVisual/MultiStructureSyncView — all **already built and registered but dead**, awaiting exactly this backend data.

### Phase 4 — Polish (optional, cheap)

11. Expression-level steps for simple statements (`int x = a + b*c` → emit `b*c` temp then assignment) — the injector already wraps return exprs in temps (`__trace_ret_0`), same pattern. Python Tutor's deployed site doesn't do this either; optional.
12. Reconsider compression UX: grouped-identical-states collapse hides steps Python Tutor keeps visible (it dedups same-line but they're still scrubbable). Keep collapse, but make `next/prev` land on group boundaries with a visible "N identical steps" affordance (partially present — verify it doesn't skip silently).

---

## 5. Bottom line

- **Why is ours not like Python Tutor?** (1) *Language/mechanism*: interpreter-level tracing vs. static source instrumentation — the visualiser must manually capture what Python Tutor gets free. (2) *Diverged plan*: `new_plan.md` intended per-statement STATE, serializer_gen, globals, incremental output — the implementation shipped line-level STATE, no serializer_gen, no globals, terminal-only stdout. (3) *Data model*: flat current-function snapshots without frame tables or object IDs make per-frame panels, aliasing, mutation identity, and incremental output *structurally impossible* until the protocol changes.
- **The 80/20**: Phases 1–2 (steps 1–8) deliver ~80% of the Python-Tutor experience — correct per-step variables, per-frame panels, incremental output, two-arrow step highlighting, and step explanations — with modest, well-scoped changes and no new dependencies. Phase 3 (heap identity) is the remaining 20% that makes the structure visuals actually live.
- **Unfair advantages to keep**: the CFG flowchart, container visuals, and streaming NDJSON — Python Tutor has none of these. The goal isn't to clone it; it's to borrow its *data model* (snapshot-per-step: frames + heap + stdout) and layer the richer visuals on top.

---

## Appendix — Evidence references

### DSA Visualiser (this repo)
- `backend/app/core/instrumenter/ast_walker.py` — `_walk_cursor` per-unique-line STATE injection (L333-345); `_walk_stmt` BRANCH/LOOP_ITER/FUNC_EXIT (no nested STATE); depth BFS (L150-185)
- `backend/app/core/instrumenter/injector.py` — `_trace_state` flat in-scope vars merge (L65-75)
- `backend/app/core/instrumenter/scope_tracker.py` — per-line visible vars, pre-declaration semantics
- `backend/app/core/instrumenter/tracer.h` — TRACE: stderr contract; generic pointer fallback `{"$addr":"0x…"}` (L305-322); serializer_gen referenced but absent
- `backend/app/core/trace/parser.py` — event parse, dynamic depth recompute (L75-90), identical-state compression (L98-152)
- `backend/app/api/routes/execute.py` — NDJSON streaming; stdout only on final `cfg` chunk (L132-142)
- `frontend/src/components/StatePanel/StatePanel.tsx` — verbatim vars render (L25-41); `JSON.stringify` change diff (L81-84); buildHighlightMap (L107-124)
- `frontend/src/components/Editor/CodeEditor.tsx` — single whole-line Monaco decoration (L67-93)
- `frontend/src/components/ContainerVisuals/registry.tsx` + `useContainerType.ts` — shape heuristics, dead `multi_structure`/struct paths
- `frontend/src/store/traceStore.ts` — flat trace array, compression groups (L96-139)
- `new_plan.md` — original intent: per-statement STATE, serializer_gen.py, globals, incremental output (§5.1, §7)

### Python Tutor (public mirrors)
- `ajesse11x/OnlinePythonTutor` @ `1d6c06f` — `v5-unity/pg_logger.py` (`PGLogger(bdb.Bdb)` L491; `interaction()` L757-804; trace entry L1202-1219; `IGNORE_VARS` L288; `filter_var_dict` L401-406; `create_encoded_stack_entry` L914-962; `unique_hash` L1169-1184; zombie frames L1129-1160)
- `v5-unity/pg_encoder.py` — `ObjectEncoder` L163; id→small-ID L181-182; full heap per step via `reset_heap()`
- `v5-unity/js/pytutor.ts` — `ExecutionVisualizer` L83; `DataVisualizer` L1093; `ProgramOutputBox` L3113; `CodeDisplay` two-arrow gutter L3185-3554; `NavigationController` L3559-3664
- `CPython 3.12 Lib/bdb.py` L355 — `sys.settrace(self.trace_dispatch)`
- Live `pythontutor.com/build/visualize.bundle.js` — 1.38 MB, no React/Redux markers (verified)

### Research method note
The canonical `pgbovine/OnlinePythonTutor` returns 404 (private since ~Aug 2020). All Python Tutor findings were verified against the two public mirrors above plus the live served bundle. Empirical DSA Visualiser findings came from compiling the injected `simple_bsearch.cpp` and capturing the actual runtime trace.

---

## Status update — 2026-09-15 (loop-scope fixes R1–R6 landed)

The following Gap A items described above as open are now FIXED (see research `dsa-visualiser-cpp-viz-improvements/follow-ups/01-for-loop-scope-vanish-intuitive-display/`):
- **Post-declaration off-by-one (§3 item 2, §4 line 98)**: `scope_tracker` now records post-declaration visibility — `int mid` / `int lo,hi` appear in their own line's STATE (`tests/test_scope_loops.py`).
- **Range-for loops**: `CXX_FOR_RANGE_STMT` handled as a first-class loop (scope + STATE + LOOP_ITER) in `scope_tracker.py`/`ast_walker.py`. STL-header range-for still needs the toolchain pin (W0.1, GCC16 vs libclang 18 `stddef.h` gap).
- **Braceless loop/if bodies**: single-statement bodies now get scope entries; braceless loops intentionally emit no LOOP_ITER (single statement = single step, STATE covers it).
- **Return / pre-`else` lines**: STATE snapshot emitted before the return instead of silently dropped.
- **Frontend blank steps**: `iter`/`branch`/`exit` steps now forward-fill the last live same-frame snapshot, rendered dimmed with a `showing last state · step k` caption (`src/utils/scopeDisplay.ts`); diffs computed live-vs-last-live; index highlight generalized beyond `mid/lo/hi` (`mid → lo → hi → i → j → k → left → right → …`); added (emerald `new`) / changed (amber) / removed (one-step ghost) row treatments.

Still open from this doc: globals capture (§3 item 3), per-frame `stack_to_render` panels (§3 item 6 / R2), incremental stdout (§3 item 7 / R4), two-arrow gutter (§3 item 7 / R5), step explanations (§3 item 4), serializer_gen / heap identity (Phase 3).
