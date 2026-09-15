"""
main.py — FastAPI application entry point.

Registers routes, CORS, and global exception handling.
Run with: uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routes.execute import batch_router
from app.api.routes.execute import router as execute_router
from app.api.routes.upload import router as upload_router
from app.core.rate_limit import limiter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="DSA Visualiser API",
    description="C++ DSA trace visualiser — libclang instrumentation + Docker sandbox",
    version="0.1.0",
)

# Allow the Vite dev server (port 5173) and any localhost origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(execute_router, prefix="/execute", tags=["execute"])
app.include_router(batch_router, prefix="/execute-batch", tags=["execute"])
app.include_router(upload_router, prefix="/upload-testcases", tags=["upload"])

# Tiered per-IP limits (todo 23): exempt health, 429 + Retry-After via
# slowapi's default handler. Counters are in-memory (single instance).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/health")
@limiter.exempt
async def health() -> dict:
    return {"status": "ok"}
