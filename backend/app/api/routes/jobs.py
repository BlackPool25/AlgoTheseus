"""app/api/routes/jobs.py — Async job-queue endpoints.

POST /jobs enqueues an ExecuteRequest payload (plus a created timestamp)
and returns 202 {job_id, status}. GET /jobs/{id} polls the record until
the worker stores the result. Execution itself lives in app/worker.py —
this module only enqueues and reads records, never runs the sandbox.
"""

import time

from fastapi import APIRouter, HTTPException, Request, Response

from app.core.budget import consume_budget
from app.core.queue.backends import get_queue
from app.core.queue.jobs import JobStatusResponse, JobSubmitResponse
from app.core.rate_limit import JOBS_LIMIT, limiter
from app.models.request import ExecuteRequest

router = APIRouter()


@router.post("", response_model=JobSubmitResponse, status_code=202)
@limiter.limit(JOBS_LIMIT)
async def submit_job(
    request: Request,
    response: Response,
    req: ExecuteRequest,
) -> JobSubmitResponse:
    """Enqueue a C++ execution job. Returns 202 with the polling handle."""
    await consume_budget(1)  # free-tier hard cap counts at enqueue (conservative)
    payload = req.model_dump()
    payload["created"] = time.time()
    job_id = await get_queue().enqueue(payload)
    return JobSubmitResponse(job_id=job_id, status="queued")


@router.get("/{job_id}", response_model=JobStatusResponse)
async def job_status(job_id: str) -> JobStatusResponse:
    """Return job status plus the ExecuteResponse payload when done."""
    rec = await get_queue().get(job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return JobStatusResponse(
        job_id=rec["job_id"],
        status=rec["status"],
        result=rec.get("result"),
        error=rec.get("error"),
    )
