# Troubleshooting

Symptom → cause → fix. Each fix is an exact command. If the fix doesn't work,
run the health-check step at the bottom and paste its output in your issue.

## 1. Port `9001` clash

**Symptom:** `docker compose up --build` fails with "port is already allocated".
**Cause:** another service owns the frontend port.
**Fix:** stop the other service or remap the frontend port, then:

```bash
docker compose up --build
```

## 2. Sandbox image missing

**Symptom:** backend errors about the sandbox image; sandbox tests fail to spawn.
**Cause:** `algo-theseus-sandbox:latest` was never built locally.
**Fix:**

```bash
docker build -f backend/docker/Dockerfile.sandbox -t algo-theseus-sandbox:latest backend/docker/
```

Rebuild after touching anything under `backend/docker/`.

## 3. `VITE_API_URL` mis-wire

**Symptom:** frontend loads but every run fails; API calls hit the wrong host.
**Cause:** static builds bake `VITE_API_URL` at build time — setting it after the
build has no effect.
**Fix:** set `VITE_API_URL` in the host dashboard (e.g. Cloudflare Pages env),
then rebuild (`bun install --frozen-lockfile && bun run build`). Unset/empty
keeps the same-origin dev fallback. Backend must also allow the frontend origin
via `FRONTEND_ORIGINS` (comma-separated, never `"*"`).

## 4. crossOriginIsolated is false on a static host

**Symptom:** `crossOriginIsolated === false`; no WASM path.
**Cause:** the host isn't sending COOP/COEP (the GH Pages mirror, which had
no header mechanism at all, was removed for exactly this reason).
**Fix:** on Cloudflare Pages / Netlify the headers ship with the repo
(`frontend/public/_headers`, `netlify.toml`) — verify in DevTools after
deploy. The D1 decision killed browser-WASM as primary anyway, so the app
renders the same server-driven replay either way. Use compose or Pages +
Cloud Run for the full path.

## 5. Backend pytest needs Docker

**Symptom:** `uv run pytest tests/ -v` fails on sandbox/executor tests.
**Cause:** those tests spawn real containers; the daemon must be up.
**Fix:**

```bash
docker info                # must succeed before running tests
cd backend && uv run pytest tests/ -v
```

## 6. Wrong Node/Bun versions

**Symptom:** frozen install or build fails with engine errors.
**Cause:** repo engines are `node >= 20`, `bun >= 1` (`package.json:21-24`).
**Fix:**

```bash
scripts/setup.sh --check-only   # probes docker/uv/bun/node/python with hints
```

## Health check (the proof)

```bash
docker compose up --build -d
scripts/smoke-deploy.sh http://localhost:9001   # want exit 0
docker compose down
```

Exit codes (`scripts/smoke-deploy.sh`): **0** = pass (`/health` 200 +
`POST /execute` bsearch `total_steps>0` + cold-vs-warm table); **1** = fail
closed (RETHINK or a check failed); **2** = `SLEEPING` + retry guidance
(backend asleep — wait ~60 s and re-run). Full deploy surface:
[SELF-HOSTING.md](SELF-HOSTING.md).
