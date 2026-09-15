/**
 * tests/mockData.ts — Mock API responses for Playwright visual tests.
 *
 * The app uses NDJSON streaming (streamExecute).  Each factory returns a
 * complete NDJSON string: one line per trace event + one final cfg line.
 */

// ── Trace event types ─────────────────────────────────────────────

export interface MockFuncEnterEvent {
  type: "enter";
  line: number;
  func: string;
  depth: number;
  params: Record<string, unknown>;
  step_desc?: string | null;
}

export interface MockFuncExitEvent {
  type: "exit";
  line: number;
  func: string;
  depth: number;
  return_val: unknown;
  step_desc?: string | null;
  return_line?: number | null;
}

export interface MockStateEvent {
  type: "state";
  line: number;
  func: string;
  depth: number;
  vars: Record<string, unknown>;
  step_desc?: string | null;
  globals?: Record<string, unknown> | null;
  stdout?: string | null;
  stdout_truncated?: boolean;
  prev_line?: number | null;
  heap?: Record<string, unknown> | null;
  heap_diff?: {
    added: string[];
    removed: string[];
    mutated: string[];
    changed_fields: Record<string, string[]>;
  } | null;
}

export interface MockBranchEvent {
  type: "branch";
  line: number;
  func: string;
  depth: number;
  condition: string;
  taken: boolean;
  step_desc?: string | null;
}

export type MockTraceEvent =
  | MockFuncEnterEvent
  | MockFuncExitEvent
  | MockStateEvent
  | MockBranchEvent;

// ── Step indices (used by visual.spec.ts) ─────────────────────────
// clang-format off
export const STEPS = {
  ENTER_MAIN: 0,
  VECTOR: 1,
  MAP: 2,
  STACK: 3,
  QUEUE: 4,
  GRID: 5,
  DP_TABLE: 6,
  GRAPH: 7,
  TRIE: 8,
  LINKED_LIST: 9,
  HEAP: 10,
  MULTI_STRUCTURE: 11,
  BRANCH: 12,
  COMPRESSED_A: 13,
  COMPRESSED_B: 14,
  EXIT: 15,
  TOTAL: 16,
} as const;
// clang-format on

// ── NDJSON builder ────────────────────────────────────────────────

