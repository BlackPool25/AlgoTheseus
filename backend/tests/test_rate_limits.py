"""
test_rate_limits.py — Tiered per-IP rate limits (todo 23, RED-first).

Limits: POST /execute 30/min/IP, POST /execute-batch 5/min/IP,
GET /health exempt. 429 carries Retry-After. Client key = first IP of
X-Forwarded-For gated by TRUSTED_PROXY_COUNT (default 1), else direct IP.

All sandbox calls are mocked so tests run without Docker.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.executor.docker_runner import RunResult
from app.main import app

VALID_BODY = {"code": "int main(){return 0;}", "raw_stdin": ""}

OK_RUN = RunResult(
    stdout="",
    stderr_clean="",
    trace_raw=[],
    exit_code=0,
    timed_out=False,
    truncated=False,
)


def _reset_limiter_storage() -> None:
    """Clear slowapi's in-memory counters (no-op before the limiter exists)."""
    limiter = getattr(app.state, "limiter", None)
    storage = getattr(limiter, "_storage", None)
    if storage is not None:
        storage.reset()


@pytest.fixture(autouse=True)
def _fresh_limits():
    _reset_limiter_storage()
    yield
    _reset_limiter_storage()


def _mocked_sandbox(testcase):
    """Wrap a test with mocked instrument/parse_stdin/run_in_sandbox."""
    return (
        patch("app.api.routes.execute.run_in_sandbox", return_value=OK_RUN),
        patch("app.api.routes.execute.instrument", return_value="int main(){}"),
        patch("app.api.routes.execute.parse_stdin", return_value=("", "no changes")),
    )


class TestExecuteRateLimit:
    async def test_429s_after_30_per_minute_with_retry_after(self):
        patches = _mocked_sandbox(None)
        with patches[0], patches[1], patches[2]:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                statuses = []
                retry_afters = []
                for _ in range(35):
                    r = await ac.post(
                        "/execute",
                        json=VALID_BODY,
                        headers={"X-Forwarded-For": "10.23.1.1"},
                    )
                    statuses.append(r.status_code)
                    if r.status_code == 429:
                        retry_afters.append(r.headers.get("Retry-After"))

        assert statuses[:30] == [200] * 30
        assert statuses[30:] == [429] * 5
        assert all(v is not None for v in retry_afters)

    async def test_health_never_rate_limited(self):
        patches = _mocked_sandbox(None)
        with patches[0], patches[1], patches[2]:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                for _ in range(35):  # exhaust the /execute bucket for this IP
                    await ac.post(
                        "/execute",
                        json=VALID_BODY,
                        headers={"X-Forwarded-For": "10.23.2.2"},
                    )
                health = [
                    (await ac.get("/health", headers={"X-Forwarded-For": "10.23.2.2"}))
                    for _ in range(5)
                ]
        assert [r.status_code for r in health] == [200] * 5

    async def test_empty_body_422_does_not_consume_quota(self):
        """422s (validation) don't burn quota: 5 invalid + 30 valid all pass,
        the 31st valid is the first 429 (limit checked AFTER validation)."""
        patches = _mocked_sandbox(None)
        with patches[0], patches[1], patches[2]:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                for _ in range(5):
                    r = await ac.post(
                        "/execute",
                        json={},
                        headers={"X-Forwarded-For": "10.23.3.3"},
                    )
                    assert r.status_code == 422
                oks = [
                    (
                        await ac.post(
                            "/execute",
                            json=VALID_BODY,
                            headers={"X-Forwarded-For": "10.23.3.3"},
                        )
                    ).status_code
                    for _ in range(31)
                ]
        assert oks[:30] == [200] * 30
        assert oks[30] == 429


class TestBatchRateLimit:
    async def test_batch_429s_after_5_per_minute(self, tmp_path):
        testcases = tmp_path / "testcases"
        (testcases / "tc1").mkdir(parents=True)
        (testcases / "tc1" / "input.txt").write_text("5\n")
        with (
            patch("app.api.routes.execute._TESTCASE_DIR", testcases),
            patch("app.api.routes.execute.run_in_sandbox", return_value=OK_RUN),
            patch("app.api.routes.execute.instrument", return_value="int main(){}"),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                statuses = []
                for _ in range(7):
                    r = await ac.post(
                        "/execute-batch",
                        json={"code": "int main(){return 0;}", "test_ids": ["tc1"]},
                        headers={"X-Forwarded-For": "10.23.4.4"},
                    )
                    statuses.append(r.status_code)
        assert statuses[:5] == [200] * 5
        assert statuses[5:] == [429] * 2


class TestProxyAwareKey:
    async def test_single_ip_xff_gets_own_bucket(self):
        """Requests with a single-IP XFF count against that IP, not the
        direct client IP (direct bucket stays unexhausted)."""
        patches = _mocked_sandbox(None)
        with patches[0], patches[1], patches[2]:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                for _ in range(30):
                    r = await ac.post(
                        "/execute",
                        json=VALID_BODY,
                        headers={"X-Forwarded-For": "10.23.5.5"},
                    )
                    assert r.status_code == 200
                r = await ac.post(
                    "/execute",
                    json=VALID_BODY,
                    headers={"X-Forwarded-For": "10.23.5.5"},
                )
                assert r.status_code == 429
                direct = await ac.post("/execute", json=VALID_BODY)
                assert direct.status_code == 200

    async def test_spoofed_multi_ip_xff_ignored(self, monkeypatch):
        """XFF with more IPs than TRUSTED_PROXY_COUNT is distrusted: the
        request counts against the direct client IP bucket."""
        monkeypatch.setenv("TRUSTED_PROXY_COUNT", "1")
        patches = _mocked_sandbox(None)
        with patches[0], patches[1], patches[2]:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                for _ in range(30):  # exhaust the DIRECT bucket (no XFF)
                    r = await ac.post("/execute", json=VALID_BODY)
                    assert r.status_code == 200
                spoofed = await ac.post(
                    "/execute",
                    json=VALID_BODY,
                    headers={"X-Forwarded-For": "1.2.3.4, 5.6.7.8, 9.10.11.12"},
                )
                assert spoofed.status_code == 429
