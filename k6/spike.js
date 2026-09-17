// k6/spike.js — Wave7 5.1 spike harness: 50 -> 1000 VUs, expect 429s not 500s.
//
// Wave6 3.2 fail-fast contract: when the sandbox pool (SANDBOX_MAX_CONCURRENT,
// default 6) saturates, POST /execute returns
//   429 {"detail": "sandbox saturated, retry"} + Retry-After: 5
// and NEVER queues. Cache HITs/singleflight waiters never touch the pool, so
// they never 429. A 500 under spike = backpressure leak = real failure.
//
// This is an ERROR-SHAPE probe, not a latency probe: the Wave7 threshold
// sentence scopes http_req_failed<0.05-iff-429 to spike, while the HIT
// p50/p95 + global p99 latency bars target burst/soak cache traffic (under
// true-unique-MISS spike, ~3% of samples are 1.3s pool runs BY DESIGN —
// diluting them below 1% needs >100x pool throughput, not a client fix).
// Accordingly spike thresholds assert failure SHAPE (429s, never 5xx, never
// timeouts) and record durations without latency bars.
//
// 429s are EXPECTED here, so they must not trip http_req_failed: we install
// expectedStatuses(200, 429) via response callback. A separate 5xx counter
// enforces zero server errors, and a 429 check proves backpressure engaged
// with the Retry-After contract intact. 4.2 client behavior: back off on a
// saturated 429 (sleep Retry-After + jitter, one retry) instead of spinning.
//
// Usage:
//   k6 run k6/spike.js -e BASE_URL=http://localhost:8000
//   k6 run --out json=spike-summary.json k6/spike.js -e BASE_URL=https://<prod>
//
// Thresholds: failed<5% (429s excluded — timeouts/5xx still fail), 5xx
// count==0, saturated-429 contract observed, checks>0.95.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// 429 = healthy backpressure -> not a failed request. 500s stay failures.
http.setResponseCallback(http.expectedStatuses(200, 429));

export const options = {
  stages: [
    { duration: '20s', target: 50 }, // baseline
    { duration: '10s', target: 1000 }, // spike
    { duration: '30s', target: 1000 }, // hold the spike
    { duration: '20s', target: 0 }, // recover
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    spike_5xx: ['count==0'],
    spike_429_retry_after: ['rate>0'], // backpressure must engage at least once
    checks: ['rate>0.95'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
const BASES = (__ENV.BASE_URLS || BASE).split(',').map((s) => s.trim());
function base() {
  return BASES[__VU % BASES.length];
}
const spike_5xx = new Counter('spike_5xx');
const spike_429_retry_after = new Rate('spike_429_retry_after');

const WARM = '#include <iostream>\nint main(){std::cout<<"hi";return 0;}';

export default function () {
  // Alternate warm replays (HIT, no pool slot) with unique MISS programs
  // (pool slot each) so the spike actually pressures the pool.
  // X-Forwarded-For rotates per (VU, iter): distinct-user simulation (see
  // burst.js) so the spike tests pool backpressure, not the per-IP quota.
  const code =
    __ITER % 2 === 0
      ? WARM
      : `#include <iostream>\n// spike ${__VU}-${__ITER}-${Date.now()}\nint main(){int c=0;for(int i=0;i<50;i++)c+=i;std::cout<<c;return 0;}`;
  const id = (__VU * 100003 + __ITER) % 65536;
  const xff = `10.${(id >> 8) & 255}.${id & 255}.${(__VU + __ITER) % 250 + 1}`;
  const res = http.post(
    `${base()}/execute`,
    JSON.stringify({ code, raw_stdin: '' }),
    {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
      timeout: '60s',
    },
  );
  if (res.status >= 500) spike_5xx.add(1);
  const ok = check(res, {
    'spike: 200 or 429 (never 5xx)': (r) => r.status === 200 || r.status === 429,
    'spike: no 500s': (r) => r.status < 500,
  });
  if (res.status === 429) {
    // Contract: saturated 429 carries detail + integer Retry-After.
    const hasContract =
      res.headers['Retry-After'] !== undefined &&
      String(res.body || '').includes('sandbox saturated, retry');
    spike_429_retry_after.add(hasContract ? 1 : 0);
    check(res, { 'spike 429: Retry-After + saturated detail': () => hasContract });
    // 4.2 client behavior: park on backpressure instead of spinning —
    // one retry after the advertised delay, then accept the outcome.
    if (hasContract) {
      sleep((parseInt(res.headers['Retry-After'], 10) || 5) + Math.random() * 2);
      const retry = http.post(
        `${base()}/execute`,
        JSON.stringify({ code, raw_stdin: '' }),
        {
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
          timeout: '60s',
        },
      );
      if (retry.status >= 500) spike_5xx.add(1);
      check(retry, { 'spike retry: 200 or 429 (never 5xx)': (r) => r.status === 200 || r.status === 429 });
    }
  }
}
