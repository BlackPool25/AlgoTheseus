#!/usr/bin/env bash
# AlgoTheseus — Cloud Run deploy (build via Cloud Build, deploy via gcloud).
# Usage: ./deploy/cloudrun/deploy.sh [api|worker|all]   (default: api)
# Env:   PROJECT (required), REGION (default asia-south1), REPO (default algo-theseus)
# Never runs against free-tier hosts; Cloud Run only.
set -euo pipefail

MODE="${1:-api}"
PROJECT="${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-algo-theseus}"
IMG="$REGION-docker.pkg.dev/$PROJECT/$REPO/backend:latest"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

build() {
  gcloud builds submit --config "$ROOT/deploy/cloudrun/cloudbuild.yaml" \
    --substitutions="_REGION=$REGION,_REPO=$REPO" "$ROOT/backend"
}

deploy_api() {
  sed "s|_IMAGE|$IMG|" "$ROOT/deploy/cloudrun/service-api.yaml" > /tmp/algo-api.yaml
  gcloud run services replace /tmp/algo-api.yaml --region="$REGION" --project="$PROJECT"
}

deploy_worker() {
  sed "s|_IMAGE|$IMG|" "$ROOT/deploy/cloudrun/service-worker.yaml" > /tmp/algo-worker.yaml
  gcloud run services replace /tmp/algo-worker.yaml --region="$REGION" --project="$PROJECT"
}

case "$MODE" in
  api)    build && deploy_api ;;
  worker) build && deploy_worker ;;
  all)    build && deploy_api && deploy_worker ;;
  *) echo "usage: $0 [api|worker|all]" >&2; exit 2 ;;
esac

echo "API URL: $(gcloud run services describe algo-theseus-api --region="$REGION" --project="$PROJECT" --format='value(status.url)')"
