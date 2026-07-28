"""
test_api_endpoints.py — Tests for the FastAPI endpoints.

Tests cover:
  - POST /upload-testcases with multipart file upload
  - POST /execute-batch with mocked sandbox
  - POST /execute response shape (non-streaming)

All Docker calls are mocked so tests run without Docker.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.executor.docker_runner import RunResult
from app.main import app


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def anyio_backend():
    return "asyncio"


SAMPLE_CODE = """
#include <vector>
#include <iostream>

int main() {
    std::vector<int> arr = {1, 3, 5, 7, 9};
    int target = 7;
    std::cout << "Found" << std::endl;
    return 0;
}
"""


# ── /execute endpoint ─────────────────────────────────────────────────────────


class TestExecuteEndpoint:
    """POST /execute — full execution pipeline."""

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_returns_expected_shape(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """Happy path: instrument → run → parse trace → build CFG."""
        mock_parse_stdin.return_value = ("5\n1 3 5 7 9\n", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            stdout="Found at index: 3\n",
            stderr_clean="",
            trace_raw=[
                '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
                '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
                '{"t":"state","l":8,"f":"bsearch","d":1,"v":{"lo":3,"hi":4}}',
                '{"t":"exit","l":10,"f":"bsearch","d":1,"r":3}',
            ],
            exit_code=0,
            timed_out=False,
            truncated=False,
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": SAMPLE_CODE,
                "raw_stdin": "5\n1 3 5 7 9\n",
            })

        assert response.status_code == 200
        body = response.json()

        # Response shape (ExecuteResponse fields)
        assert "stdout" in body
        assert body["stdout"] == "Found at index: 3\n"
        assert body["compile_error"] is None
        assert body["runtime_error"] is None
        assert body["timed_out"] is False
        assert body["truncated"] is False
        assert isinstance(body["trace"], list)
        assert len(body["trace"]) > 0
        assert isinstance(body["cfg_nodes"], list)
        assert isinstance(body["cfg_edges"], list)
        assert isinstance(body["total_steps"], int)
        assert body["total_steps"] == 4

        # Verify trace event shape
        first_event = body["trace"][0]
        assert "type" in first_event
        assert "line" in first_event
        assert "func" in first_event
        assert "depth" in first_event

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_compile_error(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """Compile error should populate compile_error field."""
        mock_parse_stdin.return_value = ("5", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            compile_error="prog.cpp:1:10: fatal error: vector: No such file or directory",
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": SAMPLE_CODE,
                "raw_stdin": "5",
            })

        assert response.status_code == 200
        body = response.json()
        assert body["compile_error"] is not None
        assert "vector" in body["compile_error"] or "fatal" in body["compile_error"]
        assert body["stdout"] == ""

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_timeout(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """Timed-out execution sets runtime_error and timed_out=True."""
        mock_parse_stdin.return_value = ("42", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            stdout="",
            stderr_clean="",
            trace_raw=[],
            exit_code=-1,
            timed_out=True,
            truncated=False,
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": SAMPLE_CODE,
                "raw_stdin": "42",
            })

        assert response.status_code == 200
        body = response.json()
        assert body["timed_out"] is True
        assert body["runtime_error"] is not None
        assert "timed out" in body["runtime_error"].lower()

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_truncated(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """truncated flag propagates from RunResult to response."""
        mock_parse_stdin.return_value = ("100", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            stdout="...",
            stderr_clean="",
            trace_raw=[],  # truncated edge — empty trace
            exit_code=0,
            timed_out=False,
            truncated=True,
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": SAMPLE_CODE,
                "raw_stdin": "100",
            })

        assert response.status_code == 200
        body = response.json()
        assert body["truncated"] is True

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_instrumentation_error(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """Instrumentation failure → 422."""
        mock_parse_stdin.return_value = ("42", "no changes")
        mock_instrument.side_effect = RuntimeError("libclang crashed")

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": "garbage code that breaks libclang",
                "raw_stdin": "42",
            })

        assert response.status_code == 422
        assert "Instrumentation error" in response.text

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    @patch("app.api.routes.execute.parse_stdin")
    async def test_execute_sandbox_error(
        self, mock_parse_stdin, mock_instrument, mock_run_in_sandbox,
    ):
        """Docker sandbox failure → 500."""
        mock_parse_stdin.return_value = ("42", "no changes")
        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.side_effect = RuntimeError("Docker not available")

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/execute", json={
                "code": SAMPLE_CODE,
                "raw_stdin": "42",
            })

        assert response.status_code == 500
        assert "Sandbox error" in response.text


# ── /upload-testcases endpoint ────────────────────────────────────────────────


class TestUploadTestcasesEndpoint:
    """POST /upload-testcases — multipart file upload."""

    @pytest.fixture
    def temp_upload_dir(self, tmp_path):
        """Point the upload module to a temp directory."""
        testcases_dir = tmp_path / "testcases"
        testcases_dir.mkdir(parents=True)
        with patch("app.api.routes.upload.BASE_DIR", testcases_dir):
            yield testcases_dir

    async def test_upload_valid_files(self, temp_upload_dir):
        """Uploading .txt and .in files returns test_id with file previews."""
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post(
                "/upload-testcases",
                files=[
                    ("files", ("input.txt", b"1 2 3 4 5\n", "text/plain")),
                    ("files", ("expected.out", b"42\n", "text/plain")),
                ],
            )

        assert response.status_code == 200
        body = response.json()
        assert "test_id" in body
        assert len(body["test_id"]) > 0  # UUID
        assert "files" in body
        assert len(body["files"]) == 2

        # Check file metadata
        fnames = {f["name"] for f in body["files"]}
        assert "input.txt" in fnames
        assert "expected.out" in fnames

        # Check previews
        for f in body["files"]:
            assert "size" in f
            assert "preview" in f

    async def test_upload_no_files(self, temp_upload_dir):
        """No files → 422 (FastAPI validation: File(...) is required)."""
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/upload-testcases")

        assert response.status_code == 422

    async def test_upload_invalid_extension(self, temp_upload_dir):
        """File with .exe extension → 400."""
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post(
                "/upload-testcases",
                files=[
                    ("files", ("program.exe", b"\x7fELF...", "application/octet-stream")),
                ],
            )

        assert response.status_code == 400
        assert "unsupported extension" in response.text.lower()

    async def test_upload_too_many_files(self, temp_upload_dir):
        """More than 50 files → 400."""
        files = [
            ("files", (f"file{i}.txt", b"data", "text/plain"))
            for i in range(51)
        ]
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post("/upload-testcases", files=files)

        assert response.status_code == 400
        assert "Too many files" in response.text

    async def test_upload_oversized_file(self, temp_upload_dir):
        """File larger than 10 MB → 400."""
        large_content = b"x" * (10 * 1024 * 1024 + 1)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post(
                "/upload-testcases",
                files=[
                    ("files", ("huge.txt", large_content, "text/plain")),
                ],
            )

        assert response.status_code == 400
        assert "exceeds" in response.text.lower() or "MB" in response.text

    async def test_upload_binary_file_preview(self, temp_upload_dir):
        """Binary content with allowed extension gets placeholder preview."""
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.post(
                "/upload-testcases",
                files=[
                    ("files", ("data.txt", b"\xff\xfe\x00\x01", "application/octet-stream")),
                ],
            )

        assert response.status_code == 200
        body = response.json()
        preview = body["files"][0]["preview"]
        assert "[binary file]" in preview


# ── /execute-batch endpoint ───────────────────────────────────────────────────


class TestExecuteBatchEndpoint:
    """POST /execute-batch — batch execution."""

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    async def test_execute_batch_returns_list(
        self, mock_instrument, mock_run_in_sandbox,
        tmp_path,
    ):
        """Multiple test cases return a list of results."""
        # Prepare test case input files
        testcases = tmp_path / "testcases"
        testcases.mkdir(parents=True)
        (testcases / "tc1").mkdir()
        (testcases / "tc1" / "input.txt").write_text("5\n1 3 5 7 9\n")
        (testcases / "tc2").mkdir()
        (testcases / "tc2" / "input.txt").write_text("3\n2 4 6\n")

        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            stdout="Found at index: 3\n",
            stderr_clean="",
            trace_raw=[
                '{"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}}',
                '{"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}}',
                '{"t":"exit","l":10,"f":"bsearch","d":1,"r":3}',
            ],
            exit_code=0,
            timed_out=False,
            truncated=False,
        )

        # Patch the testcase directory path
        with patch("app.api.routes.execute._TESTCASE_DIR", testcases):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                response = await ac.post("/execute-batch", json={
                    "code": SAMPLE_CODE,
                    "test_ids": ["tc1", "tc2"],
                })

        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) == 2

        # Each item should have the expected batch response shape
        for item in body:
            assert "test_id" in item
            assert "stdout" in item
            assert "compile_error" in item
            assert "runtime_error" in item
            assert "timed_out" in item
            assert "truncated" in item
            assert "trace" in item
            assert "cfg_nodes" in item
            assert "cfg_edges" in item
            assert "total_steps" in item

        # Verify test_ids match
        test_ids = {item["test_id"] for item in body}
        assert test_ids == {"tc1", "tc2"}

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    async def test_execute_batch_test_case_not_found(
        self, mock_instrument, mock_run_in_sandbox,
        tmp_path,
    ):
        """Missing test case → 404."""
        testcases = tmp_path / "testcases"
        testcases.mkdir(parents=True)

        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"

        with patch("app.api.routes.execute._TESTCASE_DIR", testcases):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                response = await ac.post("/execute-batch", json={
                    "code": SAMPLE_CODE,
                    "test_ids": ["nonexistent-test"],
                })

        assert response.status_code == 404
        assert "not found" in response.text.lower()

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    async def test_execute_batch_timeout_handling(
        self, mock_instrument, mock_run_in_sandbox,
        tmp_path,
    ):
        """A test case that times out should have timed_out=True."""
        testcases = tmp_path / "testcases"
        testcases.mkdir(parents=True)
        (testcases / "tc1").mkdir()
        (testcases / "tc1" / "input.txt").write_text("5\n")

        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            stdout="",
            stderr_clean="",
            trace_raw=[],
            exit_code=-1,
            timed_out=True,
            truncated=False,
        )

        with patch("app.api.routes.execute._TESTCASE_DIR", testcases):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                response = await ac.post("/execute-batch", json={
                    "code": SAMPLE_CODE,
                    "test_ids": ["tc1"],
                })

        assert response.status_code == 200
        body = response.json()
        assert body[0]["timed_out"] is True
        assert "timed out" in body[0]["runtime_error"].lower()

    @patch("app.api.routes.execute.run_in_sandbox")
    @patch("app.api.routes.execute.instrument")
    async def test_execute_batch_compile_error(
        self, mock_instrument, mock_run_in_sandbox,
        tmp_path,
    ):
        """Compile error per test case reported correctly."""
        testcases = tmp_path / "testcases"
        testcases.mkdir(parents=True)
        (testcases / "tc1").mkdir()
        (testcases / "tc1" / "input.txt").write_text("5\n")

        mock_instrument.return_value = "#include \"tracer.h\"\nint main() {}"
        mock_run_in_sandbox.return_value = RunResult(
            compile_error="prog.cpp:1:1: error: unknown type name",
        )

        with patch("app.api.routes.execute._TESTCASE_DIR", testcases):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as ac:
                response = await ac.post("/execute-batch", json={
                    "code": SAMPLE_CODE,
                    "test_ids": ["tc1"],
                })

        assert response.status_code == 200
        body = response.json()
        assert body[0]["compile_error"] is not None
        assert "error" in body[0]["compile_error"].lower()


# ── Health check ──────────────────────────────────────────────────────────────


class TestHealthEndpoint:
    async def test_health_returns_ok(self):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            response = await ac.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
