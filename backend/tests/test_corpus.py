"""
test_corpus.py — Wave-7 corpus end-to-end (todo 28).

Drives 10 DSA programs (+ 1 macro-limitation probe) through the FULL
pipeline per program: instrument (no-path production shape) → local g++
compile → run (timeout-guarded) → parse.

Assertion discipline (per plan): program-specific key variables appear at
EXPECTED LINES (presence + line-anchoring ONLY). NO exact-full-trace
assertions — those are brittle by design.

Line anchors are DERIVED from fixture source text (token search), never
hardcoded, so fixture reformatting cannot silently desync the test.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import warnings
from pathlib import Path

from app.core.instrumenter.injector import instrument
from app.core.trace.parser import parse

FIXTURES = Path(__file__).parent / "fixtures" / "corpus"
TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"


def _pipeline(name: str, timeout: int = 10):
    """Instrument → compile → run → parse. Returns (events, src_lines, proc)."""
    src = (FIXTURES / name).read_text()
    instrumented = instrument(src)  # no-path: the production call shape
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "prog.cpp").write_text(instrumented)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            [
                "g++",
                "-O0",
                "-std=c++17",
                "-I",
                str(tmp_path),
                "-o",
                str(binary),
                str(tmp_path / "prog.cpp"),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert compile_result.returncode == 0, f"{name}: compile error:\n{compile_result.stderr}"
        # Timeout-guard: a broken fixture must fail, never hang the suite.
        proc = subprocess.run(
            [str(binary)],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    assert proc.returncode == 0, f"{name}: nonzero exit:\n{proc.stderr}"
    raw = [ln[len("TRACE:") :] for ln in proc.stderr.splitlines() if ln.startswith("TRACE:")]
    assert raw, f"{name}: no TRACE: lines produced"
    return parse(raw), src.splitlines(), proc


def _state_lines_with(events, var: str) -> set[int]:
    """Source lines of STATE events whose top-level vars contain *var*."""
    return {
        e.line
        for e in events
        if str(getattr(e.type, "value", e.type)) == "state" and var in (e.vars or {})
    }


def _state_lines_nested(events, key: str) -> set[int]:
    """Source lines of STATE events whose vars contain *key* anywhere nested
    (struct fields, $id identity markers)."""
    hits = set()
    for e in events:
        if str(getattr(e.type, "value", e.type)) != "state":
            continue
        if key in json.dumps(e.vars or {}, default=str):
            hits.add(e.line)
    return hits


def _lines_with(src_lines: list[str], token: str) -> set[int]:
    return {n for n, l in enumerate(src_lines, 1) if token in l}


def _decl_line(src_lines: list[str], token: str) -> int:
    return next(n for n, l in enumerate(src_lines, 1) if token in l)


def _check_key_var(events, src_lines, var: str, anchor_token: str) -> None:
    """Presence + line-anchoring for one key variable.

    - hits nonempty (presence);
    - at least one hit lands on a source line mentioning the var (anchoring);
    - the headline anchor line (decl/loop line carrying anchor_token) is hit.
    """
    hits = _state_lines_with(events, var)
    assert hits, f"{var!r} never appears in any STATE event"
    token_lines = _lines_with(src_lines, var)
    assert hits & token_lines, (
        f"{var!r} traced only at lines {sorted(hits)}, none of which "
        f"mention it ({sorted(token_lines)})"
    )
    anchor = _decl_line(src_lines, anchor_token)
    assert anchor in hits, f"{var!r} missing at headline line {anchor}: {src_lines[anchor - 1]!r}"


def test_corpus_linear_scan():
    events, src, _ = _pipeline("linear_scan.cpp")
    _check_key_var(events, src, "i", "for (size_t i = 0")
    _check_key_var(events, src, "found", "found = (int)i")


def test_corpus_binary_search():
    events, src, _ = _pipeline("binary_search.cpp")
    # The plan's headline example: `mid` inside the bsearch loop.
    _check_key_var(events, src, "mid", "int mid = lo")


def test_corpus_dfs():
    events, src, _ = _pipeline("dfs.cpp")
    _check_key_var(events, src, "visited", "visited[u] = 1")
    enters = [
        e for e in events if str(getattr(e.type, "value", e.type)) == "enter" and e.func == "dfs"
    ]
    assert len(enters) >= 4, f"expected recursive dfs frames, got {len(enters)}"


def test_corpus_bfs():
    events, src, _ = _pipeline("bfs.cpp")
    _check_key_var(events, src, "visited", "visited[start] = 1")
    _check_key_var(events, src, "queue", "std::vector<int> queue")


def test_corpus_dijkstra():
    events, src, _ = _pipeline("dijkstra.cpp")
    # The plan's headline example: `dist` in Dijkstra.
    _check_key_var(events, src, "dist", "dist[src] = 0")


def test_corpus_knapsack():
    events, src, _ = _pipeline("knapsack.cpp")
    _check_key_var(events, src, "dp", "dp[i][w] = take")


def test_corpus_singly_linked_list():
    events, src, _ = _pipeline("singly_linked_list.cpp")
    # Pointer identity: $id markers nested in STATE vars, anchored at the
    # traversal loop (not merely at construction).
    hits = _state_lines_nested(events, "$id")
    assert hits, "no $id identity marker in any STATE event"
    loop = _decl_line(src, "while (cur != nullptr)")
    assert loop in hits, f"$id missing at traversal loop line {loop}"
    n_heap = sum(1 for e in events if getattr(e, "heap", None))
    assert n_heap >= 1, "expected heap-table events for heap-allocated nodes"


def test_corpus_trie():
    events, src, _ = _pipeline("trie.cpp")
    # Terminal flag: `is_end` nested inside node values, anchored at insert.
    hits = _state_lines_nested(events, "is_end")
    assert hits, "is_end never appears in any STATE event"
    anchor = _decl_line(src, "cur->is_end = 1")
    assert anchor in hits, f"is_end missing at insert line {anchor}"


def test_corpus_heap_sort():
    events, src, _ = _pipeline("heap_sort.cpp")
    _check_key_var(events, src, "heap", "heap[i] = heap[largest]")


def test_corpus_fibonacci():
    events, src, _ = _pipeline("fibonacci.cpp")
    # Recursion frames: fib(n) ENTER events nest to depth ≥ 3 for fib(6).
    depths = [
        e.depth
        for e in events
        if str(getattr(e.type, "value", e.type)) == "enter" and e.func == "fib"
    ]
    assert depths, "no fib ENTER events"
    assert max(depths) >= 3, f"fib recursion too shallow: {sorted(set(depths))}"
    _check_key_var(events, src, "n", "int a = fib(n - 1)")


def test_corpus_macro_define_skipped_with_warning():
    """Known limitation: macro bodies are never injected.

    The pipeline must stay GREEN (never red): the program compiles, runs,
    and parses. Macro-definition lines carry no trace events — that coverage
    is SKIPPED with an explicit warning, per the plan's QA scenario.
    """
    events, src, proc = _pipeline("macro_define.cpp")
    assert "14" in proc.stdout, f"wrong program output: {proc.stdout!r}"
    define_lines = _lines_with(src, "#define")
    assert define_lines, "fixture lost its #define lines"
    traced = {e.line for e in events}
    assert not (traced & define_lines), (
        f"macro-definition lines unexpectedly traced: {sorted(traced & define_lines)}"
    )
    # Ordinary vars around the macro uses still trace — graceful, not broken.
    assert _state_lines_with(events, "total"), "total never traced"
    warnings.warn(
        "macro bodies (SQUARE/LIMIT) carry no trace events — known "
        "instrumenter limitation; macro coverage SKIPPED, pipeline green",
        UserWarning,
        stacklevel=2,
    )
