# =============================================================================
# AlgoTheseus — Backend Dockerfile
# =============================================================================
# Build:   docker build -f backend/Dockerfile -t algo-theseus-backend ./backend
# Run:     docker run -d -p 8000:8000 algo-theseus-backend
# Verify:  curl http://localhost:8000/health
# =============================================================================

FROM python:3.11-slim-bookworm AS builder

# uv for package management only (g++ lives in the runtime stage for the
# socketless subprocess jail — the builder never compiles C++).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
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
FROM python:3.11-slim-bookworm

# g++ stays in the runtime image: SANDBOX_MODE=subprocess compiles inside
# this container (no sandbox image, no Docker socket). No Python build
# tools here — the venv arrives ready-made from the builder.
# Pruned in the SAME layer (later-layer deletes would not shrink the image):
# LTO/C frontends, gold/dwp, binutils extras, static archives, sanitizer
# runtimes — none are touched by the jail's fixed `g++ -O0 -g` invocation.
# Rule: adding a compile flag (e.g. -flto/-static/-fsanitize) requires
# restoring the matching piece here first.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ccache \
    curl \
    g++ \
    && rm -rf /var/lib/apt/lists/ \
    && rm -f /usr/lib/gcc/x86_64-linux-gnu/*/lto1 \
        /usr/lib/gcc/x86_64-linux-gnu/*/lto-wrapper \
        /usr/lib/gcc/x86_64-linux-gnu/*/cc1 \
        /usr/bin/*-lto-dump* /usr/bin/*-dwp /usr/bin/*-ld.gold \
        /usr/bin/ar /usr/bin/nm /usr/bin/objcopy /usr/bin/objdump \
        /usr/bin/readelf /usr/bin/strings /usr/bin/strip \
        /usr/bin/addr2line /usr/bin/c++filt /usr/bin/elfedit \
        /usr/bin/gprof /usr/bin/gcov* /usr/bin/cpp \
    && find /usr/lib/gcc -name '*.a' ! -name 'libgcc.a' ! -name 'libgcc_eh.a' -delete \
    && rm -f /usr/lib/x86_64-linux-gnu/libasan.so* \
        /usr/lib/x86_64-linux-gnu/libubsan.so* \
        /usr/lib/x86_64-linux-gnu/liblsan.so* \
        /usr/lib/x86_64-linux-gnu/libtsan.so* \
    && rm -rf /usr/local/lib/python*/ensurepip \
        /usr/local/lib/python*/site-packages/pip* \
        /usr/share/zoneinfo /usr/share/doc /usr/share/man /usr/share/info

WORKDIR /app

# Copy the venv from the builder
COPY --from=builder /app/.venv /app/.venv

# Copy application source (NOT tests/)
COPY app/ ./app/

# Free-tier deploy defaults (todo 21, D4): socketless subprocess jail, single
# worker (in-memory rate-limit counters + disk LRU assume one instance),
# ephemeral cache under /tmp (no volume — sleep/restart wipes it, cold MISS
# expected). Compose overrides SANDBOX_MODE for local DooD dev.
ENV SANDBOX_MODE=subprocess \
    CACHE_DIR=/tmp/algo-theseus-cache
# ccache via the Debian compiler shim: identical instrumented sources (batch
# fan-out, retries, repeated assignments) compile in ~10-50ms. Ephemeral
# under /tmp by design — a cold MISS repopulates it, never a failure.
ENV PATH="/usr/lib/ccache:${PATH}" \
    CCACHE_DIR=/tmp/algo-theseus-ccache \
    CCACHE_MAXSIZE=500M

# Cloud Run: least privilege — non-root at runtime. Compose unaffected
# (same paths; /tmp stays world-writable; default CMD unchanged below).
RUN useradd -r -u 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# $PORT binding (Render/SnapDeploy inject PORT; default 8000 local).
# Single worker: exec-form would not expand $PORT, hence sh -c.
CMD ["sh", "-c", "/app/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
