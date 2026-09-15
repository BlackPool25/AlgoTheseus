# Trace Schema v2 (additive-only)

Version: v2 · Status: contract · Supersedes: nothing (v1 stays valid forever).

## Additive-only guarantee

Schema v2 **MUST NOT rename or remove any existing field**. Every addition
below is **optional-only**: absent on the wire means "not recorded", and every
consumer must behave exactly as it did on a v1 trace when a v2 field is
missing. Old fixtures without any v2 field parse, validate, and render
(flat fallback) with zero exceptions — locked by
`backend/tests/test_trace_schema_v2_compat.py`.

Wire aliases stay short-key style (`t`/`l`/`f`/`d` + per-event keys) to match
`tracer.h`. Canonical field names and their aliases:

| Canonical | Alias | Event | Type | Default (absent) |
|---|---|---|---|---|
| `stdout` | `o` | STATE | `str \| None` | `None` |
| `stdout_truncated` | `o_tr` | STATE | `bool` | `False` |
| `globals` | `g` | STATE | `dict[str, Any] \| None` | `None` |
| `step_desc` | `sd` | STATE/BRANCH/ENTER/EXIT | `str \| None` | `None` |
| `prev_line` | `pl` | STATE | `int \| None` | `None` |
| `ops` | `op` | BRANCH | `list[str] \| None` | `None` |
| `return_line` | `rl` | EXIT | `int \| None` | `None` |
| `heap` | `h` | per-step (STATE) | `dict[str, Any] \| None` | `None` |

## Per-event additions

### STATE (+`stdout`/+`globals`/+`step_desc`/+`prev_line`)

- `stdout` (`o`): program stdout captured up to and including this step.
- `stdout_truncated` (`o_tr`): `True` iff `stdout` was cut by the cap below.
  Always present-with-default `False`; never `None`.
- `globals` (`g`): global-scope variables snapshot at this step
  (locals stay in `vars`).
- `step_desc` (`sd`): one-line human description of the step
  (e.g. `"assign x = 2"`).
- `prev_line` (`pl`): source line of the previous executed step
  (enables back-edge / fall-through rendering).

### Per-event stdout cap: 64 KB + `stdout_truncated`

- A single event's `stdout` payload is capped at **64 KB (65536 bytes, UTF-8)**.
- When the captured output exceeds the cap, the producer truncates to the
  first 65536 bytes (never splitting mid-code-point) and sets
  `stdout_truncated: true`.
- Consumers must show a "output truncated" affordance whenever
  `stdout_truncated` is `True`, even if `stdout` itself is short/empty.

### BRANCH (+`ops`/+`step_desc`)

- `ops` (`op`): operand values/texts of the branch condition at this step
  (e.g. `["x=2", "0"]` for `x > 0`).
- `step_desc` (`sd`): one-line description (e.g. `"branch taken: x > 0"`).

### ENTER (+`step_desc`)

- `step_desc` (`sd`): one-line description (e.g. `"call solve(n=5)"`).

### EXIT (+`step_desc`/+`return_line`)

- `step_desc` (`sd`): one-line description (e.g. `"return 0"`).
- `return_line` (`rl`): source line of the `return` statement that produced
  this exit (vs `line`, which is the function-entry line echo).

## Per-step `heap` table + `$id`/`$ref` section

- `heap` (`h`, on STATE steps): object-identity table for pointer/reference
  visualisation. Keys are heap-object ids (`"$1"`, `"$2"`, …); values are the
  serialised object snapshots.
- Object references inside `vars`/`globals` use `{"$ref": "$1"}` pointers;
  the canonical definition of an object carries `"$id": "$1"`.
- Consumers resolve `$ref` against the **current step's** `heap` table only
  (tables are per-step snapshots, not cumulative). A dangling `$ref`
  (id missing from the step's `heap`) renders as "unknown" — never throws.

## Adaptive stdout granularity rule

Producers choose stdout granularity by total step count:

- **≤ 2000 steps**: per-event `stdout` allowed on every STATE event.
- **> 2000 steps**: `stdout` is emitted **only at loop-boundary steps**
  (first/last iteration events and loop-exit state); all other STATE events
  omit `stdout` (absent, not empty).
- The 64 KB per-event cap applies in both modes; loop-boundary snapshots in
  large traces are still individually capped with `stdout_truncated` set.

## Compression compatibility

`frontend/src/store/traceStore.ts` `rebuildCompression` keys grouping only on
`event.type === "state"` plus `vars` equality (and backend `group_count`
metadata). All v2 fields are ignored by the grouping key, so compression
output is byte-identical for v1 and v2 traces with equal `vars` sequences.
