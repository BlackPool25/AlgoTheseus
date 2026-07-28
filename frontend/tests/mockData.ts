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
}

export interface MockFuncExitEvent {
  type: "exit";
  line: number;
  func: string;
  depth: number;
  return_val: unknown;
}

export interface MockStateEvent {
  type: "state";
  line: number;
  func: string;
  depth: number;
  vars: Record<string, unknown>;
}

export interface MockBranchEvent {
  type: "branch";
  line: number;
  func: string;
  depth: number;
  condition: string;
  taken: boolean;
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
): string {
  const lines: string[] = [];
  for (const ev of events) {
    lines.push(JSON.stringify({ type: "event", data: ev }));
  }
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
