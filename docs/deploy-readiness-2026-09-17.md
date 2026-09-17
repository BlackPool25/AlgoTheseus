# Deploy Readiness + Stress + Real-World Speeds (T7/S5) — 2026-09-17

**Verdict: CONDITIONAL GO for API cache path / NO-GO for full product until fixes 1-5 land.**

Repo: `~/projects/AlgoTheseus` | Date: 2026-09-17

## 1. Env (verbatim)

| Item | Value | Artifact |
|---|---|---|
| k6 | v2.2.0 | /tmp/at-burst.json, /tmp/at-spike.json |
| g++ | 16.2.1 | /tmp/at-uvicorn.log |
| uv | 0.11.32 | /tmp/at-uvicorn.log |
| BASE_URL | http://127.0.0.1:8001 (8000 busy mini-twitter-api) | /tmp/at-uvicorn.log |
| PID | 538818 | /tmp/at-uvicorn.log |
| SANDBOX_MODE / CACHE_DIR | subprocess / /tmp/at-cache | /tmp/at-uvicorn.log |
| Log | /tmp/at-uvicorn.log | /tmp/at-uvicorn.log |
| Health | 200 `{"status":"ok"}` | /tmp/at-uvicorn.log |
| Seed | 100% 80/80 checks, 0 failed | /tmp/at-uvicorn.log |

## 2. Cold vs Warm (S2)

| Path | Result | Artifact |
|---|---|---|
| Warm HIT 20/20 | avg 1.37ms, p50 1.37, p95 1.57, min 1.22, max 1.62, stdout 4950 correct | /tmp/at-uvicorn.log |
| Cold steady (v2-v5) | avg ~1316ms, p50 ~1331ms, v1 outlier 14.3s pool cold-start | /tmp/at-uvicorn.log |
| All-MISS | avg 3907, p50 1338, p95 11687 | /tmp/at-uvicorn.log |
| Pool touch | HIT never touches pool | /tmp/at-uvicorn.log |

## 3. Concurrency (S3) — PASS non-blocking at 8-way

| Item | Value | Artifact |
|---|---|---|
| Live 8 distinct | 8x200, 0x429, 0x5xx, wall 24.7s, max 24.7s | /tmp/at-uvicorn.log |
| Traces | 16-26 nonzero, stdout -1..3 distinct | /tmp/at-uvicorn.log |
| pytest TestConcurrentLoad | 1 passed | pytest output (T0b) |
| Pool note | pool=6 allows up to 2x429 by design, none observed = also PASS | /tmp/at-uvicorn.log |

## 4. Queue (S4) — InMemory cross-process gap proven

| Item | Value | Artifact |
|---|---|---|
| POST /jobs x3 | 202 queued, ids 15c3270e..., acaf1e0a..., 8eab74a3... | /tmp/at-uvicorn.log |
| worker --once x3 | exit 1 x3, no work, separate process, jobs stay queued | /tmp/at-uvicorn.log |
| Root cause | process-local asyncio.Queue | code: queue path |
| pytest test_queue_redis | 1 passed, 5 skipped (Redis 6399/6379 closed, no redis-cli) | pytest output (T6/S4) |
| Fix to get 3x done FIFO | REDIS_URL + live Redis | document as fix |

## 5. k6 Burst (T5) — exit 0 ALL PASS (verbatim)

```
checks 100% 185840/185840, 92920 reqs @1160.6/s 0 failed
HIT p50 57.39ms p95 87.4ms p99 111.34ms
hit_duration p50 57.39 p95 87.41
JSON /tmp/at-burst.json
```

## 6. k6 Spike (T5) — exit 99 MIXED (verbatim)

```
checks 62.15% FAIL, failed 75.68% FAIL
spike_5xx count==0 PASS
spike_429_retry_after rate 0.00% (zero 429s observed, bar NOT demonstrated)
1094 reqs @10/s med 60s timeouts, vus_max 1000, 266/1094 only 200-or-429
JSON /tmp/at-spike.json
Interpretation: cache scales, MISS-storm collapses as timeouts not fast-429
(backpressure leak under 1000VU unique-MISS, 0x5xx at least).
```

