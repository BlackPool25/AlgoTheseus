# C++ DSA Trace Visualiser — Full Engineering Plan

---

## 1. Project Overview

A web tool where DSA students write C++ code, submit it, and get a full step-by-step visual replay of how their program executed — with variable states, STL container visuals, call trees, loop expansions, and pointer-based struct graphs — all navigable via a scrubber.

**Core Pipeline:**
```
User writes code + raw input
        ↓
LLM runs once (struct schema + clean stdin)
        ↓
Instrumenter rewrites C++ source (injects trace calls)
        ↓
Docker compiles + runs instrumented binary
        ↓
Trace log (JSON lines on stderr) is parsed into structured steps
        ↓
Frontend renders CFG + state panel + container visuals
        ↓
User scrubs through the full replay
```

---

## 2. Technology Stack

### Backend
| Tool | Version | Purpose |
|---|---|---|
| Python | 3.11+ | Runtime |
| FastAPI | 0.110+ | API framework |
| libclang (clang Python bindings) | 16+ | C++ AST parsing for instrumentation |
| Docker SDK for Python | 7.x | Sandbox execution management |
| Pydantic v2 | 2.x | All data models and validation |
| Anthropic Python SDK | latest | LLM calls |
| pytest + pytest-asyncio | latest | Testing |
| uvicorn | latest | ASGI server |

### Frontend
| Tool | Version | Purpose |
|---|---|---|
| React | 18+ | UI framework |
| TypeScript | 5+ | Type safety everywhere |
| Monaco Editor | latest | Code editor (same as VSCode) |
| React Flow | 11+ | CFG flowchart rendering |
| Zustand | 4+ | Global state management |
| Tailwind CSS | 3+ | Styling |
| React Virtual (TanStack) | latest | Virtualised list for 500 loop nodes |
| Framer Motion | latest | Node expand/collapse animations |
| Vite | 5+ | Build tool |

### Infrastructure
| Tool | Purpose |
|---|---|
| Docker | Execution sandbox |
| Custom Docker image (gcc:13-slim) | C++ compilation environment |
| Nginx (optional, later) | Reverse proxy |

---

## 3. Project Directory Structure

