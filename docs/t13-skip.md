# T13 OPTIONAL — Expression-temp steps: SKIP decision (todo 27)

**Status:** SKIPPED (deliberate, LIGHT rigor) — do not re-open without new evidence.
**Date:** 2026-09-15 · branch `feat/dsa-visualiser-improvements` · worktree only.

## Proposal
Wrap simple-assignment RHS temps (`int x = a + b*c` → temp step + assign step),
reusing the `__trace_ret_N` return-expr pattern in
`backend/app/core/instrumenter/injector.py`, with RED-first
`test_expression_temp_injected` and an `x = x + 1` single-assignment probe.

## Decision: skip. Concrete cost reason
1. **T1/T2 semantic risk (decisive).** The return-expr temp is safe because
   `return` is terminal — the temp dominates one exit. An assignment temp
   (`auto __t = (rhs); x = __t;`) sits mid-flow and changes semantics for:
   - side-effecting RHS (`x = f() + g()` — evaluation-order/sequence-point
     visibility changes under tracing),
   - self-reference (`x = x + 1` — must prove single-apply; the probe alone
     doesn't cover `x += …`, `x++`, chained `a = b = expr`, or destructuring),
   - `auto`/narrowing/overload deduction (`auto __t = (rhs)` can deduce a
     different type than the declared `x`, e.g. narrowing, references,
     `const`, operator overloads).
   Fixing each means type-aware rewriting in `ast_walker` + `injector` —
   multi-point surgery across ≥2 files for an OPTIONAL visual nicety.
2. **Surgery budget exceeded.** Task cap is ~1 file of cheap work; a correct
   implementation touches `ast_walker.py` (new injection kind/points),
   `injector.py` (rewrite, not just insert), and new tests + fixtures.
3. **Marginal value.** Post-statement `__TRACE_STATE` already snapshots the
   assigned value (verified below); the temp would only expose the
   *intermediate* of one expression — nice, not needed.

## Baseline evidence (current behavior, unchanged)
`int x = a + b * 2;` → single statement + one post `__TRACE_STATE` showing `x`;
`x = x + 1;` → single `__TRACE_STATE`; no `__trace_ret_*`/`__expr_tmp` emitted
for assignments. Full output captured in
`.omo/evidence/task-27-dsa-visualiser-improvements.log`.

## Re-open only if
A concrete user-facing trace gap is filed AND a libclang-typed rewrite design
(type-preserving temp with `decltype`-style deduction) is approved. Until then,
Waves 1–3 (T1/T2) stay untouched and green.
