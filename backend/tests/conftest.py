"""
conftest.py — Task 22: isolate the warm-instance disk cache per test.

The executor cache lives on disk (default /tmp/algo-theseus-cache) and persists
across tests in one pytest process. Mocked sandboxes return different
results per test, so without isolation a test can read another test's
cached entry for the same (instrumented, stdin, flags) key. Every test
therefore gets a fresh CACHE_DIR; production behaviour is untouched.
"""

from __future__ import annotations

import pytest

import app.api.routes.execute as execute_mod


@pytest.fixture(autouse=True)
def _isolated_exec_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "algo-theseus-cache"))
    monkeypatch.delenv("CACHE_MAX_BYTES", raising=False)
    monkeypatch.delenv("CACHE_TTL_SECONDS", raising=False)
    execute_mod.reset_cache()
    yield
    execute_mod.reset_cache()