const BASE_CFG = {
  cfg_nodes: [
    { id: "n0", type: "func_start", lines: [53], label: "main()", children: ["n1"], trace_indices: [0] },
    { id: "n1", type: "line", lines: Array.from({ length: 11 }, (_, i) => 54 + i), label: "body", children: ["n2"], trace_indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { id: "n2", type: "branch", lines: [5], label: "arr[mid] == target", children: ["n3", "n4"], trace_indices: [12] },
    { id: "n3", type: "line", lines: [6], label: "found", children: ["n5"], trace_indices: [13, 14] },
    { id: "n4", type: "line", lines: [8], label: "not found", children: ["n5"], trace_indices: [] },
    { id: "n5", type: "func_end", lines: [15], label: "return 0", children: [], trace_indices: [15] },
  ],
  cfg_edges: [
    { source: "n0", target: "n1", label: "" },
    { source: "n1", target: "n2", label: "" },
    { source: "n2", target: "n3", label: "true" },
    { source: "n2", target: "n4", label: "false" },
    { source: "n3", target: "n5", label: "" },
    { source: "n4", target: "n5", label: "" },
  ],
};

function buildNDJSON(
  events: MockTraceEvent[],
  meta: {
    stdout?: string;
    runtime_error?: string | null;
    timed_out?: boolean;
    truncated?: boolean;
    total_steps?: number;
    cfg_nodes?: unknown[];
    cfg_edges?: unknown[];
  },
  omitCfg = false,
): string {
  const lines: string[] = [];
  for (const ev of events) {
    lines.push(JSON.stringify({ type: "event", data: ev }));
  }
  if (!omitCfg) {
    lines.push(
      JSON.stringify({
        type: "cfg" as const,
        stdout: meta.stdout ?? "",
        runtime_error: meta.runtime_error ?? null,
        timed_out: meta.timed_out ?? false,
        truncated: meta.truncated ?? false,
        cfg_nodes: meta.cfg_nodes ?? BASE_CFG.cfg_nodes,
        cfg_edges: meta.cfg_edges ?? BASE_CFG.cfg_edges,
        total_steps: meta.total_steps ?? events.length,
      }),
    );
  }
  // Trailing newline is critical — the stream reader's split() + pop()
  // discards the last line otherwise, losing the cfg chunk.
  return lines.join("\n") + "\n";
}

// ── Public factories ──────────────────────────────────────────────

const FULL_TRACE: MockTraceEvent[] = [
  { type: "enter", line: 53, func: "main", depth: 1, params: {} },
  { type: "state", line: 54, func: "main", depth: 1, vars: { arr: [1, 3, 5, 7, 9, 11, 13] } },
  { type: "state", line: 55, func: "main", depth: 1, vars: { myMap: { apple: 5, banana: 3, cherry: 8 } } },
  { type: "state", line: 56, func: "main", depth: 1, vars: { stk: { top: 42, items: [42, 17, 8, 3] } } },
  { type: "state", line: 57, func: "main", depth: 1, vars: { q: { front: 10, items: [10, 20, 30, 40, 50] } } },
  { type: "state", line: 58, func: "main", depth: 1, vars: { board: [[0, 1, 0, 0], [1, 1, 1, 0], [0, 1, 0, 1], [0, 1, 1, 1]] } },
  { type: "state", line: 59, func: "main", depth: 1, vars: { dp: { _type: "dp_table", data: [[0, 1, 2], [3, 4, 5], [6, 7, 8]], current_cell: [1, 1], formula: "dp[i][j]=min(dp[i-1][j],dp[i][j-1])+cost", dependencies: [[-1, 0], [0, -1]] } } },
  { type: "state", line: 60, func: "main", depth: 1, vars: { graph: { _type: "graph", adj: [[1, 2], [0, 3, 4], [0, 5], [1], [1], [2]] } } },
  { type: "state", line: 61, func: "main", depth: 1, vars: { trieVar: { _type: "trie", root: { edges: { c: { ch: "c", edges: { a: { ch: "a", isEnd: true, edges: { t: { ch: "t", isEnd: true } } } } } } } } } },
  { type: "state", line: 62, func: "main", depth: 1, vars: { list: { val: 1, $addr: "0x100", next: { val: 2, $addr: "0x200", next: { val: 3, $addr: "0x300", next: null } } } } },
  { type: "state", line: 63, func: "main", depth: 1, vars: { pq: { _type: "pq", top: 100, items: [100, 50, 30, 20, 15, 10, 5] } } },
  { type: "state", line: 64, func: "main", depth: 1, vars: { multiView: { _type: "multi_structure", structures: [{ name: "adj", value: { _type: "graph", adj: [[1], [0, 2], [1]] }, kind: "graph", label: "Adjacency" }, { name: "queue", value: { front: 1, items: [1, 2, 3, 4] }, kind: "queue", label: "BFS Queue" }], connections: [{ source: "adj", target: "queue", label: "BFS" }] } } },
  { type: "branch", line: 5, func: "main", depth: 1, condition: "arr[mid] == target", taken: false },
  { type: "state", line: 7, func: "main", depth: 1, vars: { lo: 0, hi: 3, mid: 1 } },
  { type: "state", line: 7, func: "main", depth: 1, vars: { lo: 0, hi: 3, mid: 1 } },
  { type: "exit", line: 15, func: "main", depth: 1, return_val: 0 },
];

/** Comprehensive NDJSON response with all visual component shapes. */
export function createMockNDJSON(): string {
  return buildNDJSON(FULL_TRACE, { stdout: "Found at index: 3\n" });
}

/** NDJSON with a 150-element vector for virtualization testing. */
export function createLargeVectorNDJSON(): string {
  const largeVec = Array.from({ length: 150 }, (_, i) => i * 2);
  return buildNDJSON(
    [
      { type: "enter", line: 1, func: "main", depth: 1, params: {} },
      { type: "state", line: 2, func: "main", depth: 1, vars: { largeArr: largeVec } },
      { type: "exit", line: 3, func: "main", depth: 1, return_val: 0 },
    ],
    {
      stdout: "",
      cfg_nodes: [
        { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
        { id: "n1", type: "line", lines: [2], label: "body", children: ["n2"], trace_indices: [1] },
        { id: "n2", type: "func_end", lines: [3], label: "return 0", children: [], trace_indices: [2] },
      ],
      cfg_edges: [
        { source: "n0", target: "n1", label: "" },
        { source: "n1", target: "n2", label: "" },
      ],
    },
  );
}

/** NDJSON with N identical state events for compression testing. */
export function createCompressedNDJSON(count: number): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
  ];
  for (let i = 0; i < count; i++) {
    events.push({
      type: "state", line: 2, func: "main", depth: 1,
      vars: { x: 42, y: "hello" },
    });
  }
  events.push({ type: "exit", line: 3, func: "main", depth: 1, return_val: 0 });
  return buildNDJSON(events, { stdout: "", total_steps: events.length });
}

