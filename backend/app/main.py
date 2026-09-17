"""
main.py — FastAPI application entry point.

Registers routes, CORS, and global exception handling.
Run with: uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routes.execute import batch_router
from app.api.routes.execute import router as execute_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.upload import router as upload_router
from app.core.rate_limit import limiter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# The default asyncio executor is min(32, cpu+4) threads — 6 on a 2-vCPU
# Cloud Run instance. Every sandbox/cache/instrument hop rides it, so MISS
# storms queue behind 6 threads (the 429 admission probe only senses this).
# One shared 32-thread pool: MISS throughput without oversubscribing g++,
# which has its own spawn caps. Single worker => single loop => set once.
_LOOP_EXECUTOR = ThreadPoolExecutor(max_workers=32, thread_name_prefix="algo-loop")


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.get_running_loop().set_default_executor(_LOOP_EXECUTOR)
    # Sync by design: Cloud Run startup windows are minutes, so a +1-2s
    # ready delay buys a deterministic (non-cold) first request.
    try:
        from app.core.instrumenter.injector import instrument

        instrument("#include <iostream>\n#include <vector>\nint main(){return 0;}\n")
        logger.info("startup warm-up: libclang instrument ok")
    except Exception:
        logger.warning("startup warm-up: libclang skipped", exc_info=True)
    try:
        with tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False) as f:
            f.write("#include <iostream>\n#include <vector>\nint main(){return 0;}\n")
            tmp = f.name
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["g++", "-O2", "-o", os.devnull, tmp],
                capture_output=True,
                timeout=60,
                check=False,
            )
            logger.info("startup warm-up: g++ compile ok")
        finally:
            Path(tmp).unlink(missing_ok=True)
    except Exception:
        logger.warning("startup warm-up: g++ skipped", exc_info=True)
    yield


app = FastAPI(
    title="AlgoTheseus API",
    description="C++ DSA trace visualiser — libclang instrumentation + Docker sandbox",
    version="0.1.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# CORS origins are env-driven so the Cloudflare Pages origin can be allowed
# without code changes. Comma-separated; empties ignored; unset/empty keeps
# the localhost dev defaults. Never "*" (no wildcard with credentials).
_DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:3000"]


def _cors_origins() -> list[str]:
    raw = os.environ.get("FRONTEND_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or _DEFAULT_ORIGINS


# Allow the Vite dev server (port 5173) and any localhost origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(execute_router, prefix="/execute", tags=["execute"])
app.include_router(batch_router, prefix="/execute-batch", tags=["execute"])
app.include_router(jobs_router, prefix="/jobs", tags=["jobs"])
app.include_router(upload_router, prefix="/upload-testcases", tags=["upload"])

# Tiered per-IP limits (todo 23): exempt health, 429 + Retry-After via
# slowapi's default handler. Counters are in-memory (single instance).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/health")
@limiter.exempt
async def health() -> dict:
    return {"status": "ok"}
