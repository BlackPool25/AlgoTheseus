"""
test_cache_version_red.py — Todo 18 (OPS-01): version the instrument-source cache key.

RED on HEAD: same source+flags collides across injector versions (no version
component in the key) — a post-deploy instrumenter change would keep serving
stale probes until TTL/eviction. GREEN after: the key carries an
injector-version input (hash of injector.py + tracer.h bytes), so a version
bump invalidates while same-version entries still hit (no cold-start
regression). Compressed/uncompressed modes share one entry (projection).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import app.api.routes.execute as execute_mod
import app.core.executor.cache as cache_mod
from app.core.executor.cache import DiskLRUCache, source_key

CODE = "int main(){return 0;}"
FLAGS = {"kind": "single", "compressed": False, "toolchain": "t", "max_trace_lines": 1}


def _versioned_key(code: str, flags: dict, version: str) -> str:
    """Drive source_key under a simulated injector version."""
    real = cache_mod.instrumenter_version
    cache_mod.instrumenter_version = lambda: version  # type: ignore[method-assign]
    try:
        return source_key(code, flags)
    finally:
        cache_mod.instrumenter_version = real  # type: ignore[method-assign]


def test_key_differs_across_injector_versions():
    """Same source+flags under two injector versions must NOT share a key."""
    assert _versioned_key(CODE, FLAGS, "v1") != _versioned_key(CODE, FLAGS, "v2")


def test_same_version_still_caches(tmp_path):
    """No cold-start regression: same version put → get is a HIT (hit-rate proof)."""
    cache = DiskLRUCache(dir=str(tmp_path / "c"))
    key = _versioned_key(CODE, FLAGS, "v1")
    assert cache.get(key) is None  # cold MISS, expected
    cache.put(key, {"instrumented": "int main(){return 0;}"})
    hits = sum(1 for _ in range(3) if cache.get(key) is not None)
    assert hits == 3, f"same-version entries must hit, got {hits}/3"


def test_version_bump_does_not_serve_stale_entry(tmp_path):
    """Old-version entry on disk is NOT served under the bumped key (MISS → re-run)."""
    cache = DiskLRUCache(dir=str(tmp_path / "c"))
    old_key = _versioned_key(CODE, FLAGS, "v1")
    cache.put(old_key, {"instrumented": "STALE-PROBES"})
    new_key = _versioned_key(CODE, FLAGS, "v2")
    assert new_key != old_key
    assert cache.get(new_key) is None  # stale entry invisible under new version
    assert old_key in {p.stem for p in (tmp_path / "c").glob("*.json")}  # ages out via TTL


def test_compressed_uncompressed_share_entry():
    """_flags_for carries no parse mode: both modes share one entry, and legacy
    flags dicts still carrying ``compressed`` converge via key normalization."""
    f_plain = execute_mod._flags_for("single")
    assert "compressed" not in f_plain
    assert source_key(CODE, {**f_plain, "compressed": False}) == source_key(
        CODE, {**f_plain, "compressed": True}
    )


def test_version_matches_injector_bytes():
    """The live version is the hash of the current injector.py + tracer.h bytes."""
    h = hashlib.sha256()
    base = Path(cache_mod.__file__).resolve().parent.parent / "instrumenter"
    for name in ("injector.py", "tracer.h"):
        h.update((base / name).read_bytes())
        h.update(b"\x00")
    assert cache_mod.instrumenter_version() == h.hexdigest()
