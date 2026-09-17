"""
test_exec_cache_shared.py — Wave2 1.3 two-tier shared cache (HIGH tier).

RED-first suite. L1 = Redis ``theseus:cache:<sha>`` (SETEX 3600s, JSON,
<=1MB guard, fail-open to L2); L2 = existing DiskLRUCache (512MB/1h).

No live Redis needed: tests inject a small dict-backed FakeRedis as the
L1 client (same object shared across instances = cross-instance HIT).
Covers:
  - A-put -> B-HIT across disk dirs (L1 shares, L2 isolated).
  - TTL expiry -> MISS on both tiers.
  - Corrupt L1 entry -> MISS, never raises (endpoint never 500).
  - Redis-down -> fail-open to L2 (endpoint 200 MISS).
  - >1MB payload skips L1 (L2-only).
  - Key/flag stability: hashes and TOOLCHAIN_FLAGS byte-identical.
  - Endpoint: X-Cache HIT served from L1 with a cold L2 dir.
"""

from __future__ import annotations

import time
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient

import app.api.routes.execute as execute_mod
from app.core.executor.cache import TOOLCHAIN_FLAGS, result_key, source_key
from app.core.executor.docker_runner import RunResult
from app.main import app

CODE = "int main(){return 0;}"


class FakeRedis:
    """Minimal dict-backed stand-in for a sync redis client (shared = 1 tier)."""

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def get(self, key: str) -> bytes | None:
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str | bytes) -> None:
        self.store[key] = value.encode() if isinstance(value, str) else value

    def delete(self, key: str) -> None:
        self.store.pop(key, None)


class BoomRedis(FakeRedis):
    """L1 that is down: every op raises (fail-open must swallow)."""

    def get(self, key: str) -> bytes | None:
        raise ConnectionError("redis down")

    def setex(self, key: str, ttl: int, value: str | bytes) -> None:
        raise ConnectionError("redis down")


def _ok_result() -> RunResult:
    return RunResult(
        stdout="Found\n",
        stderr_clean="",
        trace_raw=[],
        exit_code=0,
        timed_out=False,
        truncated=False,
    )


def _shared(dir_a, dir_b=None, client=None, **kw):
    from app.core.executor.cache import SharedCache

    fake = client or FakeRedis()
    a = SharedCache(l2_dir=str(dir_a), redis_client=fake, **kw)
    b = SharedCache(l2_dir=str(dir_b or (str(dir_a) + "-b")), redis_client=fake, **kw)
    return a, b, fake


class TestCrossInstance:
    def test_a_put_b_hit(self, tmp_path):
        a, b, fake = _shared(tmp_path / "a", tmp_path / "b")
        assert b.get("k1") is None
        a.put("k1", {"v": 1})
        assert b.get("k1") == {"v": 1}  # L1 HIT despite isolated L2 dirs
        assert any(k.startswith("theseus:cache:") for k in fake.store)

    def test_ttl_expiry_miss(self, tmp_path):
        a, b, _ = _shared(tmp_path / "a", tmp_path / "b", ttl_seconds=0.02)
        a.put("k", {"v": 1})
        assert b.get("k") == {"v": 1}
        time.sleep(0.05)
        assert b.get("k") is None  # expired on both tiers -> MISS

    def test_corrupt_l1_is_miss(self, tmp_path):
        from app.core.executor.cache import L1_KEY_PREFIX, SharedCache

        fake = FakeRedis()
        fake.store[f"{L1_KEY_PREFIX}k"] = b"not-json{{{"
        c = SharedCache(l2_dir=str(tmp_path / "c"), redis_client=fake)
        assert c.get("k") is None  # corrupt -> MISS, never raises

    def test_redis_down_fail_open(self, tmp_path):
        from app.core.executor.cache import SharedCache

        c = SharedCache(l2_dir=str(tmp_path / "c"), redis_client=BoomRedis())
        assert c.get("k") is None
        c.put("k", {"v": 1})  # must not raise
        assert c.get("k") == {"v": 1}  # L1 down, L2 fallback still serves
        d = SharedCache(l2_dir=str(tmp_path / "d"), redis_client=c._l1)
        assert d.get("k") is None  # no L1, isolated L2 -> MISS

    def test_1mb_guard_l2_only(self, tmp_path):
        from app.core.executor.cache import L1_KEY_PREFIX, SharedCache

        fake = FakeRedis()
        a = SharedCache(l2_dir=str(tmp_path / "a"), redis_client=fake)
        big = {"blob": "x" * (2 * 1024 * 1024)}
        a.put("big", big)
        assert a.get("big") == big  # L2 HIT on same instance
        assert f"{L1_KEY_PREFIX}big" not in fake.store
        b = SharedCache(l2_dir=str(tmp_path / "b"), redis_client=fake)
        assert b.get("big") is None  # skipped L1 -> cross-instance MISS

    def test_keys_and_flags_stable(self):
        assert TOOLCHAIN_FLAGS == "g++ -O0 -g -std=c++17 -pipe"
        assert source_key(CODE, {"t": 1}) == source_key(CODE, {"t": 1})
        assert result_key("i", "s", {"t": 1}) == result_key("i", "s", {"t": 1})
        assert source_key(CODE, {"t": 1}) != result_key(CODE, "s", {"t": 1})


