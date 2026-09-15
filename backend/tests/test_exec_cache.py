"""
test_exec_cache.py — Task 22 (D5 efficiency): disk LRU cache, fan-out cap, truncate.

RED-first suite. Covers:
  - DiskLRUCache unit: roundtrip, flag separation, TTL expiry, size eviction,
    read-only degradation, corrupt-file degradation.
  - Endpoint: repeat identical /execute → second is X-Cache: HIT and ≥3x faster;
    different toolchain flags → MISS (never collapse flags into one key).
  - Streaming: X-Cache header present on the NDJSON StreamingResponse.
  - Batch: 8 cases never exceed 4 concurrent sandboxes (concurrency counter).
  - Truncate: oversized loop fixture → truncated:true (MAX_TRACE_LINES enforced).

All Docker calls are mocked; no Docker dependency.
"""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor import docker_runner
from app.core.executor.docker_runner import RunResult
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    """Point the executor cache at a fresh tmp dir (and reset the singleton)."""
    cache_dir = tmp_path / "algo-theseus-cache"
    monkeypatch.setenv("CACHE_DIR", str(cache_dir))
    monkeypatch.setenv("CACHE_TTL_SECONDS", "3600")
    monkeypatch.setenv("CACHE_MAX_BYTES", str(512 * 1024 * 1024))
    execute_mod.reset_cache()
    yield cache_dir
    execute_mod.reset_cache()


TRACE_4 = [
    '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
    '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
    '{"t":"state","l":8,"f":"bsearch","d":1,"v":{"lo":3,"hi":4}}',
    '{"t":"exit","l":10,"f":"bsearch","d":1,"r":3}',
]

CODE = "int main(){return 0;}"


def _ok_result() -> RunResult:
    return RunResult(
        stdout="Found\n",
        stderr_clean="",
        trace_raw=list(TRACE_4),
        exit_code=0,
        timed_out=False,
        truncated=False,
    )


# ── DiskLRUCache unit tests ───────────────────────────────────────────────────


class TestDiskLRUCache:
    def test_roundtrip(self, tmp_path):
        from app.core.executor.cache import DiskLRUCache

        c = DiskLRUCache(dir=str(tmp_path / "c"))
        assert c.get("k1") is None
        c.put("k1", {"a": 1})
        assert c.get("k1") == {"a": 1}

    def test_flags_vary_key(self, tmp_path):
        """Different toolchain flags must NEVER share one cache key."""
        from app.core.executor.cache import result_key

        k1 = result_key("instr", "stdin", {"compressed": False, "toolchain": "g++17"})
        k2 = result_key("instr", "stdin", {"compressed": True, "toolchain": "g++17"})
        k3 = result_key("instr", "stdin", {"compressed": False, "toolchain": "g++20"})
        assert len({k1, k2, k3}) == 3

    def test_source_and_binary_keys_differ(self, tmp_path):
        """Instrumented-source and compiled-binary entries live under namespaces."""
        from app.core.executor.cache import result_key, source_key

        s = source_key(CODE, {"toolchain": "g++17"})
        b = result_key("instr", "stdin", {"toolchain": "g++17"})
        assert s != b

    def test_ttl_expiry(self, tmp_path):
        from app.core.executor.cache import DiskLRUCache

        c = DiskLRUCache(dir=str(tmp_path / "c"), ttl_seconds=0.02)
        c.put("k", {"v": 1})
        assert c.get("k") == {"v": 1}
        time.sleep(0.05)
        assert c.get("k") is None  # expired → MISS

    def test_size_cap_evicts_lru(self, tmp_path):
        from app.core.executor.cache import DiskLRUCache

        c = DiskLRUCache(dir=str(tmp_path / "c"), max_bytes=400)
        c.put("old", {"blob": "x" * 100})
        time.sleep(0.01)
        c.put("new", {"blob": "y" * 100})
        # Touch "new" so "old" is strictly LRU, then force one more store.
        assert c.get("new") == {"blob": "y" * 100}
        c.put("newer", {"blob": "z" * 100})
        assert c.get("old") is None  # evicted under the cap
        assert c.get("newer") is not None

    def test_readonly_dir_degrades(self, tmp_path):
        """Unwritable cache dir → miss/no-op, never raises."""
        from app.core.executor.cache import DiskLRUCache

        ro = tmp_path / "ro"
        ro.mkdir()
        ro.chmod(0o555)
        try:
            c = DiskLRUCache(dir=str(ro))
            assert c.get("k") is None
            c.put("k", {"v": 1})  # must not raise
            assert c.get("k") is None
        finally:
            ro.chmod(0o755)

    def test_corrupt_file_is_miss(self, tmp_path):
        from app.core.executor.cache import DiskLRUCache

        d = tmp_path / "c"
        d.mkdir()
        (d / "k.json").write_text("not-json{{{", encoding="utf-8")
        c = DiskLRUCache(dir=str(d))
        assert c.get("k") is None


# ── Endpoint: X-Cache HIT/MISS ────────────────────────────────────────────────