```
cpp-visualiser/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app entry, CORS, router registration
│   │   ├── api/
│   │   │   └── routes/
│   │   │       ├── execute.py         # POST /execute endpoint
│   │   │       └── analyze.py         # POST /analyze endpoint (LLM)
│   │   ├── core/
│   │   │   ├── instrumenter/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── ast_walker.py      # libclang AST traversal
│   │   │   │   ├── injector.py        # Source rewriter (inserts trace calls)
│   │   │   │   ├── scope_tracker.py   # Tracks which variables are in scope at each point
│   │   │   │   ├── serializer_gen.py  # Generates C++ serializer code from struct schema
│   │   │   │   └── tracer.h           # The injected C++ header (runtime logger)
│   │   │   ├── executor/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── docker_runner.py   # Spins up container, runs binary, collects output
│   │   │   │   └── sandbox_config.py  # Resource limits, security options
│   │   │   ├── trace/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── models.py          # Pydantic models for all trace event types
│   │   │   │   ├── parser.py          # Raw stderr JSON lines → structured TraceStep list
│   │   │   │   └── cfg_builder.py     # Builds dynamic CFG from trace for frontend
│   │   │   └── llm/
│   │   │       ├── __init__.py
│   │   │       ├── struct_analyzer.py # Sends code to LLM, gets struct rendering schema
│   │   │       └── input_cleaner.py   # Sends raw input + code to LLM, gets clean stdin
│   │   └── models/
│   │       ├── request.py             # ExecuteRequest, AnalyzeRequest Pydantic models
│   │       └── response.py            # ExecuteResponse, TraceResponse Pydantic models
│   ├── tests/
│   │   ├── test_instrumenter.py
│   │   ├── test_trace_parser.py
│   │   ├── test_docker_runner.py
│   │   └── fixtures/                  # Sample .cpp files for testing
│   ├── docker/
│   │   └── Dockerfile.sandbox         # The execution sandbox image
│   ├── requirements.txt
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── types/
│   │   │   ├── trace.ts               # All trace type definitions
│   │   │   ├── cfg.ts                 # CFG node/edge types
│   │   │   └── schema.ts              # Struct schema types
│   │   ├── store/
│   │   │   ├── traceStore.ts          # Zustand: current step, trace array, navigation
│   │   │   ├── cfgStore.ts            # Zustand: CFG nodes/edges, expanded nodes
│   │   │   └── uiStore.ts             # Zustand: panel visibility, editor state
│   │   ├── components/
│   │   │   ├── Editor/
│   │   │   │   ├── CodeEditor.tsx     # Monaco editor wrapper
│   │   │   │   └── InputPanel.tsx     # Raw input textarea
│   │   │   ├── FlowChart/
│   │   │   │   ├── TraceFlow.tsx      # React Flow root component
│   │   │   │   ├── nodes/
│   │   │   │   │   ├── LineNode.tsx           # Single statement node
│   │   │   │   │   ├── BranchNode.tsx         # If/else diamond node
│   │   │   │   │   ├── LoopNode.tsx           # Collapsed loop, expandable
│   │   │   │   │   ├── FunctionCallNode.tsx   # User function call node
│   │   │   │   │   └── RecursionTreeNode.tsx  # Recursive call tree node
│   │   │   │   └── edges/
│   │   │   │       └── TraceEdge.tsx  # Animated edge showing execution path
│   │   │   ├── StatePanel/
│   │   │   │   ├── StatePanel.tsx     # Right panel showing var state at current step
│   │   │   │   ├── VariableRow.tsx    # One variable with its value
│   │   │   │   └── CallStackView.tsx  # Current call stack depth visualised
│   │   │   ├── ContainerVisuals/
│   │   │   │   ├── VectorVisual.tsx
│   │   │   │   ├── StackVisual.tsx
│   │   │   │   ├── QueueVisual.tsx
│   │   │   │   ├── MapVisual.tsx
│   │   │   │   ├── SetVisual.tsx
│   │   │   │   ├── PriorityQueueVisual.tsx
│   │   │   │   └── StructGraphVisual.tsx  # Pointer-struct boxes + arrows (uses schema)
│   │   │   └── Scrubber/
│   │   │       └── TraceScrubber.tsx  # Slider + prev/next buttons
│   │   ├── hooks/
│   │   │   ├── useTraceNavigation.ts  # Logic for step/scrub/keyboard nav
│   │   │   └── useContainerType.ts    # Determines which visual to render for a variable
│   │   └── utils/
│   │       ├── cfgLayout.ts           # Positions React Flow nodes (Dagre layout)
│   │       └── schemaRenderer.ts      # Reads struct schema to build StructGraphVisual props
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── tailwind.config.ts
│
└── README.md
```

---

## 4. Data Models (Source of Truth)

Define these first. Everything else is built around them.

### Trace Event Types (backend — `core/trace/models.py`)
```python
from pydantic import BaseModel
from typing import Literal, Any, Union
from enum import Enum

class EventType(str, Enum):
    FUNC_ENTER = "func_enter"
    FUNC_EXIT  = "func_exit"
    STATE      = "state"
    BRANCH     = "branch"
    LOOP_ITER  = "loop_iter"
    CALL       = "call"       # moment of calling a user function (before it enters)

class FuncEnterEvent(BaseModel):
    type: Literal[EventType.FUNC_ENTER]
    line: int
    func: str
    depth: int
    params: dict[str, Any]

class FuncExitEvent(BaseModel):
    type: Literal[EventType.FUNC_EXIT]
    line: int
    func: str
    depth: int
    return_val: Any | None

class StateEvent(BaseModel):
    type: Literal[EventType.STATE]
    line: int
    func: str
    depth: int
    vars: dict[str, Any]       # variable name → serialized value

class BranchEvent(BaseModel):
    type: Literal[EventType.BRANCH]
    line: int
    func: str
    depth: int
    condition: str
    taken: bool

class LoopIterEvent(BaseModel):
    type: Literal[EventType.LOOP_ITER]
    line: int
    func: str
    depth: int
    iteration: int

TraceEvent = Union[FuncEnterEvent, FuncExitEvent, StateEvent, BranchEvent, LoopIterEvent]
```