class TestEndpointShared:
    async def test_l1_hit_with_cold_l2(self, tmp_path, monkeypatch):
        """Instance B (fresh disk dir, same L1) serves X-Cache: HIT."""
        from app.core.executor.cache import SharedCache

        fake = FakeRedis()
        monkeypatch.setenv("CACHE_DIR", str(tmp_path / "a"))
        execute_mod.reset_cache()
        try:
            with (
                patch("app.api.routes.execute.run_in_sandbox") as mock_run,
                patch(
                    "app.api.routes.execute.instrument",
                    return_value='#include "tracer.h"\nint main() {}',
                ),
                patch(
                    "app.api.routes.execute.parse_stdin",
                    return_value=("7\n", "no changes"),
                ),
            ):
                mock_run.return_value = _ok_result()
                execute_mod._cache = SharedCache(l2_dir=str(tmp_path / "a"), redis_client=fake)
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    r1 = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
                    assert r1.headers.get("x-cache") == "MISS"
                    # Simulate a different instance: fresh disk dir, same L1.
                    execute_mod._cache = SharedCache(l2_dir=str(tmp_path / "b"), redis_client=fake)
                    r2 = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
                    assert r2.headers.get("x-cache") == "HIT", r2.headers
                    assert r1.json() == r2.json()  # byte-equal bodies
                    assert mock_run.await_count == 1
        finally:
            execute_mod.reset_cache()

    async def test_corrupt_and_down_never_500(self, tmp_path, monkeypatch):
        """Corrupt L1 / dead Redis -> MISS + 200, never 500."""
        from app.core.executor.cache import L1_KEY_PREFIX, SharedCache

        monkeypatch.setenv("CACHE_DIR", str(tmp_path / "c"))
        execute_mod.reset_cache()
        try:
            with (
                patch("app.api.routes.execute.run_in_sandbox") as mock_run,
                patch(
                    "app.api.routes.execute.instrument",
                    return_value='#include "tracer.h"\nint main() {}',
                ),
                patch(
                    "app.api.routes.execute.parse_stdin",
                    return_value=("7\n", "no changes"),
                ),
            ):
                mock_run.return_value = _ok_result()
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as ac:
                    fake = FakeRedis()
                    fake.store[f"{L1_KEY_PREFIX}anything"] = b"{{{bad"
                    execute_mod._cache = SharedCache(l2_dir=str(tmp_path / "c"), redis_client=fake)
                    r = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
                    assert r.status_code == 200  # corrupt entry -> MISS, not 500

                    execute_mod._cache = SharedCache(
                        l2_dir=str(tmp_path / "d"), redis_client=BoomRedis()
                    )
                    r = await ac.post("/execute", json={"code": CODE, "raw_stdin": "7\n"})
                    assert r.status_code == 200  # redis down -> MISS, not 500
                    assert r.headers.get("x-cache") == "MISS"
        finally:
            execute_mod.reset_cache()