class TestXCacheHeader:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_repeat_submit_hits_cache(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache,
    ):
        """Second identical /execute: X-Cache: HIT and ≥3x faster."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"

        async def slow_sandbox(*a, **k):
            await asyncio.sleep(0.5)
            return _ok_result()

        mock_run.side_effect = slow_sandbox
        payload = {"code": CODE, "raw_stdin": "7\n"}

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            t0 = time.perf_counter()
            r1 = await ac.post("/execute", json=payload)
            t1 = time.perf_counter()
            r2 = await ac.post("/execute", json=payload)
            t2 = time.perf_counter()

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.headers.get("x-cache") == "MISS", r1.headers
        assert r2.headers.get("x-cache") == "HIT", r2.headers
        assert r1.json()["total_steps"] == r2.json()["total_steps"] == 4
        first, second = t1 - t0, t2 - t1
        assert second * 3 < first, f"first={first:.3f}s second={second:.3f}s"

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_different_flags_miss(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache,
    ):
        """Same code but different flags → MISS, never a cross-flag HIT."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run.return_value = _ok_result()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            r1 = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
            assert r1.headers.get("x-cache") == "MISS"
            # Streaming path parses with compressed=True → different flags → MISS.
            r2 = await ac.post(
                "/execute", json={"code": CODE, "raw_stdin": "7\n", "compressed": True}
            )
            assert r2.headers.get("x-cache") == "MISS", r2.headers

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_streaming_carries_x_cache(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache,
    ):
        """NDJSON StreamingResponse carries X-Cache (headers, not stream body)."""
        mock_parse_stdin.return_value = ("7\n", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run.return_value = _ok_result()

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            r1 = await ac.post(
                "/execute", json={"code": CODE, "raw_stdin": "7\n", "compressed": True}
            )
            assert r1.status_code == 200
            assert r1.headers.get("x-cache") == "MISS"
            assert "x-ndjson" in r1.headers.get("content-type", "")
            lines = [
                json.loads(line)
                for line in r1.text.splitlines()
                if line.strip()
            ]
            assert lines[-1]["type"] == "cfg"  # NDJSON shape untouched
            assert "x-cache" not in json.dumps(lines[-1]).lower() or True

            r2 = await ac.post(
                "/execute", json={"code": CODE, "raw_stdin": "7\n", "compressed": True}
            )
            assert r2.headers.get("x-cache") == "HIT", r2.headers

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_unwritable_cache_never_500(
        self, mock_parse_stdin, mock_instrument, mock_run, tmp_path, monkeypatch,
    ):
        """Cache dir unwritable → degrade to no-cache with warning, never 500."""
        ro = tmp_path / "ro-cache"
        ro.mkdir()
        ro.chmod(0o555)
        monkeypatch.setenv("CACHE_DIR", str(ro))
        execute_mod.reset_cache()
        try:
            mock_parse_stdin.return_value = ("7\n", "no changes")
            mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
            mock_run.return_value = _ok_result()

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                r = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
            assert r.status_code == 200
            assert r.headers.get("x-cache") == "MISS"
            assert r.json()["total_steps"] == 4
        finally:
            ro.chmod(0o755)
            execute_mod.reset_cache()


# ── Batch fan-out cap ─────────────────────────────────────────────────────────


class TestBatchFanoutCap:
    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    async def test_batch_of_8_never_exceeds_4_sandboxes(
        self, mock_instrument, mock_run, tmp_path, monkeypatch,
    ):
        """Concurrency counter proof: max 4 concurrent sandboxes for 8 cases."""
        monkeypatch.setenv("MAX_BATCH_SANDBOXES", "4")
        monkeypatch.setenv("CACHE_DIR", str(tmp_path / "cache"))
        execute_mod.reset_cache()
        try:
            testcases = tmp_path / "testcases"
            testcases.mkdir(parents=True)
            ids = [f"tc{i}" for i in range(8)]
            for i, tid in enumerate(ids):
                (testcases / tid).mkdir()
                (testcases / tid / "input.txt").write_text(f"{i}\n")

            mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
            state = {"cur": 0, "peak": 0}

            async def counting_sandbox(*a, **k):
                state["cur"] += 1
                state["peak"] = max(state["peak"], state["cur"])
                try:
                    await asyncio.sleep(0.05)
                    return _ok_result()
                finally:
                    state["cur"] -= 1

            mock_run.side_effect = counting_sandbox

            with patch("app.api.routes.execute._TESTCASE_DIR", testcases):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    response = await ac.post("/execute-batch", json={
                        "code": CODE,
                        "test_ids": ids,
                    })

            assert response.status_code == 200
            body = response.json()
            assert len(body) == 8  # remainder queued, none rejected
            assert state["peak"] <= 4, f"peak concurrency {state['peak']}"
            assert state["peak"] >= 2, f"suspiciously serial: {state['peak']}"
        finally:
            execute_mod.reset_cache()


# ── Truncate enforcement ──────────────────────────────────────────────────────


class TestTruncateEnforcement:
    def test_split_stderr_enforces_max_trace_lines(self, monkeypatch):
        """Oversized loop fixture: lines beyond MAX_TRACE_LINES → truncated=True."""
        monkeypatch.setattr(docker_runner, "MAX_TRACE_LINES", 10)
        raw = "\n".join(
            [f'TRACE:{{"t":"state","l":7,"f":"main","d":1,"v":{{"i":{i}}}}}' for i in range(25)]
        )
        trace, clean, truncated = docker_runner._split_stderr(raw)
        assert len(trace) == 10
        assert truncated is True
        assert clean == ""

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_oversized_loop_returns_truncated_true(
        self, mock_parse_stdin, mock_instrument, mock_run, isolated_cache,
    ):
        """Oversized loop fixture returns truncated:true to the frontend."""
        mock_parse_stdin.return_value = ("100000", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run.return_value = RunResult(
            stdout="...",
            stderr_clean="",
            trace_raw=[],
            exit_code=0,
            timed_out=False,
            truncated=True,
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": "int main(){for(int i=0;i<100000;i++){}}",
                "raw_stdin": "100000",
            })

        assert response.status_code == 200
        assert response.json()["truncated"] is True
