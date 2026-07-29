# =============================================================================
# DSA Visualiser — Backend Dockerfile
# =============================================================================
# Build:   docker build -f backend/Dockerfile -t dsa-backend .
# Run:     docker run -d -p 8000:8000 dsa-backend
# Verify:  curl http://localhost:8000/health
# =============================================================================

FROM python:3.11-slim AS builder

# Install curl for healthchecks, uv for package management, and C++ headers for libclang
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pyproject.toml uv.lock ./

# Install production dependencies only (no dev, frozen from lockfile)
RUN uv sync --no-dev --frozen

# ---------------------------------------------------------------------------
# Runtime stage — copy only what is needed
# ---------------------------------------------------------------------------
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

# Copy the venv from the builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source (NOT tests/)
COPY app/ ./app/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
