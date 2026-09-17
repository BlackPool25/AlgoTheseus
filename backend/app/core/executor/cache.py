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
            logger.warning(
                "Cache dir %s not creatable — running without cache", self.dir
            )
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
            logger.warning(
                "Cache store failed — continuing without cache", exc_info=True
            )
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


# ── Wave2 1.3 two-tier shared cache (HIGH tier) ─────────────────────────────
# L1 = Redis ``theseus:cache:<sha>`` (SETEX 3600s, JSON, <=1MB guard,
# fail-open to L2). L2 = DiskLRUCache above (512MB/1h, unchanged).
# Keys, TOOLCHAIN_FLAGS, and the L2 envelope are byte-identical to the
# disk-only path — L1 only shares what L2 already stores.

L1_KEY_PREFIX = "theseus:cache:"
L1_TTL_SECONDS = 3600  # Redis SETEX TTL (1h, mirrors the queue result TTL)
L1_MAX_BYTES = 1_000_000  # payloads serializing larger skip L1 (L2-only)

# Process-wide pooled SYNC redis clients, one per URL — mirrors the async
# pooled factory in app/core/queue/backends.py (one shared client per URL
# bounds total connections instead of opening one per cache operation).
_POOLED_SYNC_MAX_CONNECTIONS = 50
_pooled_sync: dict[str, object] = {}


def _get_sync_client(url: str):  # type: ignore[no-untyped-def]
    """Return the shared pooled sync client for a URL, creating it on first use."""
    import redis  # local import: redis is optional, never crash without it

    client = _pooled_sync.get(url)
    if client is None:
        pool = redis.ConnectionPool.from_url(
            url,
            max_connections=_POOLED_SYNC_MAX_CONNECTIONS,
            socket_connect_timeout=2,
            socket_keepalive=True,
            health_check_interval=30,
            decode_responses=False,
        )
        client = redis.Redis(connection_pool=pool)
        _pooled_sync[url] = client
    return client


def _l1_key(key: str) -> str:
    return f"{L1_KEY_PREFIX}{key}"


class SharedCache:
    """Two-tier cache: L1 Redis (shared across instances) over L2 disk (local).

    get(): L1 HIT → payload; L1 MISS/corrupt/down → L2 (fail-open, never
    raises). put(): store L2 always; store L1 only when the serialized
    envelope is <= L1_MAX_BYTES (1MB guard). L1 failures never block L2.
    """

    def __init__(
        self,
        l2_dir: str | None = None,
        redis_client: object | None = None,
        redis_url: str | None = None,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._l2 = DiskLRUCache(dir=l2_dir, ttl_seconds=ttl_seconds)
        if redis_client is not None:
            self._l1 = redis_client
        elif redis_url is not None:
            try:
                self._l1 = _get_sync_client(redis_url)
            except Exception:
                logger.warning("SharedCache: no L1 (redis unavailable) — L2 only")
                self._l1 = None
        else:
            self._l1 = None

    @classmethod
    def from_env(
        cls, l2_dir: str | None = None, redis_client: object | None = None
    ) -> SharedCache:
        """Build from env: REDIS_URL for L1; CACHE_* for L2 (via DiskLRUCache)."""
        url = os.getenv("REDIS_URL", "").strip()
        ttl = float(os.getenv("CACHE_TTL_SECONDS", str(DEFAULT_TTL_SECONDS)))
        if redis_client is not None:
            return cls(l2_dir=l2_dir, redis_client=redis_client, ttl_seconds=ttl)
        if url:
            try:
                return cls(l2_dir=l2_dir, redis_url=url, ttl_seconds=ttl)
            except Exception:
                logger.warning("SharedCache: REDIS_URL set but unusable — L2 only")
        return cls(l2_dir=l2_dir, ttl_seconds=ttl)

    @property
    def disabled(self) -> bool:
        return self._l2.disabled

    def _l1_get(self, key: str) -> dict | None:
        if self._l1 is None:
            return None
        try:
            raw = self._l1.get(_l1_key(key))  # type: ignore[union-attr]
        except Exception:
            logger.warning("SharedCache L1 get failed — falling back to L2")
            return None
        if raw is None:
            return None
        try:
            entry = json.loads(raw)
            payload = entry["payload"]
            age = time.time() - float(entry["created"])
        except (ValueError, KeyError, TypeError):
            logger.warning("SharedCache L1 entry %s corrupt — dropping", key[:12])
            try:
                self._l1.delete(_l1_key(key))  # type: ignore[union-attr]
            except Exception:
                pass
            return None
        if age > self._l2.ttl_seconds:
            try:
                self._l1.delete(_l1_key(key))  # type: ignore[union-attr]
            except Exception:
                pass
            return None  # TTL-evicted → fall through to L2 (also expired → MISS)
        if not isinstance(payload, dict):
            return None
        return payload

    def get(self, key: str) -> dict | None:
        """L1 HIT or L2 HIT → payload; MISS/expired/corrupt/down → None."""
        hit = self._l1_get(key)
        if hit is not None:
            return hit
        return self._l2.get(key)

    def put(self, key: str, payload: dict) -> None:
        """Store L2 always; store L1 when small enough. Never raises."""
        self._l2.put(key, payload)
        if self._l1 is None:
            return
        try:
            raw = json.dumps({"created": time.time(), "payload": payload})
        except (ValueError, TypeError):
            return
        if len(raw.encode("utf-8")) > L1_MAX_BYTES:
            return  # 1MB guard: L2-only, skip L1
        try:
            self._l1.setex(_l1_key(key), max(1, int(self._l2.ttl_seconds)), raw)  # type: ignore[union-attr]
        except Exception:
            logger.warning("SharedCache L1 store failed — L2 copy kept", exc_info=True)
