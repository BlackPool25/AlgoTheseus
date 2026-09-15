/**
 * types/trace.ts — All trace event type definitions.
 *
 * These mirror the Python Pydantic models exactly.
 * Use the discriminant field "type" for exhaustive switch statements.
 */

export type EventType =
  | "enter"
  | "exit"
  | "state"
  | "branch"
  | "iter";

interface BaseEvent {
  line: number;
  func: string;
  depth: number;
}

export interface FuncEnterEvent extends BaseEvent {
  type: "enter";
  params: Record<string, unknown>;
  // v2 additive-only: all optional, absent on v1 traces
  step_desc?: string | null;
}

export interface FuncExitEvent extends BaseEvent {
  type: "exit";
  return_val: unknown;
  // v2 additive-only
  step_desc?: string | null;
  return_line?: number | null;
}

export interface StateEvent extends BaseEvent {
  type: "state";
  vars: Record<string, unknown>;
  // v2 additive-only (stdout capped at 64KB per-event; see docs/trace-schema-v2.md)
  stdout?: string | null;
  stdout_truncated?: boolean;
  globals?: Record<string, unknown> | null;
  step_desc?: string | null;
  prev_line?: number | null;
  heap?: Record<string, unknown> | null;
}

export interface BranchEvent extends BaseEvent {
  type: "branch";
  condition: string;
  taken: boolean;
  // v2 additive-only
  ops?: string[] | null;
  step_desc?: string | null;
}

export interface LoopIterEvent extends BaseEvent {
  type: "iter";
  iteration: number;
  // v2 additive-only
  step_desc?: string | null;
}

/** Discriminated union — use `event.type` as the discriminant. */
export type TraceEvent =
  | FuncEnterEvent
  | FuncExitEvent
  | StateEvent
  | BranchEvent
  | LoopIterEvent;

/** Exhaustiveness check helper */
export function assertNever(x: never): never {
  throw new Error(`Unhandled event type: ${JSON.stringify(x)}`);
}
