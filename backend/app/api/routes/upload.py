"""
api/routes/upload.py — POST /upload-testcases endpoint.

Accepts multipart file uploads for test case input/output files.
Stores files under /tmp/algo-theseus/testcases/<uuid>/ and returns
a preview of each uploaded file.
"""

from __future__ import annotations

import logging
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Constants ──────────────────────────────────────────────────────────────────

BASE_DIR = Path("/tmp/algo-theseus/testcases")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILES = 50
ALLOWED_EXTENSIONS = {".txt", ".in", ".out", ".ans"}
CHUNK_SIZE = 65536  # 64 KB streaming reads (bounds per-request RAM)
TESTCASE_TTL_SECONDS = 3600  # mtime GC horizon for testcase dirs
_PREVIEW_HEAD_BYTES = 4096  # preview probe (preview shows 200 chars; exact for files ≤ 4KB)

# Module-level File() default (B008: no calls in argument defaults).
# Same object FastAPI would build at decoration time — shared on purpose.
_FILES_PARAM = File(..., description="Test case files (.txt, .in, .out, .ans)")

PREVIEW_MAX_CHARS = 200


# ── Helpers ────────────────────────────────────────────────────────────────────


def _ensure_base_dir() -> None:
    """Create the shared testcases directory if it doesn't exist."""
    BASE_DIR.mkdir(parents=True, exist_ok=True)


def _purge_stale_dirs() -> None:
    """Remove testcase dirs with mtime older than TESTCASE_TTL_SECONDS.

    Best-effort: GC must never break an upload.
    """
    try:
        now = time.time()
        for child in BASE_DIR.iterdir():
            try:
                if child.is_dir() and (now - child.stat().st_mtime) > TESTCASE_TTL_SECONDS:
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                logger.debug("GC skip %s", child, exc_info=True)
    except OSError:
        logger.debug("GC scan failed", exc_info=True)


def _validate_extension(filename: str | None) -> str | None:
    """Check file extension is allowed. Returns the lowercased extension or None."""
    if not filename:
        return None
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return None
    return ext


def _make_preview(content: bytes) -> str:
    """Produce a text preview of the file content (first 200 chars)."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return "[binary file]"
    if len(text) > PREVIEW_MAX_CHARS:
        return text[:PREVIEW_MAX_CHARS] + "..."
    return text


# ── Routes ─────────────────────────────────────────────────────────────────────


@router.post("")
async def upload_testcases(files: list[UploadFile] = _FILES_PARAM) -> dict:
    """Upload test case files (input + expected output).

    Accepts up to **50 files** (10 MB each) with extensions
    ``.txt``, ``.in``, ``.out``, or ``.ans``. Files are stored under
    ``/tmp/algo-theseus/testcases/<uuid>/`` and a preview of each
    file is returned.

    Returns ``{test_id, files: [{name, size, preview}]}``.
    """
    # ── Validate file count ────────────────────────────────────────────────
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files: got {len(files)}, max {MAX_FILES} per upload",
        )

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # ── Ensure destination ─────────────────────────────────────────────────
    _ensure_base_dir()
    _purge_stale_dirs()
    test_id = str(uuid.uuid4())
    dest_dir = BASE_DIR / test_id
    dest_dir.mkdir(parents=True, exist_ok=False)

    uploaded: list[dict] = []

    for file in files:
        fname = file.filename or "unnamed"

        # Validate extension
        ext = _validate_extension(fname)
        if ext is None:
            raise HTTPException(
                status_code=400,
                detail=f"File '{fname}' has unsupported extension. "
                f"Allowed: {sorted(ALLOWED_EXTENSIONS)}",
            )

        # Stream to disk in 64KB chunks; reject mid-stream past the size cap
        file_path = dest_dir / fname
        size = 0
        head = bytearray()
        too_big = False
        with open(file_path, "wb") as out:  # noqa: ASYNC230 — chunked local write
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    too_big = True
                    break
                out.write(chunk)
                need = _PREVIEW_HEAD_BYTES - len(head)
                if need > 0:
                    head.extend(chunk[:need])
        if too_big:
            # Clean up partial upload
            shutil.rmtree(dest_dir, ignore_errors=True)
            raise HTTPException(
                status_code=400,
                detail=f"File '{fname}' exceeds {MAX_FILE_SIZE // (1024 * 1024)} MB limit "
                f"({size} bytes)",
            )

        content_head = bytes(head)
        uploaded.append(
            {
                "name": fname,
                "size": size,
                "preview": _make_preview(content_head),
            }
        )

    logger.info("Uploaded test_id=%s with %d file(s)", test_id, len(uploaded))

    return {
        "test_id": test_id,
        "files": uploaded,
    }
