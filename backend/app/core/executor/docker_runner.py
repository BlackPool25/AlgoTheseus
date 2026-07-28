"""
docker_runner.py — Runs instrumented C++ code inside a Docker sandbox.

Flow:
  1. Write instrumented .cpp + tracer.h + optional input.txt to a temp dir.
  2. Spin up a container with that dir mounted read-only at /mnt/code.
  3. Run a shell script that: compiles, then runs if compile succeeds.
  4. Split stderr into TRACE: lines and real error lines.
  5. Return a structured RunResult.

We use a single container for both compile and run to avoid the complexity
of passing the binary between two containers. The binary lives in /tmp (tmpfs).

Gotcha: asyncio.to_thread wraps all blocking Docker SDK calls.
Gotcha: The container is always removed (auto_remove=True) even on timeout.
Gotcha: The sandbox directory under /tmp/dsa-visualizer is chmod'd to 755 so the
container (running as root) can read the mounted files.
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import docker
import docker.errors

from .sandbox_config import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_TRACE_LINES,
    SANDBOX_CONFIG,
    SANDBOX_IMAGE,
)

# Path to tracer.h — copied into the temp dir before compilation
_TRACER_H = Path(__file__).parent.parent / "instrumenter" / "tracer.h"

# Shell script run inside the container:
# - Compile to /tmp/prog
# - If compile fails, print errors to stderr and exit 1
# - If compile succeeds, run with stdin from /mnt/code/input.txt
_CONTAINER_SCRIPT = """
g++ -O0 -g -std=c++17 -I /mnt/code -o /tmp/prog /mnt/code/prog.cpp 2>/tmp/compile_err
if [ $? -ne 0 ]; then
    cat /tmp/compile_err >&2
    exit 1
fi
/tmp/prog < /mnt/code/input.txt
"""


@dataclass
class RunResult:
    """Structured result from a sandbox execution."""
    stdout: str = ""
    stderr_clean: str = ""      # stderr lines that are NOT TRACE: prefixed
    trace_raw: list[str] = field(default_factory=list)
    exit_code: int = 0
    compile_error: str | None = None
    timed_out: bool = False
    truncated: bool = False     # True if trace was cut at MAX_TRACE_LINES


def _split_stderr(raw: str) -> tuple[list[str], str, bool]:
    """Split raw stderr into (trace_lines, clean_stderr, truncated).

    trace_lines: JSON strings (TRACE: prefix stripped), capped at MAX_TRACE_LINES.
    clean_stderr: everything else.
    truncated: True if trace was cut.
    """
    trace: list[str] = []
    clean: list[str] = []
    truncated = False
    for line in raw.splitlines():
        if line.startswith("TRACE:"):
            if len(trace) < MAX_TRACE_LINES:
                trace.append(line[len("TRACE:"):])
            else:
                truncated = True
        else:
            clean.append(line)
    return trace, "\n".join(clean), truncated


def _is_compile_error(stderr_clean: str, exit_code: int) -> bool:
    """Heuristic: if stderr contains g++ error markers and no TRACE: lines, it's a compile error."""
    markers = ["error:", "fatal error:", "undefined reference"]
    return exit_code != 0 and any(m in stderr_clean for m in markers)


def _run_container_sync(cpp_source: str, stdin_data: str) -> RunResult:
    """Blocking implementation — called via asyncio.to_thread."""
    client = docker.from_env()
    _sandbox_root = Path("/tmp/dsa-visualizer")
    tmp = _sandbox_root / f"dsa_{uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)

    try:
        # Write files
        (tmp / "prog.cpp").write_text(cpp_source, encoding="utf-8")
        (tmp / "input.txt").write_text(stdin_data, encoding="utf-8")
        tracer_content = _TRACER_H.read_text(encoding="utf-8")
        (tmp / "tracer.h").write_text(tracer_content, encoding="utf-8")

        # Make world-readable (default umask may restrict permissions)
        tmp.chmod(0o755)
        for f in tmp.iterdir():
            f.chmod(0o644)

        # Build the config — exclude 'tmpfs' key since we pass it separately
        config = {k: v for k, v in SANDBOX_CONFIG.items() if k != "tmpfs"}

        container = client.containers.run(
            image=SANDBOX_IMAGE,
            command=["sh", "-c", _CONTAINER_SCRIPT],
            volumes={str(tmp): {"bind": "/mnt/code", "mode": "ro"}},
            tmpfs={"/tmp": "size=64m,exec"},  # exec needed to run the compiled binary
            detach=True,
            stdout=True,
            stderr=True,
            **config,
        )

        try:
            result = container.wait(timeout=EXECUTION_TIMEOUT_SECONDS)
            exit_code = result["StatusCode"]
            timed_out = False
        except Exception:
            container.kill()
            timed_out = True
            exit_code = -1

        stdout_bytes = container.logs(stdout=True, stderr=False)
        stderr_bytes = container.logs(stdout=False, stderr=True)
        container.remove(force=True)

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        raw_stderr = stderr_bytes.decode("utf-8", errors="replace")
        trace_raw, stderr_clean, truncated = _split_stderr(raw_stderr)

        # Detect compile error
        if _is_compile_error(stderr_clean, exit_code) and not trace_raw:
            return RunResult(compile_error=stderr_clean)

        return RunResult(
            stdout=stdout,
            stderr_clean=stderr_clean,
            trace_raw=trace_raw,
            exit_code=exit_code,
            timed_out=timed_out,
            truncated=truncated,
        )

    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def run_in_sandbox(cpp_source: str, stdin_data: str = "") -> RunResult:
    """Async entry point — runs the blocking Docker work in a thread pool.

    Args:
        cpp_source: Complete instrumented C++ source (already has #include "tracer.h").
        stdin_data: Raw stdin string to feed to the program.

    Returns:
        RunResult with stdout, clean stderr, raw trace lines, and exit code.
    """
    return await asyncio.to_thread(_run_container_sync, cpp_source, stdin_data)
