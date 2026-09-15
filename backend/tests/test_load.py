"""
test_load.py — Wave-7 load + sandbox-adversarial battery (todo 30, RED-first).

Proves, against the LOCAL app only (ASGI transport / loopback uvicorn —
NEVER a public URL):
  1. 8 concurrent POST /execute complete with traces byte-equal to a serial run.
  2. Rate-limit loop: 30×200 then 429s with Retry-After (todo 23 contract).
  3. Sandbox escape battery: compile bomb, output flood, /proc write,
     /etc/passwd read, socket open, symlink escape — all contained with
     zero host effect.
  4. Warm p95 execute latency recorded (informational for H4, no fixed bar).

Sandbox: SANDBOX_MODE=subprocess (socketless jail from todo 20). The
concurrency + battery tests use the REAL sandbox; only the 35-post
rate-limit loop is mocked (it burns quota, not CPU).

RED-first note: run WITHOUT SANDBOX_MODE first — docker mode has no daemon/
image here, so the concurrency test fails (proving it exercises the real
sandbox, not a mock). Then SANDBOX_MODE=subprocess → GREEN.
"""

from __future__ import annotations

import asyncio
import os
import statistics
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.executor import subprocess_runner as jail
from app.core.executor.docker_runner import RunResult
from app.core.executor.sandbox_config import EXECUTION_TIMEOUT_SECONDS
from app.main import app

# ── Shared fixtures ─────────────────────────────────────────────────────────

# Deterministic load program: the corpus binary-search fixture (proven to
# instrument + compile + trace in this toolchain; a hand-written for-loop in
# main mis-scopes `i` in the injector — kept out deliberately).
LOAD_CODE = (Path(__file__).parent / "fixtures" / "corpus" / "binary_search.cpp").read_text()
LOAD_STDIN = ""

OK_RUN = RunResult(
    stdout="",
    stderr_clean="",
    trace_raw=[],
    exit_code=0,
    timed_out=False,
    truncated=False,
)


def _reset_limiter_storage() -> None:
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()


@pytest.fixture
def _fresh_limits():
    _reset_limiter_storage()
    yield
    _reset_limiter_storage()


@pytest.fixture
def _subprocess_sandbox(monkeypatch):
    monkeypatch.setenv("SANDBOX_MODE", "subprocess")
    yield


async def _post(ac: AsyncClient, code: str, stdin: str, xff: str):
    """POST /execute, returning (status, body, elapsed_ms)."""
    start = time.monotonic()
    r = await ac.post(
        "/execute",
        json={"code": code, "raw_stdin": stdin},
        headers={"X-Forwarded-For": xff},
    )
    return r.status_code, r.json(), (time.monotonic() - start) * 1000.0


# ── 1. 8-way concurrency with trace equality vs serial ───────────────────────


class TestConcurrentLoad:
    async def test_8_concurrent_traces_equal_serial(
        self, _fresh_limits, _subprocess_sandbox
    ):
        # 8 DISTINCT programs (target 0..7): distinct cache keys force 8 real
        # concurrent sandbox compiles+runs — identical code would all HIT the
        # warm-instance cache and prove nothing about sandbox concurrency.
        variants = [LOAD_CODE.replace("bsearch(arr, 7)", f"bsearch(arr, {k})") for k in range(8)]
        assert len(set(variants)) == 8
        xff = "10.30.1.1"
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            # Concurrent FIRST (cold cache → 8 real sandbox runs), serial
            # references after. Reversing the order would let every
            # concurrent request HIT the serial-warmed cache and prove
            # nothing about sandbox concurrency.
            results = await asyncio.gather(
                *[_post(ac, code, LOAD_STDIN, xff) for code in variants]
            )

            serials = []
            for code in variants:
                status, body, _ = await _post(ac, code, LOAD_STDIN, xff)
                assert status == 200, body
                assert body["compile_error"] is None
                assert len(body["trace"]) > 0, "reference run produced no trace"
                serials.append(body)

        latencies = []
        for i, ((status, body, elapsed_ms), serial) in enumerate(zip(results, serials)):
            assert status == 200, f"concurrent request {i}: {body}"
            # Trace-equality, not status-code equality: a misleading 200
            # with a divergent trace must fail here.
            assert body["trace"] == serial["trace"], f"trace drift on request {i}"
            assert body["stdout"] == serial["stdout"], f"stdout drift on request {i}"
            assert body["total_steps"] == serial["total_steps"]
            assert body["timed_out"] is False
            latencies.append(elapsed_ms)

        latencies.sort()
        p95 = latencies[min(int(0.95 * len(latencies)), len(latencies) - 1)]
        print(
            f"\nWARM_LATENCY_MS min={latencies[0]:.0f} "
            f"median={statistics.median(latencies):.0f} "
            f"p95={p95:.0f} max={latencies[-1]:.0f} n={len(latencies)}"
        )


# ── 2. Rate-limit loop (mocked sandbox — burns quota, not CPU) ───────────────


