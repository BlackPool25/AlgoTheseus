# Unified guide: docs/SELF-HOSTING.md §Redis-note is canonical; this file keeps the option detail.
# AlgoTheseus — Redis options for Cloud Run (no in-image Redis, no volume)
#
# The API/worker YAMLs read REDIS_URL from the `algo-theseus-redis-url` secret.
# Ephemeral /tmp cache works without Redis; Redis only adds shared rate-limit
# counters + batch state across instances. Pick ONE:
#
# Option A — Upstash (serverless, free-tier friendly, TLS):
#   1. Create DB at upstash.com (pick region near Cloud Run, e.g. ap-south-1
#      for asia-south1).
#   2. Copy the `rediss://` URL.
#   3. gcloud secrets create algo-theseus-redis-url --data-file=- <<<"rediss://..."
#      (or `... versions add` if it exists). No VPC connector needed.
#   Best when: scale-to-zero + zero ops. Watch: per-request latency vs VPC.
#
# Option B — Memorystore for Redis (VPC, lowest latency):
#   1. Create instance in the same region/VPC as Cloud Run.
#   2. Attach a Serverless VPC Access connector to both services:
#      gcloud run services update algo-theseus-api --vpc-connector=$CONNECTOR
#   3. Store `redis://<private-ip>:6379` in the same secret as above.
#   Best when: steady traffic justifies always-on cost. Overkill at zero scale.
#
# Option C — Cloud Tasks instead of Redis (alternative, not addition):
#   If the only need is "queue for the worker", skip Redis: push batch jobs to
#   a Cloud Tasks queue targeting the worker service (internal ingress) and let
#   max-instances 0-20 scale on queue depth. No broker to run. See docs/CLOUDRUN.md.
#
# Local/compose: `redis` service (redis:7-alpine, internal only, no public
# port) + backend `REDIS_URL=${REDIS_URL:-redis://redis:6379/0}`.
# Override per-shell with `REDIS_URL=... docker compose up` (empty/unset =
# fail-open in-memory path, see app/queue/backends.py). No secret needed locally.
#
# Cloud Run secret (exact):
#   printf 'rediss://...' | gcloud secrets create algo-theseus-redis-url --data-file=-
#   # if it already exists:
#   printf 'rediss://...' | gcloud secrets versions add algo-theseus-redis-url --data-file=-
#   # Upstash: paste the `rediss://` (TLS) URL as-is. Memorystore: store
#   # `redis://<private-ip>:6379` instead (needs a VPC connector, see Option B).
#   # verify:
#   gcloud secrets describe algo-theseus-redis-url
#   gcloud secrets versions access latest --secret=algo-theseus-redis-url | head -c 20
