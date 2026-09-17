# DEPLOY.md — free-tier deployment (todo 21, D4)

> Unified guide: [SELF-HOSTING.md](SELF-HOSTING.md) is the canonical self-host reference; this file keeps the free-tier detail.

Decision context: `docs/deploy-decision.md` (D1 kill-criteria fired —
browser-WASM is dead as primary). **Server-container is THE path**; the
frontend below is a static shell that talks to it. This doc proves the
free-forever surface with a script, not claims:
`scripts/smoke-deploy.sh $BASE_URL` must exit 0.

## 0. Architecture

- Frontend (static): Cloudflare Pages primary · Netlify runner-up ·
  GH Pages mirror-only. COOP/COEP headers on Pages + Netlify so
  `crossOriginIsolated` can go true for the future WASM path; the app
  serves the server replay either way.
- Backend (container, todo-20 image): SnapDeploy free primary · Render
  free fallback. `SANDBOX_MODE=subprocess`, single worker, ephemeral
  `CACHE_DIR=/tmp/algo-theseus-cache` (no volume — sleep wipes it, cold MISS
  expected, never a failure).

## 1. Frontend — Cloudflare Pages (primary, free, no sleep)

Static sites on Pages do not sleep. Free plan: unlimited bandwidth for
static, 500 builds/month.

1. Push the branch to GitHub.
2. Dash → Workers & Pages → Create → Pages → Connect to Git → pick repo.
3. Build settings: root directory `frontend`, build command
   `bun install --frozen-lockfile && bun run build`, output `dist`.
4. Env: `VITE_API_URL` = Cloud Run API URL (e.g. the `status.url` from
   `gcloud run services describe algo-theseus-api`). Vite bakes this at
   build time — setting it after the build has no effect; rebuild on change.
   Unset/empty keeps the same-origin dev fallback (Vite proxy / nginx).
5. Deploy. Headers come from `frontend/public/_headers` (copied to `dist`
   verbatim by Vite) — verify in DevTools: `crossOriginIsolated === true`.
6. Backend must allow the Pages origin: set `FRONTEND_ORIGINS` on the API
   (comma-separated, e.g. the Pages `https://<project>.pages.dev` URL) —
   defaults stay localhost-only. Docker-local flow needs nothing: empty
   `VITE_API_URL` + `frontend/nginx.conf` proxy covers it.

## 2. Frontend — Netlify (runner-up, free, no sleep)

Static sites on Netlify do not sleep. Free plan: 100 GB bandwidth/month.

1. Dash → Add new site → Import an existing project → pick repo.
2. `netlify.toml` at repo root is auto-detected: base `frontend`,
   build `bun install --frozen-lockfile && bun run build`, publish `dist`.
3. COOP/COEP + SPA fallback ship in the same file (`[[headers]]`,
   `[[redirects]]`) — no dashboard header config needed.
4. Deploy. Same backend-URL wiring as Pages §1 step 6.

## 3. Frontend — GH Pages (mirror ONLY)

**Header limitation:** GitHub Pages has no custom-header mechanism
(no `_headers` equivalent), so COOP/COEP are unset here,
`crossOriginIsolated` is always false, and the app permanently takes the
server path. WASM-immune: D1 already killed browser-WASM as primary, so
nothing is lost — same server-driven replay.

1. Settings → Pages → Source: GitHub Actions.
2. The workflow `.github/workflows/gh-pages-mirror.yml` builds
   `frontend/` with `VITE_BASE=/<repo>/` and deploys `frontend/dist`.
3. It runs on pushes to the feature branch touching
   `frontend/**`, or manually via workflow_dispatch.

## 4. Backend — SnapDeploy free (primary)

Free: up to 4 containers, 512 MB RAM, 10 deploys/day, no credit card.
**Sleep disclosure: containers auto-sleep when idle and auto-wake on
traffic (~60 s).** You pay nothing while asleep; first request after idle
waits for wake. Never promised otherwise.

1. Dash → New Service → From GitHub → pick repo.
2. Dockerfile path `backend/Dockerfile`, context `backend/`.
3. Port: `8000` (or leave default — the image honors `$PORT`).
4. Env: `SANDBOX_MODE=subprocess` (image default; set explicitly to be
   sure), `CACHE_DIR=/tmp/algo-theseus-cache` (image default; ephemeral by design).
5. Deploy → `GET /health` returns `{"status":"ok"}`.
6. Cold reality: first wake after idle takes ~60 s; the smoke script
   reports SLEEPING with retry guidance instead of hanging, and a
   cold-start-to-200 over 60 s is a RETHINK verdict (todo fails closed).

## 5. Backend — Render free (fallback)

Free: 750 instance-hours/month, shared CPU, 512 MB RAM.
**Sleep disclosure: spins down after 15 min without inbound traffic;
spin-up on next request takes ~1 min** (visitor sees Render's loading
page). Never promised otherwise.

1. Dash → New → Web Service → pick repo, or New → Blueprint and point at
   `render.yaml` (service `algo-theseus-backend`, `plan: free`,
   `healthCheckPath: /health`, env baked in).
2. Manual path: runtime Docker, Dockerfile `backend/Dockerfile`, context
   `backend/`, env `SANDBOX_MODE=subprocess`, `CACHE_DIR=/tmp/algo-theseus-cache`,
   `MAX_BATCH_SANDBOXES=2` (small instances — below the local default 4).
3. Create → `GET /health` returns `{"status":"ok"}`.
4. Same wake/RETHINK honesty as §4.

## 6. Cold-start expectations + WASM-immune note

| Host | Idle behaviour | Wake cost | Note |
|---|---|---|---|
| Cloudflare Pages | none (static) | 0 | primary frontend |
| Netlify | none (static) | 0 | runner-up frontend |
| GH Pages | none (static) | 0 | mirror-only, no COOP/COEP (§3) |
| SnapDeploy free | auto-sleep idle | ~60 s auto-wake | primary backend |
| Render free | down after 15 min idle | ~1 min spin-up | fallback backend |

WASM-immune: no deploy target above serves a browser toolchain; WASM
blobs (if any future retry) are same-origin (`index.html` has no CDN
subresource; Vite `base` keeps them relative). D1 killed WASM as
primary, so headers are future-proofing, not a runtime dependency.

## 7. Verify (the only proof that counts)

```bash
# local compose (default; no public load ever):
docker compose up --build -d
scripts/smoke-deploy.sh http://localhost:9001   # want exit 0
docker compose down

# live host ONLY with an explicit user-supplied URL:
scripts/smoke-deploy.sh https://<user-supplied-host>
```

PASS = `/health` 200 + `POST /execute` bsearch `total_steps>0` +
cold-vs-warm ms table in output. Asleep backend ⇒ `SLEEPING` + retry
guidance (exit 2, not a hang). Cold-to-200 > 60 s ⇒ `RETHINK`, exit 1,
todo fails closed.