class TestRateLimitLoop:
    async def test_429s_after_30_with_retry_after(self, _fresh_limits):
        xff = "10.30.2.2"
        with (
            patch("app.api.routes.execute.run_in_sandbox", return_value=OK_RUN),
            patch("app.api.routes.execute.instrument", return_value="int main(){}"),
            patch("app.api.routes.execute.parse_stdin", return_value=("", "no changes")),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                statuses, retry_afters = [], []
                for _ in range(35):
                    r = await ac.post(
                        "/execute",
                        json={"code": "int main(){return 0;}", "raw_stdin": ""},
                        headers={"X-Forwarded-For": xff},
                    )
                    statuses.append(r.status_code)
                    if r.status_code == 429:
                        retry_afters.append(r.headers.get("Retry-After"))
        assert statuses[:30] == [200] * 30
        assert statuses[30:] == [429] * 5
        assert all(v is not None for v in retry_afters)


# ── 3. Sandbox-adversarial battery (real subprocess jail, zero host effect) ──


def _run(src: str, stdin: str = "") -> RunResult:
    return jail._run_subprocess_sync(src, stdin)


class TestEscapeBattery:
    def test_compile_bomb_contained(self, _subprocess_sandbox):
        src = (
            "#include <cstdio>\n"
            "template<int N> void f(){ f<N+1>(); }\n"
            "int main(){ f<0>(); return 0; }\n"
        )
        start = time.monotonic()
        r = _run(src)
        elapsed = time.monotonic() - start
        assert r.compile_error is not None or r.timed_out
        assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 25

    def test_output_flood_capped(self, _subprocess_sandbox):
        # Intends ~3.4MB; jail stdout cap is 1MB.
        src = (
            "#include <cstdio>\n"
            'int main(){for(long i=0;i<200000L;i++) std::puts("0123456789abcdef"); return 0;}\n'
        )
        start = time.monotonic()
        r = _run(src)
        elapsed = time.monotonic() - start
        assert len(r.stdout.encode()) <= jail._STDOUT_CAP_BYTES
        assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 10

    def test_infinite_loop_wall_kill(self, _subprocess_sandbox):
        src = "#include <cstdio>\nint main(){while(1){} return 0;}\n"
        start = time.monotonic()
        r = _run(src)
        elapsed = time.monotonic() - start
        assert r.timed_out is True
        assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 5

    def test_proc_write_denied(self, _subprocess_sandbox):
        src = (
            "#include <cstdio>\n"
            'int main(){FILE* w=std::fopen("/proc/sysrq-trigger","w");'
            'if(w){std::fputs("x",w); std::fclose(w); std::printf("wrote-proc"); return 9;}'
            'FILE* m=std::fopen("/proc/1/mem","r");'
            'if(m){std::fclose(m); std::printf("read-init-mem"); return 9;}'
            'std::printf("denied"); return 3;}\n'
        )
        r = _run(src)
        assert r.stdout == "denied"
        assert r.exit_code == 3

    def test_etc_passwd_read_contained_no_write(self, _subprocess_sandbox):
        # /etc/passwd is world-readable by design: reading it is allowed, but
        # the probe must not write anywhere outside the jail nor exfiltrate.
        marker = "/etc/dsa_load_escape_marker"
        if os.path.exists(marker):
            os.unlink(marker)
        src = (
            "#include <cstdio>\n"
            'int main(){FILE* f=std::fopen("/etc/passwd","r");'
            'if(f){char b[16]; std::fread(b,1,16,f); std::fclose(f);}'
            'FILE* w=std::fopen("/etc/dsa_load_escape_marker","w");'
            'if(w){std::fputs("pwned",w); std::fclose(w); std::printf("wrote-etc"); return 9;}'
            'std::printf("contained"); return 3;}\n'
        )
        r = _run(src)
        assert not os.path.exists(marker), "HOST EFFECT: jail wrote to /etc"
        assert r.stdout == "contained"
        assert r.exit_code == 3

    def test_socket_open_refused(self, _subprocess_sandbox):
        src = (
            "#include <cstdio>\n#include <sys/socket.h>\n#include <netinet/in.h>\n"
            "#include <arpa/inet.h>\n#include <unistd.h>\n"
            "int main(){int s=socket(AF_INET,SOCK_STREAM,0); if(s<0){std::printf(\"no-sock\"); return 3;}"
            "struct sockaddr_in a; a.sin_family=AF_INET; a.sin_port=htons(9);"
            "a.sin_addr.s_addr=inet_addr(\"127.0.0.1\");"
            'if(connect(s,(struct sockaddr*)&a,sizeof(a))!=0){std::printf("refused"); close(s); return 3;}'
            'std::printf("connected?!"); return 0;}\n'
        )
        r = _run(src)
        assert r.stdout in ("refused", "no-sock")
        assert r.exit_code == 3

    def test_symlink_escape_blocked(self, _subprocess_sandbox):
        marker = "/etc/dsa_load_symlink_marker"
        if os.path.exists(marker):
            os.unlink(marker)
        src = (
            "#include <cstdio>\n#include <unistd.h>\n"
            'int main(){symlink("/etc","link");'
            'FILE* w=std::fopen("/etc/dsa_load_symlink_marker","w");'
            'if(w){std::fputs("pwned",w); std::fclose(w); std::printf("wrote-etc"); return 9;}'
            'FILE* f=std::fopen("link/hostname","r");'
            'if(f){std::fclose(f); std::printf("read-via-link"); return 3;}'
            'std::printf("contained"); return 3;}\n'
        )
        r = _run(src)
        assert not os.path.exists(marker), "HOST EFFECT: jail wrote to /etc"
        assert r.exit_code == 3
        assert r.stdout in ("contained", "read-via-link")

    def test_jail_dir_cleaned(self, _subprocess_sandbox):
        root = jail._JAIL_ROOT
        before = set(os.listdir(root)) if root.is_dir() else set()
        _run('#include <cstdio>\nint main(){std::printf("hi"); return 0;}\n')
        after = set(os.listdir(root)) if root.is_dir() else set()
        assert after - before == set()
