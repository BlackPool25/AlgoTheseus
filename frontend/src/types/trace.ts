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
}

export interface FuncExitEvent extends BaseEvent {
  type: "exit";
  return_val: unknown;
}

export interface StateEvent extends BaseEvent {
  type: "state";
  vars: Record<string, unknown>;
}

export interface BranchEvent extends BaseEvent {
  type: "branch";
  condition: string;
  taken: boolean;
}

export interface LoopIterEvent extends BaseEvent {
  type: "iter";
  iteration: number;
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
