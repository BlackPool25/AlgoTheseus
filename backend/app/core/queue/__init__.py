"""app/core/queue/__init__.py — Async job-queue package.

Backends: Redis list-based queue when REDIS_URL is set and the
``redis`` package is importable; otherwise a process-local in-memory
fallback. Never crashes when redis is missing — degrades silently.
"""

from app.core.queue.backends import get_queue, reset_queue
from app.core.queue.jobs import (
    RESULT_TTL_SECONDS,
    JobRecord,
    JobStatusResponse,
    JobSubmitResponse,
)

__all__ = [
    "RESULT_TTL_SECONDS",
    "JobRecord",
    "JobStatusResponse",
    "JobSubmitResponse",
    "get_queue",
    "reset_queue",
]