/** NDJSON error chunk for compile-error testing. */
export function createCompileErrorNDJSON(): string {
  // Trailing newline needed — stream reader drops last line otherwise
  return JSON.stringify({
    type: "error",
    compile_error: "test.cpp:12: error: expected ';'",
  }) + "\n";
}

/**
 * NDJSON with v2 `step_desc` on every event + `globals` on state events.
 * Step-0 description is "call main()" for the header assertion.
 */
export function createStepDescNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {}, step_desc: "call main()" },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { x: 2 }, globals: { g: 1 }, step_desc: "assign x = 2",
    },
    {
      type: "branch", line: 3, func: "main", depth: 1,
      condition: "x > 0", taken: true, step_desc: "branch taken: x > 0",
    },
    { type: "exit", line: 4, func: "main", depth: 1, return_val: 15, step_desc: "return 15" },
  ];
  return buildNDJSON(events, { stdout: "", total_steps: events.length });
}

/**
 * NDJSON for T9 phase-2: nested call (main → helper) with per-step
 * cumulative `stdout` + `prev_line` on states + `return_line` on exit.
 * At steps 3-4 the call stack holds 2 frames; stdout grows "a" → "a b" → "a b c".
 */
export function createFrameStdoutNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {}, step_desc: "call main()" },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { x: 1 }, stdout: "a\n", prev_line: 1, step_desc: "assign x = 1",
    },
    { type: "enter", line: 3, func: "helper", depth: 2, params: { n: 5 }, step_desc: "call helper(n=5)" },
    {
      type: "state", line: 4, func: "helper", depth: 2,
      vars: { y: 10 }, stdout: "a\nb\n", prev_line: 3, step_desc: "assign y = 10",
    },
    {
      type: "state", line: 5, func: "helper", depth: 2,
      vars: { y: 11 }, stdout: "a\nb\nc\n", prev_line: 4, step_desc: "assign y = 11",
    },
    { type: "exit", line: 5, func: "helper", depth: 2, return_val: 11, return_line: 3, step_desc: "return 11" },
    { type: "exit", line: 6, func: "main", depth: 1, return_val: 0, step_desc: "return 0" },
  ];
  return buildNDJSON(events, { stdout: "a\nb\nc\n", total_steps: events.length });
}

/**
 * NDJSON for T10 end-to-end wiring: a print-loop whose STATE events carry
 * IDENTICAL vars but GROWING cumulative stdout (plus step_desc/globals on
 * some steps to prove field passthrough). Compression must NOT merge these.
 */
export function createPrintLoopNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {}, step_desc: "call main()" },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { limit: 3 }, stdout: "1\n", prev_line: 1,
      step_desc: "assign limit = 3", globals: { g: 0 },
    },
    {
      type: "state", line: 3, func: "main", depth: 1,
      vars: { limit: 3 }, stdout: "1\n2\n", prev_line: 2,
      step_desc: "state at line 3",
    },
    {
      type: "state", line: 3, func: "main", depth: 1,
      vars: { limit: 3 }, stdout: "1\n2\n3\n", prev_line: 3,
      step_desc: "state at line 3",
    },
    { type: "exit", line: 4, func: "main", depth: 1, return_val: 0, step_desc: "return 0" },
  ];
  return buildNDJSON(events, { stdout: "1\n2\n3\n", total_steps: events.length });
}

/**
 * NDJSON for T10: IDENTICAL vars AND identical stdout, but DIFFERING heap
 * snapshots across steps. Compression must NOT merge these either.
 */
