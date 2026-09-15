"""
trace/models.py — Pydantic models for all trace event types.

These are the canonical data types for the entire system. The parser produces
them, the CFG builder consumes them, and the API response includes them.

Key design: TraceEvent is a discriminated union on the "type" field.
The short keys from tracer.h ("t", "l", "f", "d", etc.) are mapped to
full names here via Field(alias=...) so the rest of the codebase uses
readable names.

Gotcha: Pydantic v2 requires model_config = ConfigDict(populate_by_name=True)
to allow both alias and field name access.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class EventType(str, Enum):
    FUNC_ENTER = "enter"
    FUNC_EXIT  = "exit"
    STATE      = "state"
    BRANCH     = "branch"
    LOOP_ITER  = "iter"


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    # Short-key aliases match tracer.h output: "l", "f", "d"
    line:  int = Field(alias="l")
    func:  str = Field(alias="f")
    depth: int = Field(alias="d")


class FuncEnterEvent(_Base):
    type: Literal[EventType.FUNC_ENTER] = Field(alias="t")
    params: dict[str, Any] = Field(default_factory=dict, alias="p")
    # v2 additive-only: one-line step description (absent → None)
    step_desc: str | None = Field(default=None, alias="sd")


class FuncExitEvent(_Base):
    type: Literal[EventType.FUNC_EXIT] = Field(alias="t")
    return_val: Any = Field(default=None, alias="r")
    # v2 additive-only
    step_desc: str | None = Field(default=None, alias="sd")
    return_line: int | None = Field(default=None, alias="rl")


class StateEvent(_Base):
    type: Literal[EventType.STATE] = Field(alias="t")
    vars: dict[str, Any] = Field(default_factory=dict, alias="v")
    # v2 additive-only (stdout capped at 64KB per-event; see docs/trace-schema-v2.md)
    stdout: str | None = Field(default=None, alias="o")
    stdout_truncated: bool = Field(default=False, alias="o_tr")
    globals: dict[str, Any] | None = Field(default=None, alias="g")
    step_desc: str | None = Field(default=None, alias="sd")
    prev_line: int | None = Field(default=None, alias="pl")
    heap: dict[str, Any] | None = Field(default=None, alias="h")
    # T11b additive-only: prev-vs-current per-$id change set for this step
    # (added/removed/mutated ids + changed fields); absent → None.
    heap_diff: dict[str, Any] | None = Field(default=None, alias="hd")


class BranchEvent(_Base):
    type: Literal[EventType.BRANCH] = Field(alias="t")
    condition: str = Field(alias="c")
    taken: bool = Field(alias="tk")
    # v2 additive-only
    ops: list[str] | None = Field(default=None, alias="op")
    step_desc: str | None = Field(default=None, alias="sd")


class LoopIterEvent(_Base):
    type: Literal[EventType.LOOP_ITER] = Field(alias="t")
    iteration: int = Field(alias="it")
    # v2 additive-only
    step_desc: str | None = Field(default=None, alias="sd")


# Discriminated union — use type: Annotated[..., Field(discriminator="type")]
TraceEvent = Annotated[
    Union[FuncEnterEvent, FuncExitEvent, StateEvent, BranchEvent, LoopIterEvent],
    Field(discriminator="type"),
]


class StackFrame(BaseModel):
    """One live call-stack frame reconstructed by the parser (never on the wire).

    ``frame_id`` is a per-parse monotonic counter, unique even across
    recursive re-entries of the same function. ``vars`` is the frame's
    latest merged locals snapshot (STATE vars merged into ENTER params).
    """

    func: str
    frame_id: int
    depth: int
    vars: dict[str, Any] = Field(default_factory=dict)


# ── CFG models ────────────────────────────────────────────────────────────────

class CFGNodeType(str, Enum):
    LINE       = "line"
    BRANCH     = "branch"
    LOOP       = "loop"
    FUNC_CALL  = "func_call"
    FUNC_START = "func_start"
    FUNC_END   = "func_end"


class CFGNode(BaseModel):
    """A node in the dynamic control-flow graph built from the trace."""
    id: str
    type: CFGNodeType
    lines: list[int]            # source lines this node covers
    label: str                  # display label shown in the flowchart
    children: list[str] = []    # child node IDs (for expandable loop/recursion nodes)
    trace_indices: list[int]    # which trace steps map to this node


class CFGEdge(BaseModel):
    source: str
    target: str
    label: str = ""


