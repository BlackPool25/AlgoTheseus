# SELF-HOSTING.md — unified self-host guide (canonical)

This file is the canonical self-host reference. The fragment files below keep their
detail and each carries a pointer header back here; read here first.

## Fragment disposition (all 5 sources)

| # | Source | Status | What lives where |
|---|---|---|---|
| 1 | `docs/DEPLOY.md` | kept, pointer header | free-tier detail (Pages/Netlify/SnapDeploy/Render steps, cold-start table, §7 verify contract) |
| 2 | `docs/CLOUDRUN.md` | kept, pointer header | Cloud Run production detail (deploy.sh flow, scaling, SEO/crawler notes, costs) |
| 3 | `docs/LAUNCH.md` | kept, pointer header | launch checklist (domain swap, legal, CSP, day-one, ongoing) — not deploy steps |
| 4 | `deploy/cloudrun/redis-note.md` | kept, pointer header | Redis option detail (Upstash vs Memorystore vs Cloud Tasks, exact secret commands) |
| 5 | `scripts/smoke-deploy.sh` | kept as-is, referenced | deploy gate script — behavior unchanged; exit codes documented in §7 |

Port-before-convert: every unique step below was ported from the fragments first; no
fragment body was deleted or trimmed, so nothing could be lost.

## Paths

- **A. Local compose (default dev path):** `docker compose up --build`, open the
  frontend port. Same ports `scripts/setup.sh` wires for contributors.
- **B. Static frontend + Cloud Run backend (scale-to-zero upgrade):** Cloudflare Pages
  serves `frontend/`; `VITE_API_URL` points at the Cloud Run API URL (§4).
- **C. Free-tier static + container (no cloud bill):** Pages or Netlify frontend;
  SnapDeploy free primary or Render free fallback backend (§5).
- **GH Pages mirror removed:** the mirror workflow is deleted (it could never
  set COOP/COEP — no header mechanism on GitHub Pages — and cost a third
  deploy target). Static hosting is Pages primary, Netlify runner-up.

## Static frontend (Pages primary, Netlify runner-up)

Build (both hosts): `bun install --frozen-lockfile && bun run build`, output `dist`,
root directory `frontend`. `VITE_API_URL` = API URL, baked at build time — rebuild on
change; unset keeps the same-origin dev fallback. `VITE_SITE_URL` = canonical domain
(prod builds must set it; fail-closed: `grep -r "%VITE_" dist/` must print nothing).
Headers: Pages uses `frontend/public/_headers`; Netlify uses `netlify.toml`
(`[[headers]]` + `[[redirects]]`, auto-detected).

## Cloud Run backend

Prereqs: GCP project with billing, Artifact Registry repo, authed `gcloud`. Image is
compose-compatible (default CMD uvicorn `app.main:app`, single worker).

```bash
export PROJECT=<gcp-project> REGION=asia-south1
./deploy/cloudrun/deploy.sh api   # worker: `worker`, both: `all`
# dry-run YAML check without touching prod:
gcloud run services replace deploy/cloudrun/service-api.yaml --region="$REGION" --dry-run
API_URL=$(gcloud run services describe algo-theseus-api --region="$REGION" --format='value(status.url)')
curl "$API_URL/health"            # {"status":"ok"}
scripts/smoke-deploy.sh "$API_URL"
```

Then: Pages dashboard env `VITE_API_URL=$API_URL` + rebuild; allow the Pages origin
via `FRONTEND_ORIGINS` (see §6 CORS). Equivalent without the script: `gcloud builds
submit` with `deploy/cloudrun/cloudbuild.yaml`, then `gcloud run services replace`
(deploy.sh does exactly this). Full detail: `docs/CLOUDRUN.md` §§1–3, costs §5.

## Free-tier backends (sleep disclosures, never promised otherwise)

| Host | Idle behaviour | Wake cost |
|---|---|---|
| SnapDeploy free (primary) | auto-sleep idle | ~60 s auto-wake |
| Render free (fallback) | down after 15 min idle | ~1 min spin-up |

Both: `SANDBOX_MODE=subprocess`, ephemeral `CACHE_DIR=/tmp/algo-theseus-cache`
(sleep wipes it, cold MISS expected). SnapDeploy: Dockerfile `backend/Dockerfile`,
port `8000` (image honors `$PORT`). Render: Blueprint `render.yaml` or manual Docker
runtime with `MAX_BATCH_SANDBOXES=2` on small instances. Cold-start honesty: asleep
backend ⇒ smoke script reports SLEEPING (exit 2); cold-to-200 over 60 s ⇒ RETHINK,
exit 1, todo fails closed. Render `*.onrender.com` sends `X-Robots-Tag: noindex` —
keep it fallback-only; canonical URLs point at Pages + Cloud Run. Full detail:
`docs/DEPLOY.md` §§4–6.

## Env wiring

Condensed from the todo-6 canonical table (12 vars; used-by file:line; defaults are
code truth, examples stay placeholder-only).

