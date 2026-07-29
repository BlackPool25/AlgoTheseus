"""
api/routes/upload.py — POST /upload-testcases endpoint.

Accepts multipart file uploads for test case input/output files.
Stores files under /tmp/dsa-visualizer/testcases/<uuid>/ and returns
a preview of each uploaded file.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Constants ──────────────────────────────────────────────────────────────────

BASE_DIR = Path("/tmp/dsa-visualizer/testcases")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILES = 50
ALLOWED_EXTENSIONS = {".txt", ".in", ".out", ".ans"}

PREVIEW_MAX_CHARS = 200


# ── Helpers ────────────────────────────────────────────────────────────────────


def _ensure_base_dir() -> None:
    """Create the shared testcases directory if it doesn't exist."""
    BASE_DIR.mkdir(parents=True, exist_ok=True)


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
async def upload_testcases(files: list[UploadFile] = File(..., description="Test case files (.txt, .in, .out, .ans)")) -> dict:
    """Upload test case files (input + expected output).

    Accepts up to **50 files** (10 MB each) with extensions
    ``.txt``, ``.in``, ``.out``, or ``.ans``. Files are stored under
    ``/tmp/dsa-visualizer/testcases/<uuid>/`` and a preview of each
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

        # Read content (size check happens implicitly; we enforce after read)
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            # Clean up partial upload
            import shutil
            shutil.rmtree(dest_dir, ignore_errors=True)
            raise HTTPException(
                status_code=400,
                detail=f"File '{fname}' exceeds {MAX_FILE_SIZE // (1024 * 1024)} MB limit "
                f"({len(content)} bytes)",
            )

        # Write to disk
        file_path = dest_dir / fname
        file_path.write_bytes(content)

        uploaded.append({
            "name": fname,
            "size": len(content),
            "preview": _make_preview(content),
        })

    logger.info("Uploaded test_id=%s with %d file(s)", test_id, len(uploaded))

    return {
        "test_id": test_id,
        "files": uploaded,
    }
