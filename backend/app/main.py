"""
main.py — FastAPI application entry point.

Registers routes, CORS, and global exception handling.
Run with: uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.execute import batch_router
from app.api.routes.execute import router as execute_router
from app.api.routes.upload import router as upload_router

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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