| Var | Used-by | Default | Prod note |
|---|---|---|---|
| `VITE_API_URL` | `frontend/src/utils/api.ts:28,30` | unset (same-origin fallback) | Pages dashboard env, baked at build; must match `_headers` connect-src |
| `VITE_SITE_URL` | `frontend/src/routes/Visualize.tsx:13`, `Algorithms.tsx:13` | unset | SEO canonical/og; replace `https://www.example.com` placeholder everywhere |
| `SANDBOX_MODE` | `backend/app/core/executor/docker_runner.py:205`; `docker-compose.yml:31` | `docker` | compose `${SANDBOX_MODE:-docker}`; Cloud Run/SnapDeploy/Render: `subprocess` |
| `SANDBOX_MAX_CONCURRENT` | `backend/app/api/routes/execute.py:134,136` | `6` | service-api.yaml `"6"`; pool cap every batch nests inside |
| `MAX_BATCH_SANDBOXES` | `backend/app/api/routes/execute.py:943` | `4` | DRIFT: CLOUDRUN §2 says `2`, live YAML says `"4"` — value TBD(owner) |
| `REDIS_URL` | `cache.py:273`; `queue/backends.py:217`; `rate_limit.py:82,132`; `docker-compose.yml:34` | fail-open (L2/in-memory) | compose `${REDIS_URL:-redis://redis:6379/0}`; prod: secret `algo-theseus-redis-url` |
| `FRONTEND_ORIGINS` | `backend/app/main.py:80` | `http://localhost:5173,http://localhost:3000` | comma-separated; empties ignored, never `"*"` |
| `CACHE_DIR` | `backend/app/core/executor/cache.py:95,117` | `/tmp/algo-theseus-cache` | ephemeral by design |
| `CACHE_MAX_BYTES` | `cache.py:118` | code default | L2 size cap; visibility TBD(owner) |
| `CACHE_TTL_SECONDS` | `cache.py:119,274` | code default | L1/L2 TTL; visibility TBD(owner) |
| `TRUSTED_PROXY_COUNT` | `backend/app/core/rate_limit.py:51` | `1` | client-IP trust depth; visibility TBD(owner) |
| `PORT` | `backend/Dockerfile:84`; `service-api.yaml:32` | `8000` via `${PORT:-8000}` | injected by host; never hardcode |

## CORS

`backend/app/main.py:80` reads `FRONTEND_ORIGINS` (comma-separated; empties ignored,
never `"*"`). Defaults cover local dev (`http://localhost:5173`,
`http://localhost:3000`). Self-host list: add the Pages/Netlify origin
(`https://<project>.pages.dev`) via `gcloud run services update --set-env-vars`
(Cloud Run) or the host dashboard env (SnapDeploy/Render); docker-local needs nothing.

## Redis note (summary)

Full detail: `deploy/cloudrun/redis-note.md`. Redis only adds shared rate-limit
counters + batch state; ephemeral `/tmp` cache works without it. Pick ONE: **Upstash**
(`rediss://` TLS URL as-is, no VPC, best at zero scale) vs **Memorystore** (VPC,
lowest latency, overkill at zero scale) vs **Cloud Tasks** (alternative when the only
need is a worker queue — no broker). Secret name only: `algo-theseus-redis-url`
(reference via secretKeyRef, never inline). Local/compose: internal `redis` service,
`REDIS_URL=${REDIS_URL:-redis://redis:6379/0}`, empty/unset = fail-open in-memory.

## Verify (the only proof that counts)

```bash
# local compose (default; no public load ever):
docker compose up --build -d
scripts/smoke-deploy.sh http://localhost:9001   # want exit 0
docker compose down

# live host ONLY with an explicit user-supplied URL:
scripts/smoke-deploy.sh https://<user-supplied-host>
```

Exit semantics (read from `scripts/smoke-deploy.sh`, never guessed): **0** = SMOKE-PASS
(`/health` 200 + `POST /execute` bsearch `total_steps>0` + cold-vs-warm table);
**1** = fail closed (`RETHINK` cold-to-200 over 60 s, or health/execute check failed);
**2** = `SLEEPING` + retry guidance (backend unreachable/asleep — refused/DNS, or
wake/edge 502/503/523/524), never a hang (every curl bounded by `--max-time`).

## Secrets (names only — never values)

Per todo-2 verdicts (0 LEAK / 14 PLACEHOLDER): the repo carries placeholder references
only. Names a self-hoster must provide in the target env: `algo-theseus-redis-url`
(Secret Manager, `rediss://`/`redis://` value set via `gcloud secrets create|versions
add`, verified via `describe`/`access`); `PROD_URL` (GitHub Actions secret for the
k6-prod workflow, overridable per-run via `base_url` input); `FRONTEND_ORIGINS`
(host env, CORS list above). Real values live in deploy envs / Secret Manager, never
in the repo. No rotation outstanding.

## Launch cross-links (detail stays in `docs/LAUNCH.md`)

Domain swap (real domain replaces `https://www.example.com` in `index.html`,
`_redirects`, `_headers`, `sitemap.xml`, `robots.txt`, `.env.production.example`
+ `VITE_SITE_URL`/`VITE_API_URL` Pages envs) · legal review of
`Privacy/Terms/Contact` baselines · CSP Report-Only → enforcing flip · day-one
checks (dist grep, noindex, sitemap, PageSpeed) · ongoing (uptime, GSC, favicons).

## Cross-links

- Free-tier detail: [DEPLOY.md](DEPLOY.md) · Cloud Run detail: [CLOUDRUN.md](CLOUDRUN.md)
- Launch checklist: [LAUNCH.md](LAUNCH.md) · Redis detail: [../deploy/cloudrun/redis-note.md](../deploy/cloudrun/redis-note.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Contributor setup: [../scripts/setup.sh](../scripts/setup.sh)