### CFG Node Types (used by both backend builder and frontend)
```python
class CFGNodeType(str, Enum):
    LINE       = "line"
    BRANCH     = "branch"
    LOOP       = "loop"
    FUNC_CALL  = "func_call"
    FUNC_START = "func_start"
    FUNC_END   = "func_end"

class CFGNode(BaseModel):
    id: str
    type: CFGNodeType
    lines: list[int]            # source lines this node covers
    label: str                  # display label
    children: list[str] = []    # child node IDs (for expansion)
    trace_indices: list[int]    # which trace steps map to this node
```

### Struct Schema (from LLM)
```python
class FieldRole(str, Enum):
    LABEL      = "label"         # display as text in the box
    LEFT_CHILD = "left_child"    # pointer to left child (tree)
    RIGHT_CHILD= "right_child"
    NEXT       = "next"          # linked list pointer
    PREV       = "prev"
    POINTER    = "pointer"       # generic pointer (draw as arrow)
    DATA       = "data"          # plain field, show in box

class RenderAs(str, Enum):
    TREE        = "tree"
    LINKED_LIST = "linked_list"
    GRAPH       = "graph"        # generic graph, arrows between nodes

class StructField(BaseModel):
    name: str
    cpp_type: str
    role: FieldRole

class StructSchema(BaseModel):
    name: str
    render_as: RenderAs
    fields: list[StructField]

class ProgramSchema(BaseModel):
    structs: list[StructSchema]
```

---

## 5. Component Deep Dives

### 5.1 — The Instrumenter (Most Critical Component)

**This is the heart of the project. Get this right first.**

#### How it works:

1. `ast_walker.py` uses `libclang` to parse the user's C++ source into an AST.
2. It walks the AST and collects **injection points** — positions (line, column) in the source where a trace call must be inserted.
3. `scope_tracker.py` tracks which variables are declared and in-scope at each injection point, so we know what to serialize.
4. `injector.py` takes the original source text + injection points and produces a new `.cpp` file with all trace calls inserted.
5. `serializer_gen.py` generates a custom C++ serializer function for each user-defined struct (based on the LLM schema), which is appended to `tracer.h` before injection.

#### What gets injected and where:

| Location | What is injected |
|---|---|
| Top of file | `#include "tracer.h"` |
| Start of every user function body | `__TRACE_FUNC_ENTER(func_name, depth, {param serializations})` |
| After every statement in user code | `__TRACE_STATE(line, func, depth, {var serializations})` |
| Before every `if`/`else if` condition | `__TRACE_BRANCH(line, func, depth, "condition string", actual_condition)` |
| At the top of every loop body | `__TRACE_LOOP_ITER(line, func, depth, __loop_iter_N++)` where N is unique per loop |
| Before every `return` statement | `__TRACE_FUNC_EXIT(line, func, depth, return_value)` |

#### Injection point rules — critical nuances:
- **Only inject into user-defined functions**, identified by checking `cursor.location.file` against the user's source file path. Any cursor whose file doesn't match is skipped entirely.
- **Do not inject inside STL method bodies** — when a `std::sort` or `vec.push_back()` is called, inject one `STATE` event *after* the call returns (capturing the changed state of the container), not inside the call.
- **Do not inject inside injected code** — the instrumenter must track its own insertions so it doesn't recursively process them.
- **Loop counter variables** (`__loop_iter_N`) must be injected as declarations at the start of the enclosing function, not inside the loop, to avoid scope issues.
- **Preserve original line numbers** — inject calls on the same line when possible, or use `#line` directives to reset the compiler's line tracking so error messages still reference original lines.

#### `tracer.h` — the injected runtime logger:

