"""
models/request.py — API request Pydantic models.

These are the shapes of the JSON bodies accepted by the single endpoint.
"""

from pydantic import BaseModel, Field


class ExecuteRequest(BaseModel):
    """POST /execute — full code execution."""
    model_config = {"extra": "forbid"}

    code: str = Field(..., description="Full C++ source code")
    raw_stdin: str = Field(default="", description="Raw stdin input (parsed server-side)")
    compressed: bool = Field(
        default=False,
        description="When True, collapse consecutive STATE events with identical vars server-side to reduce payload",
    )


class ExecuteBatchRequest(BaseModel):
    """POST /execute-batch — batch execution against multiple test cases."""
    model_config = {"extra": "forbid"}

    code: str = Field(..., description="Full C++ source code")
    test_ids: list[str] = Field(
        ...,
        description="List of test case UUIDs to run against. Each UUID must have a corresponding input.txt in /tmp/dsa-visualizer/testcases/<uuid>/",
    )
