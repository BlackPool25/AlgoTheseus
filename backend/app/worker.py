"""app/worker.py — Async job-queue worker entrypoint.

Polls the queue (Redis list or in-memory fallback), runs the SAME
``_resolve(kind="single")`` → parse → CFG pipeline as POST /execute, and
stores the ExecuteResponse payload with a 1h TTL. Reuses DiskLRUCache via
``_resolve`` — no duplicated sandbox logic. Sandbox concurrency rides the
same process-wide pool (Wave5 3.1 ``execute_mod.get_sandbox_sem``, default 6):
no local semaphore here by design.

Run with: ``uv run python -m app.worker`` (or ``python -m app.worker --once``
for a single job, handy in tests).
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from fastapi.encoders import jsonable_encoder

from app.api.routes import execute as execute_mod
from app.core.queue.backends import get_queue
from app.core.trace.cfg_builder import build as build_cfg
from app.core.trace.parser import parse as parse_trace
from app.models.request import ExecuteRequest
from app.models.response import ExecuteResponse

logger = logging.getLogger(__name__)


async def _run_payload(payload: dict) -> dict:
    """Execute one job payload into an ExecuteResponse JSON dict."""
    req = ExecuteRequest(
        code=payload.get("code", ""),
        raw_stdin=payload.get("raw_stdin", ""),
        compressed=bool(payload.get("compressed", False)),
    )
    resolved = await execute_mod._resolve(req, kind="single")
    if resolved.input_error is not None:
        raise RuntimeError(f"Missing stdin: {resolved.input_error}")
    if resolved.instrumentation_error is not None:
        raise RuntimeError(f"Instrumentation error: {resolved.instrumentation_error}")
    if resolved.sandbox_error is not None:
        raise RuntimeError(f"Sandbox error: {resolved.sandbox_error}")
    assert resolved.run_result is not None
    run_result = resolved.run_result
    if run_result.compile_error:
        resp = ExecuteResponse(stdout="", compile_error=run_result.compile_error)
        return jsonable_encoder(resp, by_alias=False)
    events = await asyncio.to_thread(parse_trace, run_result.trace_raw, compressed=req.compressed)
    cfg_nodes, cfg_edges = await asyncio.to_thread(build_cfg, events, req.code)
    runtime_error: str | None = None
    if run_result.timed_out:
        runtime_error = "Execution timed out (10s limit)"
    elif run_result.exit_code != 0 and run_result.stderr_clean:
        runtime_error = run_result.stderr_clean
    elif not events and resolved.trace_call_count == 0:
        runtime_error = (
            "No trace points were injected — check libclang parsing and instrumentation rules"
        )
    resp = ExecuteResponse(
        stdout=run_result.stdout,
        runtime_error=runtime_error,
        timed_out=run_result.timed_out,
        truncated=run_result.truncated,
        trace=[e.model_dump(by_alias=False) for e in events],
        cfg_nodes=cfg_nodes,
        cfg_edges=cfg_edges,
        total_steps=len(events),
    )
    return jsonable_encoder(resp, by_alias=False)


async def run_once(timeout: float = 1.0) -> bool:
    """Poll once: run a single job if present. Returns True when work ran."""
    queue = get_queue()
    item = await queue.dequeue(timeout=timeout)
    if item is None:
        return False
    job_id, payload = item
    await queue.set_status(job_id, "running")
    try:
        result = await _run_payload(payload)
    except Exception as e:
        logger.exception("Job %s failed", job_id)
        await queue.set_status(job_id, "error", error=str(e))
        return True
    await queue.set_status(job_id, "done", result=result)
    return True


async def run_forever(poll_timeout: float = 5.0) -> None:
    """Poll forever until cancelled (worker main loop)."""
    logger.info("Worker started — polling job queue")
    while True:
        await run_once(timeout=poll_timeout)


def main() -> None:
    """CLI entrypoint: ``python -m app.worker [--once]``."""
    parser = argparse.ArgumentParser(description="AlgoTheseus async job worker")
    parser.add_argument("--once", action="store_true", help="Run one job then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.once:
        ran = asyncio.run(run_once())
        raise SystemExit(0 if ran else 1)
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
