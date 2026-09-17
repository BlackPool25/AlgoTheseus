#!/usr/bin/env bash
# scripts/smoke-deploy.sh — free-tier deploy smoke proof (plan todo 21, D4).
#
# Usage: scripts/smoke-deploy.sh $BASE_URL
#   BASE_URL = local compose (e.g. http://localhost:9001) or a user-supplied
#   live host. NEVER point at a public URL uninvited — local compose only,
#   unless the user explicitly supplies a live URL.
#
# PASS = /health 200 + POST /execute bsearch total_steps>0 + cold-vs-warm
# table printed. Cold-start-to-200 >60s => RETHINK verdict, exit 1 (fail
# closed). Backend unreachable/asleep => SLEEPING + retry guidance, exit 2
# (never a hang: every curl is bounded by --max-time).
#
# No secrets, no --dry-run claims: every check hits the wire.

set -u

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
    echo "usage: $0 \$BASE_URL   (e.g. $0 http://localhost:9001)" >&2
    exit 2
fi
BASE_URL="${BASE_URL%/}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COLD_GATE_S=60

fail() { echo "SMOKE-FAIL: $1" >&2; exit "${2:-1}"; }
sleeping() {
    echo "SLEEPING: $1"
    echo "retry guidance: free-tier hosts sleep when idle (SnapDeploy auto-sleep,"
    echo "  Render 15min idle). Wait ~60s for auto-wake, then re-run: $0 $BASE_URL"
    exit 2
}

# ── 0. Deploy-file gate (RED-first: fails on the unconfigured target) ──
missing=()
for f in frontend/public/_headers netlify.toml render.yaml docs/DEPLOY.md; do
    [ -f "$REPO_ROOT/$f" ] || missing+=("$f")
done
if [ "${#missing[@]}" -gt 0 ]; then
    echo "DEPLOY-FILES-MISSING: ${missing[*]}"
    echo "hint: land the todo-21 free-deploy configs first (Pages _headers,"
    echo "  netlify.toml, render.yaml, DEPLOY.md)."
    exit 1
fi
echo "deploy-files: OK (4/4 present)"

# ── 1. Health with cold-start timing ──
echo "--- health: GET $BASE_URL/health (gate: 200 within ${COLD_GATE_S}s) ---"
health_out="$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time $((COLD_GATE_S + 5)) "$BASE_URL/health" 2>/tmp/smoke_curl_err.txt)"
curl_rc=$?
if [ $curl_rc -eq 28 ]; then
    echo "RETHINK: cold-start-to-200 exceeded ${COLD_GATE_S}s budget (curl timed out)."
    echo "verdict: todo 21 FAILS CLOSED — record RETHINK with alternatives"
    echo "  (paid host, smaller image, keep-warm ping) instead of passing."
    rm -f /tmp/smoke_curl_err.txt
    exit 1
fi
if [ $curl_rc -eq 7 ] || [ $curl_rc -eq 6 ]; then
    rm -f /tmp/smoke_curl_err.txt
    sleeping "backend unreachable at $BASE_URL (curl rc=$curl_rc — refused/DNS, likely asleep or compose down)."
fi
if [ $curl_rc -ne 0 ]; then
    err="$(cat /tmp/smoke_curl_err.txt 2>/dev/null)"; rm -f /tmp/smoke_curl_err.txt
    fail "health curl error rc=$curl_rc: $err"
fi
rm -f /tmp/smoke_curl_err.txt
health_code="${health_out%% *}"
health_secs="${health_out##* }"
health_ms="$(python3 -c "print(int(float('$health_secs')*1000))")"
if [ "$health_code" = "502" ] || [ "$health_code" = "503" ] || [ "$health_code" = "523" ] || [ "$health_code" = "524" ]; then
    sleeping "backend returned HTTP $health_code (wake/edge page, not the app)."
fi
[ "$health_code" = "200" ] || fail "health returned HTTP $health_code (want 200)."
echo "health: 200 in ${health_ms}ms"
if [ "$health_ms" -gt $((COLD_GATE_S * 1000)) ]; then
    echo "RETHINK: cold-start-to-200 ${health_ms}ms exceeded ${COLD_GATE_S}s budget."
    echo "verdict: todo 21 FAILS CLOSED — record RETHINK with alternatives."
    exit 1
fi

# ── 2. Execute bsearch twice (cold vs warm) ──
echo "--- execute: POST $BASE_URL/execute (bsearch fixture, want total_steps>0) ---"
run_execute() {
    python3 - "$BASE_URL" <<'EOF'
import json, sys, time, urllib.request
base = sys.argv[1]
code = open('/tmp/smoke_bsearch.cpp').read()
payload = json.dumps({"code": code, "raw_stdin": ""}).encode()
t0 = time.monotonic()
try:
    req = urllib.request.Request(base + "/execute", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=65) as r:
        body, status = r.read().decode(), r.status
except Exception as e:
    print(f"CURLERR {e}")
    sys.exit(3)
ms = int((time.monotonic() - t0) * 1000)
try:
    steps = json.loads(body).get("total_steps", 0)
except Exception:
    print(f"BADJSON status={status} ms={ms}")
    sys.exit(4)
print(f"status={status} total_steps={steps} ms={ms}")
sys.exit(0 if (status == 200 and steps and steps > 0) else 5)
EOF
}

cp "$REPO_ROOT/backend/tests/fixtures/simple_bsearch.cpp" /tmp/smoke_bsearch.cpp

cold_out="$(run_execute)"; cold_rc=$?
warm_out="$(run_execute)"; warm_rc=$?
rm -f /tmp/smoke_bsearch.cpp

for run in "cold:$cold_out:$cold_rc" "warm:$warm_out:$warm_rc"; do
    label="${run%%:*}"; rest="${run#*:}"; out="${rest%:*}"; rc="${rest##*:}"
    case "$rc" in
        3) sleeping "execute $label call could not reach backend ($out)." ;;
        4) fail "execute $label call returned unparseable body ($out)." ;;
        5) fail "execute $label call weak result ($out — want status=200 total_steps>0)." ;;
        0) echo "execute-$label: $out" ;;
        *) fail "execute $label call unexpected rc=$rc ($out)." ;;
    esac
done

cold_ms="$(echo "$cold_out" | sed -n 's/.* ms=\([0-9]*\)/\1/p')"
warm_ms="$(echo "$warm_out" | sed -n 's/.* ms=\([0-9]*\)/\1/p')"
echo "--- cold-vs-warm table (ms, wall-clock incl. sandbox compile) ---"
printf '%-6s | %10s\n' "call" "ms"
printf '%-6s | %10s\n' "cold" "$cold_ms"
printf '%-6s | %10s\n' "warm" "$warm_ms"
echo "SMOKE-PASS: health 200 + execute total_steps>0 (cold ${cold_ms}ms / warm ${warm_ms}ms)"
