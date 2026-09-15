# CLOUDRUN.md — Cloud Run production backend (the scale-to-zero upgrade)

Why: free-tier backends sleep — SnapDeploy auto-sleeps idle (~60 s wake),
Render spins down after 15 min idle (~1 min spin-up). Cloud Run scales to zero
too, but wake is seconds and you pay per-request instead of per-sleep-cycle.
Frontend stays on Cloudflare Pages; `VITE_API_URL` points at the Cloud Run API URL.

## 0. Prerequisites

- GCP project with billing, Artifact Registry repo, `gcloud` authed.
- Secret (optional but recommended): `algo-theseus-redis-url` (see
  `deploy/cloudrun/redis-note.md` — Upstash vs Memorystore vs Cloud Tasks).
- Image is compose-compatible: default CMD is still the uvicorn API
  (`app.main:app`, single worker); worker runs via override
  `/app/.venv/bin/python -m app.worker` (reserved in
  `service-worker.yaml`; `app.worker` does not exist yet — deploy API only
  until it lands).

## 1. Step-by-step

```bash
export PROJECT=<gcp-project> REGION=asia-south1  # near your users

# one-time: registry + secret
gcloud artifacts repositories create algo-theseus --repository-format=docker \
  --location="$REGION" --project="$PROJECT"
# optional: printf 'rediss://...' | gcloud secrets create algo-theseus-redis-url --data-file=-

# build + deploy API (worker: arg `worker`, both: `all`)
./deploy/cloudrun/deploy.sh api

# dry-run YAML check without touching prod:
gcloud run services replace deploy/cloudrun/service-api.yaml \
  --region="$REGION" --dry-run

# verify (same contract as docs/DEPLOY.md §7):
API_URL=$(gcloud run services describe algo-theseus-api \
  --region="$REGION" --format='value(status.url)')
curl "$API_URL/health"                                        # {"status":"ok"}
scripts/smoke-deploy.sh "$API_URL"

# wire the frontend: Cloudflare Pages env VITE_API_URL=$API_URL, rebuild.
# (frontend/src/utils/api.ts: BASE_URL = import.meta.env.VITE_API_URL ?? "")
```

Equivalent without the script: `gcloud builds submit` with
`deploy/cloudrun/cloudbuild.yaml`, then
`gcloud run services replace` on the rendered YAML (deploy.sh does exactly this).

## 2. Env table

| Var | Value (baked in YAML) | Notes |
|---|---|---|
| `SANDBOX_MODE` | `subprocess` | socketless g++ jail; no Docker socket on Cloud Run, `docker` mode impossible |
| `CACHE_DIR` | `/tmp/algo-theseus-cache` | ephemeral by design: restart wipes it, cold MISS expected |
| `MAX_BATCH_SANDBOXES` | `2` | small-instance cap, same as render.yaml |
| `REDIS_URL` | secret `algo-theseus-redis-url` | shared counters/batch state; omit secret binding if unused |
| `PORT` | injected by Cloud Run | image honors `${PORT:-8000}`; never hardcode 8000 |

## 3. Scaling notes

- API: cpu 2 / 2 Gi, concurrency 15, min 0 / max 10. Single uvicorn worker per
  instance (in-memory rate-limit counters assume few instances); scale by
  instances, not workers. CPU throttling off + startup boost blunt cold starts.
- Worker: cpu 2 / 4 Gi, **concurrency 1**, min 0 / max 20, internal ingress —
  scales on queue depth (Cloud Tasks), not traffic. `timeoutSeconds` 900.
- Cold starts: gen1 (gVisor) fork/exec for g++ is slower than gen2; uncomment
  the `execution-environment: gen2` annotation if compiles feel slow.
- Filesystem: `/tmp` is ephemeral and per-instance — never a shared cache.
- CORS: `backend/app/main.py` allows only Vite dev origins; add the Pages
  domain to `allow_origins` when wiring a browser-direct frontend.

## 4. SEO / crawler notes (and the Render warning)

- The API serves no HTML: crawlers get JSON/429s, which is correct. Index the
  Cloudflare Pages frontend, never the `*.run.app` URL.
- **Render free warning:** Render's free web services send
  `X-Robots-Tag: noindex` and serve `robots.txt` disallowing all crawlers on
  `*.onrender.com`. Keep Render as fallback backend only; canonical URLs and
  sitemap must point at Pages + Cloud Run, so the noindex header never leaks
  onto indexed content.

## 5. Costs / when NOT to use

- Idle costs ~zero (min 0); bill is requests + build minutes + optional Redis.
- Do not use if: sustained high-traffic (a fixed VM wins), workloads needing
  a writable shared disk (use GCS), or Docker-in-Docker sandboxing
  (`SANDBOX_MODE=docker` cannot work here — subprocess only).
