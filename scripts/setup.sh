#!/usr/bin/env bash
# scripts/setup.sh — one-command contributor bootstrap (plan todo 20).
#
# Usage: scripts/setup.sh [--check-only] [--help]
#   (no args)    preflight + backend deps + frontend deps + sandbox image
#                + `docker compose config` smoke. Safe to re-run (idempotent).
#   --check-only preflight probes only (docker/uv/bun/node versions).
#   --help       print this usage.
#
# Never starts servers or daemons, never writes .env files, never sudo.
# Linux, macOS, and WSL2 supported. Command spellings mirror .github/workflows/ci.yml.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ONLY=0

fail() { echo "SETUP-FAIL: $1" >&2; exit "${2:-1}"; }
ok() { echo "$1: OK$2"; }

usage() {
    sed -n '2,12p' "$0" | sed 's/^# \?//'
}

for arg in "$@"; do
    case "$arg" in
        --help|-h) usage; exit 0 ;;
        --check-only) CHECK_ONLY=1 ;;
        *) fail "unknown flag: $arg (see --help)" 2 ;;
    esac
done

# ── preflight probes ──
missing=()

echo "--- preflight (Linux/macOS/WSL2; no sudo assumed) ---"
case "$(uname -s)" in
    Linux|Darwin) ok "os" " ($(uname -s))" ;;
    *) fail "unsupported OS: $(uname -s) (want Linux, macOS, or WSL2)" ;;
esac

docker info >/dev/null 2>&1 \
    && ok "docker" " ($(docker --version 2>/dev/null))" \
    || { echo "docker: MISSING or daemon unreachable (hint: install Docker Desktop / start dockerd, then re-run)" >&2; missing+=("docker"); }

command -v uv >/dev/null 2>&1 \
    && ok "uv" " ($(uv --version 2>/dev/null))" \
    || { echo "uv: MISSING (hint: curl -LsSf https://astral.sh/uv/install.sh | sh)" >&2; missing+=("uv"); }

command -v bun >/dev/null 2>&1 \
    && ok "bun" " ($(bun --version 2>/dev/null))" \
    || { echo "bun: MISSING (hint: curl -fsSL https://bun.sh/install | bash; want bun>=1 per package.json engines)" >&2; missing+=("bun"); }

if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 20 ] 2>/dev/null; then
        ok "node" " ($(node --version 2>/dev/null), want >=20 per package.json engines)"
    else
        echo "node: too old ($(node --version 2>/dev/null); want >=20 per package.json engines)" >&2
        missing+=("node>=20")
    fi
else
    echo "node: MISSING (hint: install Node 20+; bun bundles one, system node still required by engines)" >&2
    missing+=("node")
fi

if command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
        ok "python" " ($(python3 --version 2>&1), want 3.11+ per README)"
    else
        echo "python: too old ($(python3 --version 2>&1); want 3.11+ per README)" >&2
        missing+=("python>=3.11")
    fi
else
    echo "python: MISSING (hint: python.org, want 3.11+ per README)" >&2
    missing+=("python")
fi

if [ "${#missing[@]}" -gt 0 ]; then
    echo "SETUP-PREREQS-MISSING: ${missing[*]}" >&2
    echo "hint: install the tools above, then re-run: scripts/setup.sh" >&2
    exit 1
fi

[ "$CHECK_ONLY" -eq 1 ] && { echo "preflight: all present"; exit 0; }

# ── 1. Backend deps (mirrors ci.yml) ──
echo "--- backend: uv sync --extra dev ---"
(cd "$REPO_ROOT/backend" && uv sync --extra dev)

# ── 2. Frontend deps (mirrors ci.yml) ──
echo "--- frontend: bun install --frozen-lockfile ---"
(cd "$REPO_ROOT/frontend" && bun install --frozen-lockfile)

# ── 3. Sandbox image (mirrors ci.yml + README Troubleshooting) ──
echo "--- sandbox: docker build Dockerfile.sandbox ---"
docker build -f backend/docker/Dockerfile.sandbox -t algo-theseus-sandbox:latest backend/docker/

# ── 4. Compose smoke (validate only — never `up`, never starts anything) ──
echo "--- compose: docker compose config (validate only) ---"
(cd "$REPO_ROOT" && docker compose config >/dev/null) \
    || fail "docker compose config rejected docker-compose.yml"

echo "SETUP-PASS: backend + frontend + sandbox image + compose config all good"
