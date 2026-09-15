/**
 * bench/scale-fixtures.ts — Todo 26 H4 scale SLO benchmark trio fixtures.
 *
 * Three NDJSON legs (route-mocked as **\/execute by tests/scale-slo.spec.ts):
 *   nested-loop   ~10k steps  (100x100 loop, vars {i,j})
 *   fib-recursion ~50k steps  (fib(20) call tree, enter/state/exit per call)
 *   hot-call      ~100k steps (25k iters x state/enter/state/exit)
 *
 * Plus a <=2k full-fidelity regression trace (1500 distinct steps).
 *
 * Erasable-syntax TypeScript only (interfaces, no enums) so the file runs
 * under Node 24 type-stripping with zero dependencies.
 */

export interface FixtureEvent {
  type: "enter" | "exit" | "state" | "branch" | "iter";
  line: number;
  func: string;
  depth: number;
  params?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  return_val?: unknown;
  condition?: string;
  taken?: boolean;
  iteration?: number;
}

export interface CfgNode {
  id: string;
  type: string;
  lines: number[];
  label: string;
  children: string[];
  trace_indices: number[];
}

export interface CfgEdge {
  source: string;
  target: string;
  label: string;
}

export interface LegFixture {
  leg: string;
  events: FixtureEvent[];
  cfg_nodes: CfgNode[];
  cfg_edges: CfgEdge[];
  total_steps: number;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function lineNode(id: string, label: string, indices: number[]): CfgNode {
  return { id, type: "line", lines: [1], label, children: [], trace_indices: indices };
}

/** Leg A: 100x100 nested loop -> 10,002 steps, vars {i,j} distinct per step. */
export function buildNestedLoop(): LegFixture {
  const events: FixtureEvent[] = [{ type: "enter", line: 1, func: "solve", depth: 1, params: { n: 100 } }];
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 100; j++) {
      events.push({ type: "state", line: 3, func: "solve", depth: 1, vars: { i, j } });
    }
  }
  events.push({ type: "exit", line: 5, func: "solve", depth: 1, return_val: 0 });
  const n = events.length;
  return {
    leg: "nested-loop",
    events,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "solve()", children: ["n1"], trace_indices: [0] },
      { id: "n1", type: "loop", lines: [2, 3], label: "for i/j (100x100)", children: [], trace_indices: range(1, n - 2) },
      { id: "n2", type: "func_end", lines: [5], label: "return", children: [], trace_indices: [n - 1] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: n,
  };
}

/**
 * Leg B: fib(20) call tree -> 3 * 21891 + 2 = 65,675 steps (~50k tier).
 * Recursive calls are identified by enter/exit pairing on (func, depth):
 * depth oscillates 1..20, max depth 20. Reachable != understood (see report).
 */
export function buildFibRecursion(): LegFixture {
  const events: FixtureEvent[] = [{ type: "enter", line: 1, func: "main", depth: 1, params: {} }];
  let maxDepth = 1;
  function fib(n: number, depth: number): number {
    if (depth > maxDepth) maxDepth = depth;
    events.push({ type: "enter", line: 10, func: "fib", depth, params: { n } });
    if (n < 2) {
      events.push({ type: "state", line: 11, func: "fib", depth, vars: { n, result: n } });
      events.push({ type: "exit", line: 11, func: "fib", depth, return_val: n });
      return n;
    }
    events.push({ type: "state", line: 12, func: "fib", depth, vars: { n } });
    const r = fib(n - 1, depth + 1) + fib(n - 2, depth + 1);
    events.push({ type: "exit", line: 13, func: "fib", depth, return_val: r });
    return r;
  }
  const result = fib(20, 2);
  events.push({ type: "exit", line: 2, func: "main", depth: 1, return_val: result });
  const n = events.length;
  void maxDepth;
  return {
    leg: "fib-recursion",
    events,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
      { id: "n1", type: "func_call", lines: [10], label: "fib(n) recursive", children: [], trace_indices: range(1, n - 2) },
      { id: "n2", type: "func_end", lines: [2], label: "return", children: [], trace_indices: [n - 1] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: n,
  };
}

/** Leg C: 25k iters x (state/enter/state/exit) -> 100,002 steps. */
export function buildHotCall(): LegFixture {
  const events: FixtureEvent[] = [{ type: "enter", line: 1, func: "main", depth: 1, params: {} }];
  for (let i = 0; i < 25000; i++) {
    const h = (i * 2654435761) % 100000;
    events.push({ type: "state", line: 3, func: "main", depth: 1, vars: { i } });
    events.push({ type: "enter", line: 20, func: "hash", depth: 2, params: { x: i } });
    events.push({ type: "state", line: 21, func: "hash", depth: 2, vars: { x: i, h } });
    events.push({ type: "exit", line: 22, func: "hash", depth: 2, return_val: h });
  }
  events.push({ type: "exit", line: 4, func: "main", depth: 1, return_val: 0 });
  const n = events.length;
  return {
    leg: "hot-call",
    events,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
      lineNode("n1", "loop body (25k iters)", range(1, n - 2)),
      { id: "n2", type: "func_end", lines: [4], label: "return", children: [], trace_indices: [n - 1] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: n,
  };
}

/** <=2k full-fidelity regression: 1500 distinct steps, every step reachable. */
export function buildFidelity2k(): LegFixture {
  const events: FixtureEvent[] = [{ type: "enter", line: 1, func: "main", depth: 1, params: {} }];
  for (let k = 0; k < 1500; k++) {
    events.push({ type: "state", line: 2, func: "main", depth: 1, vars: { k, v: k * k } });
  }
  events.push({ type: "exit", line: 3, func: "main", depth: 1, return_val: 0 });
  const n = events.length;
  return {
    leg: "fidelity-2k",
    events,
    cfg_nodes: [
      { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
      lineNode("n1", "body", range(1, n - 2)),
      { id: "n2", type: "func_end", lines: [3], label: "return", children: [], trace_indices: [n - 1] },
    ],
    cfg_edges: [
      { source: "n0", target: "n1", label: "" },
      { source: "n1", target: "n2", label: "" },
    ],
    total_steps: n,
  };
}

/** Serialize a fixture to the NDJSON streaming format the app consumes. */
export function toNDJSON(fx: LegFixture): string {
  const lines: string[] = fx.events.map((e) => JSON.stringify({ type: "event", data: e }));
  lines.push(
    JSON.stringify({
      type: "cfg",
      stdout: "",
      runtime_error: null,
      timed_out: false,
      truncated: false,
      cfg_nodes: fx.cfg_nodes,
      cfg_edges: fx.cfg_edges,
      total_steps: fx.total_steps,
    }),
  );
  return lines.join("\n") + "\n";
}

export const LEG_BUILDERS: Record<string, () => LegFixture> = {
  "nested-loop": buildNestedLoop,
  "fib-recursion": buildFibRecursion,
  "hot-call": buildHotCall,
  "fidelity-2k": buildFidelity2k,
};