## 7. Pytest counts

| Suite | Result | Artifact |
|---|---|---|
| T0b | 5 passed (1 TestConcurrentLoad + 4 pool/coalescing) | pytest output |
| T6 | 7 passed (pool+coalescing+backpressure), no drift | pytest output |

## 8. Deploy table (swarm)

| File | Status | Note |
|---|---|---|
| backend/Dockerfile | OK | — |
| frontend Dockerfile | BLOCKER minor | no VITE_API_URL ARG, api.ts bakes empty |
| nginx.conf | compose-OK / static-BLOCKER | backend:8000 DNS |
| service-api.yaml | OK pending | REDIS secret pre-create, or strip secretKeyRef (code fail-opens) |
| service-worker.yaml | BLOCKER | httpGet /health on non-HTTP worker, must remove/use exec probe, no Cloud Tasks trigger, min0 idles |
| deploy.sh + cloudbuild.yaml | OK | — |
| netlify.toml | OK | needs dashboard VITE_API_URL |
| render.yaml | OK | free fallback |
| compose | local-DooD only | — |
| gh-pages-mirror | CAUTION | pinned branch, no COOP/COEP |
| CLOUDRUN.md | stale | conc15/min0/gen1 vs yaml conc20/min1/gen2 |
| CORS | BLOCKER | allowlist localhost-only, cross-origin deploy fails without patch |
| Limits | OK | 128MB/10s enforced both paths (compile 2GB allowance intentional) |
| Auth | none | no auth anywhere |

## 9. Instrumentation nuance (honest gate)

- Trivial loop-sum in main: zero trace calls, total_steps 0, runtime_error "No trace points...", injector mis-scopes loop var i in main, known per test_load comment, kept out deliberately.
- binary_search corpus: nonzero traces 16-26.
- smoke-deploy.sh total_steps>0 gate would FAIL on loop-sum but PASS on corpus. Record honestly.

## 10. Real-world speed model (ESTIMATES, not measured)

| Path | Local measured | Cloud Run 2CPU/2Gi (estimate) | Render Free 0.1CPU/512MB (estimate) |
|---|---|---|---|
| Warm HIT | ~1.37ms direct, ~57ms under 200VU (/tmp/at-burst.json) | p50 ~50-200ms, p95 <500ms sustainable | NOT viable: 3-8s, breaches 10s timeout |
| Cold MISS warm-instance | ~1316ms avg (/tmp/at-uvicorn.log) | ~1.3-2.5s (estimate) | NOT viable: <0.3 rps (estimate) |
| First-hit cold-start | 14.3s v1 outlier (/tmp/at-uvicorn.log) | +0.5-2s with minScale 1 / startup-boost, first request only (estimate) | worse, frequent sleep (estimate) |
| Throughput | 1160.6/s HIT burst (/tmp/at-burst.json) | ~2-3 rps per instance at pool 6, linear to maxScale 20 (~40-60 rps fleet) (estimate) | <0.3 rps (estimate) |

Notes (estimates): containerConcurrency should be 2-4 not 80 for compile workloads. Deployed speed unmeasured until live test authorized (never point k6 at public URL uninvited).

## 11. Top fixes ranked

1. Worker probe: remove httpGet /health in service-worker.yaml, use exec probe or none.
2. REDIS secret pre-create or strip secretKeyRef; set REDIS_URL + live Redis for 3x FIFO done.
3. VITE_API_URL ARG + dashboard value; CORS allowlist patch past localhost.
4. Spike backpressure triage: 60s timeouts vs fast-429 under 1000VU unique-MISS (/tmp/at-spike.json).
5. Trace-zero triage: trivial loop-sum total_steps 0 (injector i scope) vs corpus 16-26 pass.

Artifacts: /tmp/at-uvicorn.log, /tmp/at-burst.json, /tmp/at-spike.json, pytest T0b/T6 outputs.
