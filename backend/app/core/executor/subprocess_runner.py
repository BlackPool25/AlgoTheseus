"""
subprocess_runner.py — Socketless single-container sandbox (task 20).

Same contract as docker_runner.run_in_sandbox: compiles the instrumented
source with the image-bundled g++ and runs the binary inside a per-run
working-dir jail. Selected via SANDBOX_MODE=subprocess; the Docker-DooD
path stays the default for local dev. NEVER mounts the Docker socket.

Jail primitives (stdlib + POSIX only):
  - Working-dir jail: one mkdtemp dir per run under /tmp/algo-theseus,
    removed afterwards. CWD of the child is the jail, so relative paths
    (including the tracer's fd-1 temp files from todo 10) stay inside.
  - setrlimit: RLIMIT_CPU (timeout), RLIMIT_AS (memory), RLIMIT_FSIZE
    (file size, tmpfs-64m equivalent), RLIMIT_NPROC (pids_limit
    approximation — RLIMIT_NPROC counts per-uid processes, so this is an
    approximation, stated honestly; process-group kill is the hard backstop).
  - Wall-time kill: subprocess timeout + start_new_session, killpg(SIGKILL)
    on expiry so forked children die with the leader.
  - stdout/stderr byte caps: child output goes to files inside the jail
    (bounded by RLIMIT_FSIZE), only the first 1MB of each is returned.
  - No network: minimal env (PATH only, no proxy vars, no secrets) +
    close_fds=True. Honest limit: without a net namespace a raw socket()
    syscall is not blocked; exfiltration surface is closed env + timeout,
    and full network_disabled isolation remains a docker-mode property.
  - Drop privileges: setgid/setuid to `nobody` best-effort. When the host
    process is not root (local dev) the calls raise PermissionError and we
    fall back to the current uid — never crash.
  - Read-only equivalents: source files chmod 444 after writing (child as
    `nobody` cannot overwrite them); the jail dir itself stays writable
    because the tracer MUST create temp files inside it (todo 10) — dir
    perms + nobody + rlimits are the read_only/pids_limit equivalents.

Limits mirror sandbox_config.py (never widened here): 10s timeout,
128m run-time address space, 64 processes. The compile step gets a wider
address-space allowance (2GB) because cc1plus cannot fit in 128m of
*virtual* space — that is a toolchain property, not a program limit;
CPU/file-size/process limits still apply to the compiler.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import signal
import subprocess
import threading
from pathlib import Path
from uuid import uuid4

from .docker_runner import RunResult, _apply_output_guard, _is_compile_error, _split_stderr
from .sandbox_config import EXECUTION_TIMEOUT_SECONDS

_TRACER_H = Path(__file__).parent.parent / "instrumenter" / "tracer.h"
_JAIL_ROOT = Path("/tmp/algo-theseus")

# Output byte caps (docker path has no stdout cap; this is a subprocess-jail
# DoS guard only — trace semantics unchanged, TRACE: lines still split by
# _split_stderr with MAX_TRACE_LINES).
_STDOUT_CAP_BYTES = 1_000_000
_STDERR_CAP_BYTES = 1_000_000

# rlimit values mirroring sandbox_config.py.
_RUN_RLIMIT_AS = 128 * 1024 * 1024  # mem_limit 128m equivalent
_COMPILE_RLIMIT_AS = 2 * 1024**3  # toolchain exception, see docstring
_RLIMIT_FSIZE = 64 * 1024 * 1024  # tmpfs 64m equivalent
_RLIMIT_NPROC = 64  # pids_limit approximation

_MIN_ENV = {"PATH": "/usr/bin:/bin"}

# Wave5 3.1: cap concurrent g++ spawns process-wide at 50. Sync semaphore —
# the jail runs in worker threads via asyncio.to_thread, so an asyncio
# semaphore cannot gate it. Guards the compile step only; the run step is
# already bounded by the asyncio sandbox pool in execute.py.
_GXX_SPAWN_SEM = threading.Semaphore(50)

_NOBODY_UID = 65534
_NOBODY_GID = 65534


def _resolve_nobody() -> tuple[int, int]:
    try:
        import pwd

        pw = pwd.getpwnam("nobody")
        return pw.pw_uid, pw.pw_gid
    except Exception:  # noqa: BLE001 — fallback IDs keep the jail working anywhere
        return _NOBODY_UID, _NOBODY_GID


def _nproc_limit_for(uid: int, fixed: bool) -> int:
    """pids_limit approximation.

    fixed=True (jailed run as dropped-`nobody` uid): flat _RLIMIT_NPROC —
    that uid owns ~no other tasks, so a small cap bounds fork bombs with
    no headroom inflation.
    fixed=False (compile as the current uid): current per-uid thread count
    + headroom, since RLIMIT_NPROC counts threads and g++ itself spawns
    cc1plus — a flat 64 starves the compiler on a busy box. Never raises.
    """
    if fixed:
        return _RLIMIT_NPROC
    try:
        n = 0
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                if os.stat(f"/proc/{pid}").st_uid != uid:
                    continue
                n += len(os.listdir(f"/proc/{pid}/task"))
            except OSError:
                continue
        return max(_RLIMIT_NPROC, n + _RLIMIT_NPROC)
    except Exception:  # noqa: BLE001 — fallback keeps the jail working anywhere
        return 4096


def _apply_limits(as_bytes: int, uid: int, drop_privs: bool) -> None:
    """Best-effort rlimits for the jail child. Never raises."""
    import resource

    for args in (
        (resource.RLIMIT_CPU, (EXECUTION_TIMEOUT_SECONDS,) * 2),
        (resource.RLIMIT_AS, (as_bytes, as_bytes)),
        (resource.RLIMIT_FSIZE, (_RLIMIT_FSIZE, _RLIMIT_FSIZE)),
        (resource.RLIMIT_NPROC, (_nproc_limit_for(uid, drop_privs),) * 2),
    ):
        try:
            resource.setrlimit(args[0], args[1])
        except Exception:  # noqa: BLE001, S110 — best-effort rlimit, jail proceeds
            pass


def _drop_privileges() -> None:
    """Best-effort setgid/setuid to nobody. No-op (never raises) when not root."""
    uid, gid = _resolve_nobody()
    try:
        os.setgid(gid)
        os.setuid(uid)
    except Exception:  # noqa: BLE001, S110 — non-root dev fallback runs as current user
        pass


def _run_guarded(
    argv: list[str],
    cwd: Path,
    stdin_path: Path | None,
    stdout_path: Path,
    stderr_path: Path,
    as_bytes: int,
    drop_privs: bool,
) -> tuple[int, bool]:
    """Run argv under rlimits; return (exit_code, timed_out). Files bound output."""

    def _preexec() -> None:
        _apply_limits(as_bytes, os.getuid(), drop_privs)
        if drop_privs:
            _drop_privileges()

    with contextlib.ExitStack() as stack:
        stdin_f = stack.enter_context(open(stdin_path, "rb")) if stdin_path else None
        out = stack.enter_context(open(stdout_path, "wb"))
        err = stack.enter_context(open(stderr_path, "wb"))
        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(cwd),
                stdin=stdin_f,
                stdout=out,
                stderr=err,
                env=dict(_MIN_ENV),
                close_fds=True,
                start_new_session=True,
                preexec_fn=_preexec,  # noqa: PLW1509 — fork+exec at once; preexec touches no locks
            )
        except OSError as exc:
            stderr_path.write_text(f"sandbox spawn failed: {exc}", encoding="utf-8")
            return 127, False
        try:
            return proc.wait(timeout=EXECUTION_TIMEOUT_SECONDS), False
        except subprocess.TimeoutExpired:
            for _ in range(3):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except Exception:  # noqa: BLE001, S110 — child may have exited mid-kill
                    pass
                try:
                    return proc.wait(timeout=5), True
                except subprocess.TimeoutExpired:
                    continue
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:  # noqa: BLE001, S110
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            return -1, True


def _read_capped(path: Path, cap: int) -> str:
    try:
        with open(path, "rb") as f:
            return f.read(cap).decode("utf-8", errors="replace")
    except OSError:
        return ""


def _compile_argv(cdir: Path) -> list[str]:
    """Shared g++ argv (mirrors TOOLCHAIN_FLAGS). Single place for compile flags."""
    return [
        "g++",
        "-O0",
        "-g",
        "-std=c++17",
        "-ftrivial-auto-var-init=zero",
        "-pipe",
        "-ftemplate-depth=100",
        "-I",
        str(cdir),
        "-o",
        str(cdir / "prog"),
        str(cdir / "prog.cpp"),
    ]


def compile_source_sync(cpp_source: str) -> tuple[bytes | None, str | None, bool]:
    """Compile once; return (binary_bytes, compile_error, timed_out).

    Blocking — call via asyncio.to_thread. The temp compile dir is removed
    afterwards; only the binary bytes leave. Exactly one of binary_bytes /
    compile_error is set (timed_out implies compile_error).
    """
    _JAIL_ROOT.mkdir(parents=True, exist_ok=True)
    cdir = _JAIL_ROOT / f"cc_{uuid4().hex}"
    cdir.mkdir(parents=True, exist_ok=False)
    try:
        (cdir / "prog.cpp").write_text(cpp_source, encoding="utf-8")
        (cdir / "tracer.h").write_text(_TRACER_H.read_text(encoding="utf-8"), encoding="utf-8")
        for name in ("prog.cpp", "tracer.h"):
            (cdir / name).chmod(0o444)
        compile_out, compile_err = cdir / "cout.bin", cdir / "cerr.bin"
        with _GXX_SPAWN_SEM:
            code, compile_timed_out = _run_guarded(
                _compile_argv(cdir),
                cwd=cdir,
                stdin_path=None,
                stdout_path=compile_out,
                stderr_path=compile_err,
                as_bytes=_COMPILE_RLIMIT_AS,
                drop_privs=False,
            )
        if compile_timed_out or code != 0:
            err = _read_capped(compile_err, _STDERR_CAP_BYTES)
            if compile_timed_out and not err:
                err = f"g++ compile timed out after {EXECUTION_TIMEOUT_SECONDS}s"
            return None, err or "g++ failed with no output", compile_timed_out
        try:
            return (cdir / "prog").read_bytes(), None, False
        except OSError as exc:
            return None, f"compiled binary unreadable: {exc}", False
    finally:
        shutil.rmtree(cdir, ignore_errors=True)


def run_binary_sync(binary_bytes: bytes, stdin_data: str = "") -> RunResult:
    """Run a prebuilt binary in a fresh per-run jail (run phase only, no compile).

    Blocking — call via asyncio.to_thread. Run-phase semantics match the old
    combined path exactly: same rlimits, drop-privs, output caps, cleanup.
    """
    _JAIL_ROOT.mkdir(parents=True, exist_ok=True)
    jail = _JAIL_ROOT / f"dsa_{uuid4().hex}"
    jail.mkdir(parents=True, exist_ok=False)
    try:
        prog = jail / "prog"
        prog.write_bytes(binary_bytes)
        prog.chmod(0o755)
        (jail / "input.txt").write_text(stdin_data, encoding="utf-8")
        (jail / "input.txt").chmod(0o444)
        run_out, run_err = jail / "rout.bin", jail / "rerr.bin"
        exit_code, timed_out = _run_guarded(
            [str(prog)],
            cwd=jail,
            stdin_path=jail / "input.txt",
            stdout_path=run_out,
            stderr_path=run_err,
            as_bytes=_RUN_RLIMIT_AS,
            drop_privs=True,
        )
        stdout = _read_capped(run_out, _STDOUT_CAP_BYTES)
        raw_stderr = _read_capped(run_err, _STDERR_CAP_BYTES)
        trace_raw, stderr_clean, truncated = _split_stderr(raw_stderr)

        if _is_compile_error(stderr_clean, exit_code) and not trace_raw:
            return RunResult(compile_error=stderr_clean)
        stderr_clean, truncated = _apply_output_guard(exit_code, stderr_clean, truncated)
        return RunResult(
            stdout=stdout,
            stderr_clean=stderr_clean,
            trace_raw=trace_raw,
            exit_code=exit_code,
            timed_out=timed_out,
            truncated=truncated,
        )
    finally:
        shutil.rmtree(jail, ignore_errors=True)


def _run_subprocess_sync(cpp_source: str, stdin_data: str = "") -> RunResult:
    """Blocking implementation — called via asyncio.to_thread."""
    binary, compile_error, timed_out = compile_source_sync(cpp_source)
    if compile_error is not None or binary is None:
        return RunResult(
            compile_error=compile_error or "g++ failed with no output",
            timed_out=timed_out,
        )
    return run_binary_sync(binary, stdin_data)


async def run_in_subprocess(cpp_source: str, stdin_data: str = "") -> RunResult:
    """Async entry point — same signature/shape as docker_runner.run_in_sandbox."""
    return await asyncio.to_thread(_run_subprocess_sync, cpp_source, stdin_data)
