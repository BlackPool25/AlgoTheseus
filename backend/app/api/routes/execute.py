"""
api/routes/execute.py — POST /execute and POST /execute-batch endpoints.

Pipeline (single):
  1. Parse the raw stdin (strip prose, format correctly).
  2. Instrument the user's C++ source (inject trace calls).
  3. Run the instrumented binary in the Docker sandbox.
  4. Parse the TRACE: lines into typed events.
  5. Build a CFG from the events.
  6. Return everything in one response (JSON or NDJSON streaming).

Single-endpoint flow: the user provides code + raw_stdin, the server
handles stdin cleaning and execution in one shot.

Streaming (compressed=true):
  - Response is application/x-ndjson (newline-delimited JSON).
  - Each trace event is yielded as it becomes available.
  - CFG + metadata is the final NDJSON line.
  - X-CFG: true header signals this is a streaming response.

Batch endpoint:
  POST /execute-batch — runs multiple test cases against the same code
  in parallel. Instruments once, then fans out to one sandbox per test.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.executor.docker_runner import run_in_sandbox
from app.core.instrumenter.injector import instrument
from app.core.stdin.parser import parse_stdin
from app.core.trace.cfg_builder import build as build_cfg
from app.core.trace.parser import parse as parse_trace
from app.models.request import ExecuteBatchRequest, ExecuteRequest
from app.models.response import ExecuteBatchResponseItem, ExecuteResponse

logger = logging.getLogger(__name__)

# ── Single-execute router ─────────────────────────────────────────────────
router = APIRouter()

# ── Batch-execute router ──────────────────────────────────────────────────
batch_router = APIRouter()

_TESTCASE_DIR = Path("/tmp/dsa-visualizer/testcases")
_BATCH_PER_CASE_TIMEOUT = 10  # seconds per test case


# ── Streaming NDJSON generator ───────────────────────────────────────────────


async def _stream_execute(req: ExecuteRequest) -> AsyncGenerator[bytes, None]:
    """Async generator that yields NDJSON lines for a streaming /execute.

    NDJSON format (each line is a complete JSON object):
      {"type":"event","data":{...}}   — one per trace event
      {"type":"cfg", ...}             — final line with CFG + metadata
      {"type":"error", ...}           — error line (compile/runtime)

    The response carries ``X-CFG: true`` and ``Content-Type: application/x-ndjson``.
    """
    # ── Step 1: Parse stdin ────────────────────────────────────────────────────
    cleaned_stdin, _ = await parse_stdin(req.code, req.raw_stdin)

    # ── Step 2: Instrument ────────────────────────────────────────────────────
    try:
        instrumented = instrument(req.code)
    except Exception as e:
        payload = json.dumps({"type": "error", "compile_error": f"Instrumentation error: {e}"})
        yield (payload + "\n").encode()
        return

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # ── Step 3: Run in sandbox ────────────────────────────────────────────────
    try:
        run_result = await run_in_sandbox(instrumented, cleaned_stdin)
    except Exception as e:
        logger.exception("Sandbox execution failed")
        payload = json.dumps({"type": "error", "runtime_error": f"Sandbox error: {e}"})
        yield (payload + "\n").encode()
        return

    # Compile error — yield early
    if run_result.compile_error:
        payload = json.dumps({"type": "error", "compile_error": run_result.compile_error})
        yield (payload + "\n").encode()
        return

    # ── Step 4: Parse trace —──────────────────────────────────────────────────
    events = parse_trace(run_result.trace_raw, compressed=True)

    # Debug dumps for local diagnosis
    try:
        Path("/tmp/dsa_last_trace_raw.txt").write_text(
            "\n".join(run_result.trace_raw), encoding="utf-8"
        )
    except Exception:
        logger.debug("Failed to write trace debug file", exc_info=True)

    # ── Yield each event as an NDJSON line ────────────────────────────────────
    for event in events:
        event_data = event.model_dump(by_alias=False)
        payload = json.dumps({"type": "event", "data": event_data})
        yield (payload + "\n").encode()

    # ── Step 5: Build CFG ─────────────────────────────────────────────────────
    cfg_nodes, cfg_edges = build_cfg(events)

    # Determine runtime error
    runtime_error: str | None = None
    if run_result.timed_out:
        runtime_error = "Execution timed out (10s limit)"
    elif run_result.exit_code != 0 and run_result.stderr_clean:
        runtime_error = run_result.stderr_clean
    elif not events and trace_call_count == 0:
        runtime_error = (
            "No trace points were injected — check libclang parsing and instrumentation rules"
        )

    # ── Yield CFG as final NDJSON line ────────────────────────────────────────
    cfg_payload = json.dumps({
        "type": "cfg",
        "stdout": run_result.stdout,
        "runtime_error": runtime_error,
        "timed_out": run_result.timed_out,
        "truncated": run_result.truncated,
        "cfg_nodes": [n.model_dump() for n in cfg_nodes],
        "cfg_edges": [e.model_dump() for e in cfg_edges],
        "total_steps": len(events),
    })
    yield (cfg_payload + "\n").encode()


# ── Single-execute endpoint ────────────────────────────────────────────────────


@router.post("", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest) -> ExecuteResponse | StreamingResponse:
    """Instrument, run, and trace a C++ program.

    Steps:
      1. Parse raw stdin into clean input.
      2. Instrument source with libclang injector.
      3. Run in Docker sandbox with cleaned stdin.
      4. Parse trace output.
      5. Build CFG.
      6. Return structured response (JSON or NDJSON streaming).

    When ``compressed=True`` the response is a StreamingResponse with
    ``Content-Type: application/x-ndjson``.  Each trace event is yielded
    as it becomes available.  The final line contains the CFG + metadata.

    When ``compressed=False`` (default) the full JSON response is returned
    in one shot — existing non-streaming behaviour.

    Returns compile_error if compilation fails (trace will be empty).
    Returns runtime_error if the program crashes or times out.
    """
    # ── Streaming path ────────────────────────────────────────────────────────
    if req.compressed:
        return StreamingResponse(
            _stream_execute(req),
            media_type="application/x-ndjson",
            headers={"X-CFG": "true"},
        )

    # ── Non-streaming path (existing behaviour) ──────────────────────────────

    # Step 1: Parse stdin
    cleaned_stdin, _ = await parse_stdin(req.code, req.raw_stdin)

    # Step 2: Instrument
    try:
        instrumented = instrument(req.code)
    except Exception as e:
        logger.exception("Instrumentation failed")
        raise HTTPException(status_code=422, detail=f"Instrumentation error: {e}")

    # Debug dumps for local diagnosis
    try:
        Path("/tmp/dsa_last_instrumented.cpp").write_text(instrumented, encoding="utf-8")
    except Exception:
        logger.debug("Failed to write instrumented debug file", exc_info=True)

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # Step 3: Run in sandbox
    try:
        run_result = await run_in_sandbox(instrumented, cleaned_stdin)
    except Exception as e:
        logger.exception("Sandbox execution failed")
        raise HTTPException(status_code=500, detail=f"Sandbox error: {e}")

    # Compile error — return early with the error message
    if run_result.compile_error:
        return ExecuteResponse(
            stdout="",
            compile_error=run_result.compile_error,
        )

    # Step 4: Parse trace
    events = parse_trace(run_result.trace_raw, compressed=req.compressed)

    try:
        Path("/tmp/dsa_last_trace_raw.txt").write_text(
            "\n".join(run_result.trace_raw), encoding="utf-8"
        )
    except Exception:
        logger.debug("Failed to write trace debug file", exc_info=True)

    # Step 5: Build CFG
    cfg_nodes, cfg_edges = build_cfg(events)

    # Determine runtime error
    runtime_error: str | None = None
    if run_result.timed_out:
        runtime_error = "Execution timed out (10s limit)"
    elif run_result.exit_code != 0 and run_result.stderr_clean:
        runtime_error = run_result.stderr_clean
    elif not events and trace_call_count == 0:
        runtime_error = (
            "No trace points were injected — check libclang parsing and instrumentation rules"
        )

    return ExecuteResponse(
        stdout=run_result.stdout,
        runtime_error=runtime_error,
        timed_out=run_result.timed_out,
        truncated=run_result.truncated,
        trace=[e.model_dump(by_alias=False) for e in events],
        cfg_nodes=cfg_nodes,
        cfg_edges=cfg_edges,
        total_steps=len(events),
    )


# ── Batch execution ──────────────────────────────────────────────────────────────────


@batch_router.post("", response_model=list[ExecuteBatchResponseItem])
async def execute_batch(req: ExecuteBatchRequest) -> list[ExecuteBatchResponseItem]:
    """Run code against multiple test cases in parallel.

    Steps for each test case:
      1. Read input.txt from /tmp/dsa-visualizer/testcases/<test_id>/
      2. Instrument the source (done once, shared across all cases).
      3. Run the instrumented binary in a dedicated sandbox.
      4. Parse trace output and build CFG.

    Each test case gets its own 10s timeout via ``asyncio.wait_for``.
    Containers are never shared between test cases.
    """
    # ── Read all test inputs upfront ──────────────────────────────────────────
    test_inputs: list[tuple[str, str]] = []
    for test_id in req.test_ids:
        input_file = _TESTCASE_DIR / test_id / "input.txt"
        if not input_file.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Test case '{test_id}' not found at {input_file}",
            )
        test_inputs.append((test_id, input_file.read_text(encoding="utf-8")))

    # ── Instrument once (same code, reused across all test cases) ─────────────
    try:
        instrumented = instrument(req.code)
    except Exception as e:
        logger.exception("Instrumentation failed")
        raise HTTPException(status_code=422, detail=f"Instrumentation error: {e}")

    # Debug dump
    try:
        Path("/tmp/dsa_last_instrumented.cpp").write_text(instrumented, encoding="utf-8")
    except Exception:
        logger.debug("Failed to write instrumented debug file", exc_info=True)

    trace_call_count = instrumented.count("__TRACE_")
    if trace_call_count == 0:
        logger.warning("Instrumentation produced zero trace calls")

    # ── Per-test-case runner ──────────────────────────────────────────────────
    async def _run_one(test_id: str, stdin_data: str) -> ExecuteBatchResponseItem:
        """Run the full pipeline for a single test case."""
        try:
            run_result = await asyncio.wait_for(
                run_in_sandbox(instrumented, stdin_data),
                timeout=_BATCH_PER_CASE_TIMEOUT,
            )
        except TimeoutError:
            logger.warning("Test case %s timed out after %ds", test_id, _BATCH_PER_CASE_TIMEOUT)
            return ExecuteBatchResponseItem(
                test_id=test_id,
                stdout="",
                runtime_error=f"Execution timed out ({_BATCH_PER_CASE_TIMEOUT}s limit)",
                timed_out=True,
            )
        except Exception as e:
            logger.exception("Sandbox execution failed for test %s", test_id)
            return ExecuteBatchResponseItem(
                test_id=test_id,
                stdout="",
                runtime_error=f"Sandbox error: {e}",
            )

        # Compile error — return early
        if run_result.compile_error:
            return ExecuteBatchResponseItem(
                test_id=test_id,
                stdout="",
                compile_error=run_result.compile_error,
            )

        # Parse trace and build CFG
        events = parse_trace(run_result.trace_raw)
        cfg_nodes, cfg_edges = build_cfg(events)

        # Determine runtime error
        runtime_error: str | None = None
        if run_result.timed_out:
            runtime_error = f"Execution timed out ({_BATCH_PER_CASE_TIMEOUT}s limit)"
        elif run_result.exit_code != 0 and run_result.stderr_clean:
            runtime_error = run_result.stderr_clean
        elif not events and trace_call_count == 0:
            runtime_error = "No trace points were injected — check libclang parsing and instrumentation rules"

        return ExecuteBatchResponseItem(
            test_id=test_id,
            stdout=run_result.stdout,
            runtime_error=runtime_error,
            timed_out=run_result.timed_out,
            truncated=run_result.truncated,
            trace=[e.model_dump(by_alias=False) for e in events],
            cfg_nodes=cfg_nodes,
            cfg_edges=cfg_edges,
            total_steps=len(events),
        )

    # ── Fan out in parallel ───────────────────────────────────────────────────
    results = await asyncio.gather(*[_run_one(tid, inp) for tid, inp in test_inputs])
    return list(results)
