"""test_upload_streaming.py — Wave1 3.4: chunked upload streaming + TTL GC.

RED contract:
  1. Files stream via ``await file.read(65536)`` with a running size counter;
     an 11MB file is rejected mid-stream (400) without buffering it whole.
  2. Each upload purges ``BASE_DIR/<uuid>`` dirs with mtime older than
     TESTCASE_TTL_SECONDS (3600s).
"""

from __future__ import annotations

import os
import time
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

import app.api.routes.upload as upload_mod
from app.main import app


@pytest.fixture
def temp_upload_dir(tmp_path):
    testcases_dir = tmp_path / "testcases"
    testcases_dir.mkdir(parents=True)
    with patch.object(upload_mod, "BASE_DIR", testcases_dir):
        yield testcases_dir


class FakeChunkedFile:
    """UploadFile stand-in yielding 64KB chunks; records max single read."""

    def __init__(self, filename: str, total: int, chunk: int = 65536):
        self.filename = filename
        self._remaining = total
        self._chunk = chunk
        self.max_read_arg: int | None = None
        self.read_calls: list[int | None] = []

    async def read(self, size: int = -1):
        self.read_calls.append(size)
        if size is None or size < 0:
            # Full-buffer read — record spike, return everything at once
            self.max_read_arg = -1
            data, self._remaining = b"x" * self._remaining, 0
            return data
        self.max_read_arg = max(self.max_read_arg or 0, size)
        if self._remaining <= 0:
            return b""
        n = min(size, self._remaining)
        self._remaining -= n
        return b"x" * n


async def test_streams_in_64k_chunks_and_rejects_11mb_midstream(temp_upload_dir):
    """11MB file → 400, never buffered whole (no single read > 64KB)."""
    big = FakeChunkedFile("huge.txt", 11 * 1024 * 1024)
    assert getattr(upload_mod, "TESTCASE_TTL_SECONDS", 3600) == 3600
    # Call endpoint directly with the chunked fake (bypasses multipart)
    try:
        await upload_mod.upload_testcases(files=[big])  # type: ignore[arg-type]
    except Exception as e:  # noqa: BLE001 — expect HTTPException(400)
        status = getattr(e, "status_code", None)
        assert status == 400, f"expected 400, got {status}: {e}"
        assert (
            "exceeds" in str(getattr(e, "detail", e)).lower()
            or "10mb" in str(getattr(e, "detail", e)).lower()
        )
    else:
        pytest.fail("11MB upload should have been rejected with 400")
    # No single read may exceed one chunk (proves streaming, no RSS spike)
    sized = [c for c in big.read_calls if c is not None and c >= 0]
    assert sized, "file.read() was never called with a chunk size"
    assert max(sized) <= 65536, f"buffered read too large: {max(sized)}"
    assert -1 not in big.read_calls, "full file.read() without size buffers whole file"
    # Partial dest dir must be removed
    leftovers = [d for d in temp_upload_dir.iterdir() if d.is_dir()]
    assert leftovers == [], f"partial upload dir not cleaned: {leftovers}"


async def test_stale_dirs_purged_on_upload(temp_upload_dir):
    """Dirs with mtime older than TTL are removed on next upload."""
    stale = temp_upload_dir / "stale-uuid"
    stale.mkdir()
    (stale / "input.txt").write_bytes(b"old")
    ttl = getattr(upload_mod, "TESTCASE_TTL_SECONDS", 3600)
    assert ttl == 3600
    old_mtime = time.time() - (ttl + 10)
    os.utime(stale, (old_mtime, old_mtime))

    fresh = temp_upload_dir / "fresh-uuid"
    fresh.mkdir()
    (fresh / "input.txt").write_bytes(b"new")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/upload-testcases",
            files=[("files", ("input.txt", b"1 2 3\n", "text/plain"))],
        )
    assert resp.status_code == 200
    assert not stale.exists(), "stale dir older than TTL was not purged"
    assert fresh.exists(), "fresh dir must survive TTL purge"