This is a pure C++ header that the user's instrumented code depends on. It must:
- Write all trace events to `stderr` with the prefix `TRACE:` (so we can separate it from real stderr output)
- Use `fprintf` not `std::cout` (avoids interaction with user's stdout)
- Contain template serializers for all supported types:
  - All primitives (`int`, `long`, `double`, `char`, `bool`, `string`)
  - `std::vector<T>`, `std::stack<T>`, `std::queue<T>`, `std::deque<T>`
  - `std::map<K,V>`, `std::unordered_map<K,V>`, `std::set<T>`, `std::multiset<T>`
  - `std::priority_queue<T>` (drain a copy into a vector to serialize — never drain the original)
  - Pointers: check for `nullptr`, then follow using the generated struct serializers
- Have a **cycle detection guard** for pointer traversal using a `std::set<void*>` of visited addresses
- Cap pointer traversal at depth 50 to handle pathological inputs

#### `serializer_gen.py` — generated struct serializers:

Given a schema like `TreeNode { val: int (label), left: TreeNode* (left_child), right: TreeNode* (right_child) }`, it generates:

```cpp
std::string __serialize_TreeNode(TreeNode* node, std::set<void*>& visited, int depth) {
    if (!node || depth > 50) return "null";
    if (visited.count((void*)node)) return "{\"$cycle\":true}";
    visited.insert((void*)node);
    std::string out = "{";
    out += "\"val\":" + __serialize_primitive(node->val) + ",";
    out += "\"left\":" + __serialize_TreeNode(node->left, visited, depth+1) + ",";
    out += "\"right\":" + __serialize_TreeNode(node->right, visited, depth+1);
    out += "}";
    return out;
}
```

This function is appended to `tracer.h` before compilation. The main template serializer falls through to it when it sees a pointer of type `TreeNode*`.

---

### 5.2 — Docker Executor

**`sandbox_config.py`** defines:
```python
SANDBOX_CONFIG = {
    "mem_limit": "128m",
    "cpu_period": 100000,
    "cpu_quota": 50000,      # 50% of one CPU
    "network_disabled": True,
    "read_only": True,        # filesystem read-only except /tmp
    "tmpfs": {"/tmp": "size=64m,noexec"},
    "pids_limit": 64,
    "cap_drop": ["ALL"],
    "security_opt": ["no-new-privileges"],
    "user": "nobody",
}
EXECUTION_TIMEOUT_SECONDS = 10
MAX_TRACE_LINES = 100_000     # hard cap on trace output size
```

**`docker_runner.py`** flow:
1. Write the instrumented `.cpp` file to a temp directory on the host.
2. Mount that directory into the container as read-only.
3. The container runs two commands in sequence:
   - `g++ -O0 -g -std=c++17 -o /tmp/prog /mnt/code/prog.cpp` (compile)
   - `/tmp/prog < /mnt/code/input.txt` (run)
4. Capture stdout and stderr separately (stderr contains the `TRACE:` lines).
5. Split stderr into trace lines (prefixed `TRACE:`) and real error lines.
6. Enforce the timeout — kill the container after `EXECUTION_TIMEOUT_SECONDS`.
7. Return: `{ stdout, stderr_clean, trace_raw, exit_code, compile_error }`.

**Use `-O0`** (no optimisation) for compilation. Optimised builds reorder, inline, and eliminate code — which destroys the relationship between source lines and executed instructions.

---

### 5.3 — Trace Parser & CFG Builder

**`parser.py`:**
- Reads `trace_raw` line by line.
- Each line is `TRACE:{json}`. Strip the prefix, parse the JSON.
- Validate against the Pydantic event models.
- Returns a flat `list[TraceEvent]` in execution order.
- This list is the **canonical trace** — the index of an event in this list is its "step number" used everywhere else.

**`cfg_builder.py`:**

Builds a dynamic CFG from the flat trace. Do **not** do static CFG analysis — it's complex and error-prone for C++. Build it from the trace instead:

1. Walk the trace linearly.
2. Group consecutive `STATE` events in the same function into a `LINE` node until a discontinuity (jump in line number, branch, or call).
3. When a `BRANCH` event is seen, create a `BRANCH` node with two outgoing edges.
4. When a `LOOP_ITER` event is seen:
   - First iteration: create a `LOOP` node.
   - Subsequent iterations at the same line: add to the existing `LOOP` node's child list.
5. When a `FUNC_ENTER` is seen after a `CALL` in the parent: create a `FUNC_CALL` node in the parent and a sub-graph for the callee.
6. For **recursion**: detect when `func_enter.func == current_func` and build a recursive call tree instead of a flat list.

Each CFG node stores `trace_indices: list[int]` — the indices into the flat trace that correspond to this node. This is how the scrubber and the flowchart stay in sync.

---

### 5.4 — LLM Integration

**`struct_analyzer.py`:**

Prompt structure:
```
System: You are a C++ code analyser. Your only job is to output a JSON schema 
        describing custom pointer-based structs in the code. Output ONLY valid JSON, 
        no markdown, no explanation.

User: Analyse this C++ code and return a JSON object matching this exact schema:
      { "structs": [ { "name": string, "render_as": "tree"|"linked_list"|"graph",
        "fields": [ { "name": string, "cpp_type": string, 
                      "role": "label"|"left_child"|"right_child"|"next"|"prev"|"pointer"|"data" }
                  ] } ] }
      
      If there are no custom pointer structs, return: { "structs": [] }
      
      Code: [USER CODE HERE]
```

- Run this call immediately when the user submits code, before instrumentation.
- Validate the LLM output against the `ProgramSchema` Pydantic model.
- If validation fails, log the error and return `{ "structs": [] }` (graceful degradation — pointer structs just won't be visualised).
- Do **not** trust the LLM to name fields correctly — cross-check field names it returns against the actual AST to ensure they exist.

**`input_cleaner.py`:**

Prompt structure:
```
System: You are a stdin formatter. Given C++ code and a user's raw input, 
        return ONLY the properly formatted stdin string. No explanation.

User: C++ code reads input in this pattern: [brief description or code snippet of cin calls]
      User provided this raw input: [RAW INPUT]
      Return only the cleaned stdin content.
```

- Extract the relevant `cin` usage from the code before sending (reduces token usage and improves accuracy).
- Show the cleaned input to the user before running, with a "looks right?" confirmation step.

---

### 5.5 — API Design

**`POST /analyze`** — called first when user submits
```
Request:  { code: string, raw_input: string }
Response: { struct_schema: ProgramSchema, cleaned_stdin: string, stdin_preview: string }
```

**`POST /execute`** — called after user confirms cleaned input
```
Request:  { code: string, cleaned_stdin: string, struct_schema: ProgramSchema }
Response: {
    stdout: string,
    compile_error: string | null,
    runtime_error: string | null,
    trace: TraceEvent[],
    cfg: CFGNode[],
    total_steps: int
}
```

Keep it to two endpoints. Do not build streaming endpoints for a portfolio project — the trace is small enough to return in one response for DSA-sized programs.

---

### 5.6 — Frontend Architecture

#### State (Zustand)

Three separate stores — do not merge them into one god object:

**`traceStore`:**
```typescript
interface TraceStore {
  trace: TraceEvent[]
  totalSteps: number
  currentStep: number
  currentEvent: TraceEvent | null
  setStep: (n: number) => void
  next: () => void
  prev: () => void
}
```

**`cfgStore`:**
```typescript
interface CFGStore {
  nodes: CFGNode[]
  edges: CFGEdge[]
  expandedNodeIds: Set<string>
  activeNodeId: string | null       // derived from traceStore.currentStep
  toggleExpand: (id: string) => void
}
```

**`uiStore`:**
```typescript
interface UIStore {
  code: string
  rawInput: string
  cleanedStdin: string | null
  structSchema: ProgramSchema | null
  status: 'idle' | 'analyzing' | 'confirming' | 'executing' | 'done' | 'error'
}
```

#### React Flow nodes

Each custom node receives its `CFGNode` data as props and reads the current step from `traceStore` to know whether to highlight itself. Nodes should **never** manage their own expanded/collapsed state — that lives in `cfgStore`.

**`LoopNode`:** renders as a single card with an iteration count badge. On click, dispatches `cfgStore.toggleExpand(id)`. When expanded, React Flow renders child nodes beneath it using a sub-flow or nested layout. Use `React Virtual` to render the child list — never put 500 DOM nodes directly.

**`RecursionTreeNode`:** renders as a tree using React Flow's own layout. Each call is a node. Edges show parent→child call relationships. The active node in the tree is determined by `traceStore.currentStep`.

#### Scrubber

```typescript
// TraceScrubber.tsx
// A range input from 0 to totalSteps - 1
// onChange → traceStore.setStep(value)
// Prev button: traceStore.prev()
// Next button: traceStore.next()
// Also supports keyboard: ArrowLeft / ArrowRight
// Show current step label: "Step 42 / 1,204 — main() line 17"
```

#### Container Visuals

Each visual component receives the **serialized value** for that variable at the current step. They are pure display components — they take data and render it. No store access inside them.

- `VectorVisual`: horizontal row of index-labelled boxes
- `StackVisual`: vertical stack, top clearly marked
- `QueueVisual`: horizontal row with front/back arrows
- `MapVisual` / `SetVisual`: sorted key-value table with colour-coded recent changes
- `PriorityQueueVisual`: triangle-shaped heap, root = max/min
- `StructGraphVisual`: reads `structSchema` to know how to render — uses React Flow (or a small custom SVG renderer) to draw boxes + arrows. Each struct instance (by its address captured in trace) is a box. Pointer fields are arrows.

**Highlight changed values:** compare current step's vars against previous step's vars and highlight boxes that changed. This is critical for user experience.

---

## 6. The `tracer.h` Output Format (Strict Contract)

Every event written to stderr must match exactly:

```
TRACE:{"t":"enter","l":12,"f":"solve","d":1,"p":{"n":5,"arr":[1,2,3]}}
TRACE:{"t":"state","l":14,"f":"solve","d":1,"v":{"i":0,"result":0}}
TRACE:{"t":"branch","l":16,"f":"solve","d":1,"c":"i < n","tk":true}
TRACE:{"t":"iter","l":16,"f":"solve","d":1,"it":1}
TRACE:{"t":"exit","l":20,"f":"solve","d":1,"r":15}
```

Keys are shortened (`t`, `l`, `f`, `d`, `v`, `p`, `c`, `tk`, `it`, `r`) to keep trace output small. The parser maps these back to full names.

---

## 7. What NOT To Do

### Instrumentation
- **Never use regex to parse C++.** C++ grammar is not regular. Use libclang. One missed edge case in a regex parser will corrupt the trace silently.
- **Never inject inside STL method bodies.** You will get thousands of internal events. Only inject in user-defined functions.
- **Never inject on the same text line as a macro expansion.** Clang will give you inconsistent line numbers. Skip macro-expanded nodes.
- **Never try to instrument template function instantiations.** Scope to plain non-template user functions for v1.
- **Never rewrite the file in-place.** Always write to a temp copy. The original user source must never be touched.

### Execution
- **Never run user code outside Docker.** Even with instrumentation, the code can do damage.
- **Never give the container network access.** DSA problems never need it.
- **Never mount the host filesystem.** Only mount a controlled temp directory.
- **Never skip the execution timeout.** Infinite loops will block your server.

### Trace
- **Never mix trace output with stdout.** Use the `TRACE:` prefix on stderr. Stdout is for the user's program output only.
- **Never try to capture every heap allocation.** Only follow pointers that appear as user-declared variables in scope.
- **Never emit trace for lines inside `#include`d headers.** Filter by source file path.
- **Never emit trace inside injected trace calls themselves.** Guard against re-entrant logging.

### Frontend
- **Never render 500 DOM nodes for loop iterations.** Use virtualisation.
- **Never derive the active CFG node inside a React component.** Derive it in the store from `currentStep`, and pass it down as a prop.
- **Never put business logic in components.** Components are display only. Logic lives in hooks and stores.
- **Never use `any` in TypeScript.** All trace events are discriminated unions — use them properly.
- **Never auto-expand all loop/recursive nodes by default.** The flowchart will be unreadable. Everything starts collapsed.

### LLM
- **Never trust LLM struct field names without cross-checking against the AST.** LLMs hallucinate field names.
- **Never let the LLM generate C++ serializer code directly.** Generate it from the validated schema using your own `serializer_gen.py`. LLM-generated C++ has subtle bugs.
- **Never block the execute request on a slow LLM call.** Run `/analyze` first as a separate step with a confirmation gate.

---

## 8. Implementation Order

Do not deviate from this order. Each phase must be tested before the next starts.

### Phase 1 — Instrumentation + Execution (Backend only)
1. Write `tracer.h` with serializers for primitives only first.
2. Write a hand-crafted instrumented `.cpp` file (don't generate it yet) and verify the trace output is correct.
3. Write the Docker sandbox and verify it runs the hand-crafted file.
4. Write `ast_walker.py` and `scope_tracker.py`. Test on 10 sample DSA programs.
5. Write `injector.py`. Compare injected output to your hand-crafted file. They should be equivalent.
6. Write `parser.py`. Parse the trace from Step 2. Verify all events are correctly typed.

### Phase 2 — STL Serializers + Trace Completeness
7. Add STL serializers to `tracer.h` one container at a time. Test each with a small program.
8. Write `cfg_builder.py`. Verify CFG nodes correctly group trace events.
9. Add the `/execute` endpoint. Test end-to-end with 5 DSA programs: linear scan, binary search, DFS, DP, linked list.

### Phase 3 — LLM Integration
10. Write `input_cleaner.py` and test with messy user inputs.
11. Write `struct_analyzer.py` with a simple `TreeNode` test.
12. Write `serializer_gen.py` and test generated code compiles and serialises correctly.
13. Add the `/analyze` endpoint.

### Phase 4 — Frontend Core
14. Set up Vite + React + TypeScript + Tailwind.
15. Integrate Monaco Editor. Add the submit flow calling `/analyze` then `/execute`.
16. Build `traceStore` and `TraceScrubber`. Verify step navigation works against a real trace.
17. Build the `StatePanel` — show variables at current step as plain text first.

### Phase 5 — Flowchart
18. Integrate React Flow. Build `LineNode`, `BranchNode` first.
19. Add CFG layout with Dagre. Verify basic programs render a readable graph.
20. Add `LoopNode` with expand/collapse and virtualised child list.
21. Add `RecursionTreeNode` with the call tree structure.

### Phase 6 — Container Visuals
22. Build each container visual component. Test with mock data before wiring to the trace.
23. Wire container visuals into `VariableRow` via `useContainerType` hook.
24. Build `StructGraphVisual` and test with `TreeNode` schema.

### Phase 7 — Polish
25. Add diff highlighting (changed vars between steps).
26. Add keyboard navigation (arrow keys on scrubber).
27. Add compile error display (show in editor as Monaco markers).
28. Add a step label on the scrubber ("Step 42 / 1,204 — main() line 17").

---

## 9. Code Quality Rules (for LLM-generated code)

Every file generated must follow these. Put them at the top of every prompt to the LLM writing code.

- **One responsibility per file.** `ast_walker.py` only walks the AST. `injector.py` only rewrites source. No cross-cutting.
- **Pydantic for all data at boundaries.** Any data crossing an API boundary or module boundary must be a Pydantic model. No raw dicts.
- **TypeScript discriminated unions for trace events.** Use `type` as the discriminant. Use `never` for exhaustiveness checks.
- **No magic strings.** All event type strings, field names, and prefixes live in `constants.py` (backend) and `constants.ts` (frontend).
- **Every function has a docstring** explaining: what it takes, what it returns, and one gotcha/nuance specific to this function.
- **Test files mirror source structure.** `core/instrumenter/injector.py` → `tests/test_injector.py`. Every public function has at least two tests: a happy path and an edge case.
- **Backend: all async.** FastAPI routes are `async def`. Docker calls use `asyncio.to_thread` for blocking operations.
- **Frontend: no prop drilling beyond two levels.** If a value is needed three levels deep, it comes from the Zustand store.
- **Error states are first-class.** Every component that fetches data renders three states: loading, error, success. No silent failures.

---

## 10. Known Hard Problems to Plan Around

| Problem | Mitigation |
|---|---|
| User code with `#define` macros | Pre-process and flatten macros before instrumentation, or skip files with complex macros and warn the user |
| Circular linked lists | Cycle detection via `visited: set<void*>` in pointer serializer |
| Variables with the same name in nested scopes | Scope tracker must assign unique IDs per scope; frontend shows the innermost definition |
| 100,000+ step traces from large loops | `MAX_TRACE_LINES = 100_000` cap in Docker runner; warn user and truncate cleanly |
| LLM schema wrong field names | Cross-validate every field name in schema against the AST cursor children before using |
| Uninitialized pointers being followed | Wrap pointer dereference in `try/catch` in the serializer; emit `{"error":"uninit"}` |
| User code that calls `exit()` directly | Trace may be incomplete; parser must handle abrupt truncation gracefully |
| Priority queue serialization draining | Always copy the PQ into a temp variable before draining; never touch the user's actual PQ |