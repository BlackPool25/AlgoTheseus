"""app/core/queue/jobs.py — Job payload + status models (Pydantic v2)."""

from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.queue.backends import RESULT_TTL_SECONDS

JobStatus = Literal["queued", "running", "done", "error"]


class JobRecord(BaseModel):
    """Internal job record stored by the queue backend (TTL 1h)."""

    job_id: str = Field(description="Unique job identifier (uuid hex)")
    status: JobStatus = Field(default="queued", description="Lifecycle state")
    payload: dict[str, Any] = Field(description="ExecuteRequest JSON + created ts")
    result: dict[str, Any] | None = Field(default=None, description="ExecuteResponse JSON")
    error: str | None = Field(default=None, description="Failure detail when error")
    created: float = Field(default_factory=time.time, description="Epoch seconds")
    updated: float = Field(default_factory=time.time, description="Epoch seconds")


class JobSubmitResponse(BaseModel):
    """POST /jobs — accepted job handle."""

    job_id: str = Field(description="Poll GET /jobs/{job_id} for the result")
    status: JobStatus = Field(default="queued", description="Initial state")


class JobStatusResponse(BaseModel):
    """GET /jobs/{id} — status plus result when done."""

    job_id: str = Field(description="Job identifier")
    status: JobStatus = Field(description="Current lifecycle state")
    result: dict[str, Any] | None = Field(default=None, description="ExecuteResponse JSON")
    error: str | None = Field(default=None, description="Failure detail when error")
