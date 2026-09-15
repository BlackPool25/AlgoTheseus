"""
cache.py — Warm-instance-only disk LRU cache for executed DSA programs.

What it caches (two namespaces, never one key):
  - Instrumented source: ``source_key(code, flags)`` → instrumented C++ text.
  - Execution result: ``result_key(instrumented, stdin, flags)`` → RunResult
    payload (stdout, trace lines, exit code, …) — the "compiled binary" entry:
    what the sandbox produced for that exact instrumented input.

Keys are SHA-256 over content + flags. Different toolchain flags (compiler
flags, ``compressed`` parse mode, MAX_TRACE_LINES, endpoint kind) ALWAYS hash
to different keys — entries are NEVER shared across flag sets.

Warm-instance-only SLO:
  The cache lives under ``/tmp/algo-theseus-cache`` (or ``$CACHE_DIR``). The compose
  file mounts no volume there and the Dockerfile copies no volume, so a
  host sleep / container restart wipes ``/tmp``. A cold-start MISS is therefore
  EXPECTED and logged at INFO — never a failure, never retried.

  Follow-up NOTE (not this module): on hosts offering free persistent disks,
  mount a volume at ``$CACHE_DIR`` and the same code works unchanged — the dir
  is fully env-driven. No DB involved (plain JSON files, stdlib only).

Degradation: an unwritable / corrupt cache dir degrades to no-cache with a
warning — get() returns None, put() is a no-op. It NEVER raises.

Only successful runs are cached (never compile errors) — callers decide that;
put() itself is a dumb store.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_DIR = "/tmp/algo-theseus-cache"
DEFAULT_MAX_BYTES = 512 * 1024 * 1024  # 512MB size cap
DEFAULT_TTL_SECONDS = 3600.0  # 1h TTL eviction

# Toolchain identity baked into every key — bump when the sandbox compiler
# flags change so stale binaries can never be served under a new toolchain.
TOOLCHAIN_FLAGS = "g++ -O0 -g -std=c++17"


def _flags_json(flags: dict) -> str:
    """Canonical flags encoding — key order independent, no whitespace drift."""
    return json.dumps(flags, sort_keys=True, separators=(",", ":"))


def source_key(code: str, flags: dict) -> str:
    """Key for the instrumented-source entry: SHA-256(source + flags)."""
    h = hashlib.sha256()
    h.update(b"src/v1\x00")
    h.update(code.encode("utf-8"))
    h.update(b"\x00")
    h.update(_flags_json(flags).encode("utf-8"))
    return h.hexdigest()


def result_key(instrumented: str, stdin_data: str, flags: dict) -> str:
    """Key for the compiled-binary (execution result) entry.

    SHA-256(instrumented + stdin + flags). A different stdin or a different
    flag set is a different program run — never the same key.
    """
    h = hashlib.sha256()
    h.update(b"bin/v1\x00")
    h.update(instrumented.encode("utf-8"))
    h.update(b"\x00")
    h.update(stdin_data.encode("utf-8"))
    h.update(b"\x00")
    h.update(_flags_json(flags).encode("utf-8"))
    return h.hexdigest()


class DiskLRUCache:
    """File-backed LRU cache: one ``<sha256>.json`` per entry.

    Eviction is twofold: TTL (stale entries read as MISS and are deleted) and
    a total-size cap (oldest mtime evicted first on every store).
    """

    def __init__(
        self,
        dir: str | None = None,
        max_bytes: float = DEFAULT_MAX_BYTES,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self.dir = Path(dir or os.getenv("CACHE_DIR", DEFAULT_DIR))
        self.max_bytes = max_bytes
        self.ttl_seconds = ttl_seconds
        self._disabled = False
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.warning("Cache dir %s not creatable — running without cache", self.dir)
            self._disabled = True
            return
        if not os.access(self.dir, os.W_OK):
            # Warm-instance-only note: a read-only /tmp (or a wiped one) is
            # expected on some hosts — degrade, never fail.
            logger.warning("Cache dir %s unwritable — running without cache", self.dir)
            self._disabled = True

    @classmethod
    def from_env(cls) -> DiskLRUCache:
        """Build from env: CACHE_DIR, CACHE_MAX_BYTES, CACHE_TTL_SECONDS."""
        return cls(
            dir=os.getenv("CACHE_DIR", DEFAULT_DIR),
            max_bytes=float(os.getenv("CACHE_MAX_BYTES", str(DEFAULT_MAX_BYTES))),
            ttl_seconds=float(os.getenv("CACHE_TTL_SECONDS", str(DEFAULT_TTL_SECONDS))),
        )

    @property
    def disabled(self) -> bool:
        return self._disabled

    def _path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def get(self, key: str) -> dict | None:
        """Return the stored payload, or None on MISS/expired/corrupt/disabled."""
        if self._disabled:
            return None
        path = self._path(key)
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            return None  # cold start (no file yet) — expected, not a failure
        try:
            entry = json.loads(raw)
            payload = entry["payload"]
            age = time.time() - float(entry["created"])
        except (ValueError, KeyError, TypeError):
            logger.warning("Cache entry %s corrupt — dropping", key[:12])
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            return None
        if age > self.ttl_seconds:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            return None  # TTL-evicted → MISS
        try:
            os.utime(path, None)  # LRU touch
        except OSError:
            pass
        return payload

    def put(self, key: str, payload: dict) -> None:
        """Store a JSON-serializable payload. Never raises."""
        if self._disabled:
            return
        entry = json.dumps({"created": time.time(), "payload": payload})
        tmp = self.dir / f".tmp-{key}.json"
        try:
            tmp.write_text(entry, encoding="utf-8")
            os.replace(tmp, self._path(key))
        except OSError:
            logger.warning("Cache store failed — continuing without cache", exc_info=True)
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return
        self._evict()

    def _evict(self) -> None:
        """Delete oldest-mtime entries until total size ≤ cap. Never raises."""
        try:
            files = [p for p in self.dir.glob("*.json") if p.is_file()]
            total = sum(p.stat().st_size for p in files)
            if total <= self.max_bytes:
                return
            files.sort(key=lambda p: p.stat().st_mtime)
            for p in files:
                try:
                    total -= p.stat().st_size
                    p.unlink()
                except OSError:
                    continue
                if total <= self.max_bytes:
                    break
        except OSError:
            logger.warning("Cache eviction scan failed", exc_info=True)
