"""
models/response.py — API response Pydantic models.

These are the shapes of the JSON bodies returned by the single endpoint.
The frontend TypeScript types mirror these exactly.
"""

from pydantic import BaseModel, Field

from app.core.trace.models import CFGEdge, CFGNode, TraceEvent


class ExecuteResponse(BaseModel):
    """Response from POST /execute."""
    stdout: str
    compile_error: str | None = None
    runtime_error: str | None = None
    timed_out: bool = False
    truncated: bool = Field(
        default=False,
        description="True if trace was cut at MAX_TRACE_LINES — program may have more steps",
    )
    trace: list[TraceEvent] = Field(
        default_factory=list,
        description=(
            "Flat list of TraceEvent objects in execution order.  When the "
            "parser runs with compression enabled some StateEvent objects carry "
            "extra fields (group_start, group_end, group_count, compressed) "
            "via __pydantic_extra__."
        ),
    )
    cfg_nodes: list[CFGNode] = Field(default_factory=list)
    cfg_edges: list[CFGEdge] = Field(default_factory=list)
    total_steps: int = 0


class ExecuteBatchResponseItem(BaseModel):
    """Single test case result from POST /execute-batch.

    Mirrors ExecuteResponse but adds ``test_id`` to identify the test case.
    """
    test_id: str
    stdout: str
    compile_error: str | None = None
    runtime_error: str | None = None
    timed_out: bool = False
    truncated: bool = Field(
        default=False,
        description="True if trace was cut at MAX_TRACE_LINES — program may have more steps",
    )
    trace: list[TraceEvent] = Field(
        default_factory=list,
        description=(
            "Flat list of TraceEvent objects in execution order.  When the "
            "parser runs with compression enabled some StateEvent objects carry "
            "extra fields (group_start, group_end, group_count, compressed) "
            "via __pydantic_extra__."
        ),
    )
    cfg_nodes: list[CFGNode] = Field(default_factory=list)
    cfg_edges: list[CFGEdge] = Field(default_factory=list)
    total_steps: int = 0
