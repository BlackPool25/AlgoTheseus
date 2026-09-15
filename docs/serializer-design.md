# Struct Serializer Design Note (todo 15, T11a)

## Shape (locked for todo 16 — parser consumes exactly this)

Per struct value: `{"$id": int, "$addr": "0x...", <field>: <value>, ...}`.
Pointer field: `{"$ref": int}` (pointee already identified) or full object
(first sighting within this call) or `null`. Cycle re-entry:
`{"$ref": id, "$cycle": true}`. Containers of user structs:
`{"$id": int, "$addr": "0x...", "items": [...]}` (new types only —
`vector<int>` keeps the bare `[...]` shape; existing consumers untouched).

## 1. void*-map stability scheme

Global (per program run) `std::unordered_map<void*,int> __heap_ids` +
counter `__heap_next_id` (starts at 1; 0 reserved = "no identity").
`__heap_id_for(void*)` assigns-or-returns. Stability is per-address,
not per-object: live heap objects keep one `$id` across all STATE events
so todo 16 can diff per-`$id`. Known ceiling: freed-and-reused addresses
can alias a dead id (no free-tracking in v1 —_todo 16 renders
current-step-only, so a dangling `$ref` shows "unknown", never corrupt).

## 2. Visited-set + `$cycle` protocol (recursion guard)

Per top-level `__ser` call a fresh `std::set<void*> visited` is threaded
through. Entry rule: if address ∈ visited → emit `{"$ref":id,"$cycle":true}`
and return (no recursion). Else insert, emit full object, erase on exit.
Depth > 50 → `{"$depth_limit":true}` (inherits tracer.h cap).
Deliberately NO global emitted-set: every STATE re-emits full fields with
the same stable `$id`, so a single-field mutation diffs to exactly one
changed field (R6 drop condition: never `$ref`-collapse repeats across
events, or todo 16 could not flash only the mutated `$id`).

## 3. `$addr` + `$id` dual emission (additive, Metis C6)

Every `$id` object also carries `$addr` (`"0x..."` string, same format as
the tracer.h `__ser_ptr` fallback). Old `$addr`-only consumers keep
working byte-for-byte; new consumers key on `$id`. No renames, no removed
keys. Parser/frontend untouched (todos 16/17 own those).

## 4. Container `$id` policy

Only containers of user-struct types get the `{"$id",...,"items"}`
envelope, via explicit `__ser` specializations for
`std::vector<T>` / `std::vector<T*>` per struct T. All existing container
shapes (`vector<int>` → `[...]`, map/set/pq envelopes) are byte-identical.
Containers of scalars never gain `$id` (identity is meaningless there;
todo 16 keys heap rows off struct `$id`s only). Other STL containers of
structs (map/set/deque/queue) are future work — elements still carry `$id`
through the existing generic serializers via ADL, only the envelope stays
unwrapped.

## 5. AST field-name cross-check + `{"structs": []}` fallback

`serializer_gen.collect_structs()` walks libclang AST for RECORD_DECL
(struct/class) definitions in user code only (same `_is_user_code` rule as
ast_walker: location file == source path; skips macro expansions,
template instantiations, STL). Field list = FIELD_DECL spellings in order
+ a pointer/reference flag per field from the canonical type spelling.
The generator emits a serializer ONLY for structs whose field list
parses cleanly; on ANY mismatch (unresolvable type, anonymous field,
bitfield, union member — see §6) that struct is skipped. If zero structs
qualify, `manifest()` returns `{"structs": []}` and the emitted C++ is a
comment-only stub: compilation and existing `$addr` behavior unchanged.
Field names in C++ output are string literals taken verbatim from the AST
— never interpolated from unvalidated input; names are additionally
gated by `^[A-Za-z_][A-Za-z0-9_]*$` before emission.

## 6. Carve-outs (explicitly out of scope)

- **Natvis-cycle**: Natvis-style visualizers recurse on cyclic graphs and
  hang without a visited set. Answered by §2 (visited-set + `$cycle` +
  depth-50 cap). Self-review: every recursive path in the generated code
  passes through the visited check — there is no field-emission path that
  recurses without it (pointer fields go through `__ser_ptr_with_id`,
  value-struct fields through `__serialize_T` which checks on entry).
- **Unions / type-puns**: `union` RECORDs are skipped by the collector
  (active-member ambiguity makes field emission unsound); structs
  containing anonymous unions or reached via `reinterpret_cast`/memcpy
  type-puns serialize by address identity only (`$id`+`$addr`, fields
  still emitted from the static type — documented as best-effort, never
  trusted for punned memory). Bitfields are skipped (address-taking is
  illegal). Polymorphic base-derived slicing: serializer is generated per
  static struct type; derived extras behind a base pointer are not
  fabricated — the object emits under its static type with its `$id`.
- **R6/R7**: lazy/opt-in rendering and scale SLOs belong to todos 16/17
  and the perf lane; this unit only guarantees bounded output per object
  (depth cap + cycle marker) and additive keys.

## 7. Emission hookup (minimal, macro-safe)

`injector.instrument()` appends `generate_serializers(source_path)` output
at END of file (after user code, so struct types are complete) — no new
trace calls, no macro-argument commas (generated code is top-level
function definitions only). Lookup works via ADL: user structs live in
the global namespace, so dependent `__ser` calls inside tracer.h templates
find the generated global overloads at instantiation; vector
specializations take effect before the end-of-TU instantiation point.
Proven by compile-run tests, not by appeal to the standard.