export function createHeapDriftNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {}, step_desc: "call main()" },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { head: { $id: 1 } }, stdout: "",
      heap: { "1": { type: "Node", val: 1 } },
      step_desc: "assign head",
    },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { head: { $id: 1 } }, stdout: "",
      heap: { "1": { type: "Node", val: 2 } },
      step_desc: "assign head",
    },
    { type: "exit", line: 3, func: "main", depth: 1, return_val: 0, step_desc: "return 0" },
  ];
  return buildNDJSON(events, { stdout: "", total_steps: events.length });
}

/**
 * NDJSON for T12 HeapPanel: linked list 1→2→3 across three STATE steps.
 * Heap tables mirror live backend output byte-for-byte (verified via
 * parse() probe: refs are STRINGS matching table keys, scalar `next: null`
 * lands in fields, changed_fields names real fields like ["val"]).
 *
 * Step 1: creation — all three ids added.
 * Step 2: single-field mutation (id "2" val 2→20) — ONLY "2" flashes.
 * Step 3: alias var `alias: {$ref: 2}` (N-inbound on "2" → alias connector)
 *   + self-cycle on "3" (`refs.next === "3"` → $cycle badge).
 */
export function createHeapPanelNDJSON(): string {
  const n = (id: number, addr: string, val: number, next: unknown) => ({
    $id: id,
    $addr: addr,
    val,
    next,
  });
  const e = (
    type: string,
    fields: Record<string, unknown>,
    refs: Record<string, unknown>,
    addr: string,
  ) => ({ type, fields, refs, addr });

  const head1 = n(1, "0x100", 1, n(2, "0x200", 2, n(3, "0x300", 3, null)));
  const head2 = n(1, "0x100", 1, n(2, "0x200", 20, n(3, "0x300", 3, null)));
  // Step 3 head is value-identical to step 2 (cycle/alias live in heap only,
  // exactly like the backend where the table is the source of truth).
  const head3 = n(1, "0x100", 1, n(2, "0x200", 20, n(3, "0x300", 3, null)));

  const heap1 = {
    "1": e("struct", { val: 1 }, { next: "2" }, "0x100"),
    "2": e("struct", { val: 2 }, { next: "3" }, "0x200"),
    "3": e("struct", { val: 3, next: null }, {}, "0x300"),
  };
  const heap2 = {
    "1": e("struct", { val: 1 }, { next: "2" }, "0x100"),
    "2": e("struct", { val: 20 }, { next: "3" }, "0x200"),
    "3": e("struct", { val: 3, next: null }, {}, "0x300"),
  };
  const heap3 = {
    "1": e("struct", { val: 1 }, { next: "2" }, "0x100"),
    "2": e("struct", { val: 20 }, { next: "3" }, "0x200"),
    "3": e("struct", { val: 3 }, { next: "3" }, "0x300"),
  };

  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { head: head1 }, heap: heap1,
      heap_diff: { added: ["1", "2", "3"], removed: [], mutated: [], changed_fields: {} },
    },
    {
      type: "state", line: 3, func: "main", depth: 1,
      vars: { head: head2 }, heap: heap2,
      heap_diff: { added: [], removed: [], mutated: ["2"], changed_fields: { "2": ["val"] } },
    },
    {
      type: "state", line: 4, func: "main", depth: 1,
      vars: { head: head3, alias: { $ref: 2 } }, heap: heap3,
      heap_diff: { added: [], removed: [], mutated: ["3"], changed_fields: { "3": ["next"] } },
    },
    { type: "exit", line: 5, func: "main", depth: 1, return_val: 0 },
  ];
  return buildNDJSON(events, { stdout: "", total_steps: events.length });
}
export function createDroppedStreamNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {}, step_desc: "call main()" },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { x: 1 }, stdout: "partial\n", prev_line: 1,
      step_desc: "assign x = 1",
    },
  ];
  return buildNDJSON(events, { stdout: "partial\n" }, true);
}

/**
 * NDJSON for T12 GridVisual wiring: one cell mutates between steps, proving
 * the previously-dead changingCells/highlightedCells props take effect.
 */
export function createGridMutationNDJSON(): string {
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    {
      type: "state", line: 2, func: "main", depth: 1,
      vars: { board: [[1, 2], [3, 4]] },
    },
    {
      type: "state", line: 3, func: "main", depth: 1,
      vars: { board: [[1, 9], [3, 4]] },
    },
    { type: "exit", line: 4, func: "main", depth: 1, return_val: 0 },
  ];
  return buildNDJSON(events, { stdout: "", total_steps: events.length });
}
