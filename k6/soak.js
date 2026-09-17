// k6/soak.js — Wave7 5.1 soak harness: steady 50 VUs for 15m.
//
// Goal: detect drift over time — cache growth, /tmp growth, connection
// growth, latency creep. Mix mirrors burst (80% hot-key / 20% wide-key
// replays across the seed.js canonicals, all HITs post-seed — true-MISS
// backpressure is spike.js's job) plus a periodic NDJSON streaming probe
// (compressed=true -> application/x-ndjson + X-CFG).
// 4.2 client behavior (retry on 429 honoring Retry-After) applies here: a
// rare 429 is retried once after the advertised delay instead of failing.
//
// Post-run, verify on the target host (see .github/workflows/k6-prod.yml):
//   - no latency drift: compare p95 of first vs last 5m window
//   - no /tmp growth:  du -sh /tmp/algo-theseus-cache before/after
//   - no conn growth:   ss -s / uvicorn open fds stable
//
// Usage:
//   k6 run k6/soak.js -e BASE_URL=http://localhost:8000
//   k6 run --out json=soak-summary.json k6/soak.js -e BASE_URL=https://<prod>
//
// Thresholds: failed<1%, HIT p50<200ms p95<500ms, global p99<1200ms.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

export const options = {
  // SOAK_DURATION overrides the hold for short drift probes
  // (e.g. -e SOAK_DURATION=2m); the committed default stays 15m.
  // 1m ramp then a steady-50 hold (a single 15m ramp stage would only
  // reach 50 VUs at the very end — not a soak).
  stages: [
    { duration: '1m', target: 50 },
    { duration: __ENV.SOAK_DURATION || '14m', target: 50 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1200'],
    hit_duration: ['p(50)<200', 'p(95)<500'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
const BASES = (__ENV.BASE_URLS || BASE).split(',').map((s) => s.trim());
function base() {
  return BASES[__VU % BASES.length];
}
const hit_duration = new Trend('hit_duration');

const WARM = [
  '#include <iostream>\nint main(){std::cout<<"hi";return 0;}',
  '#include <iostream>\nint main(){long s=0;for(int i=0;i<100;i++)s+=i;std::cout<<s;return 0;}',
  '#include <iostream>\nint main(){long f=1;for(int i=2;i<=8;i++)f*=i;std::cout<<f;return 0;}',
];

// Wide-key pool: further seed.js canonicals (keep in sync with seed.js
// PROGRAMS). Post-seed these are HITs — the 20% class widens the working
// set without touching the sandbox pool.
const WIDE = [
  '#include <iostream>\nint fib(int n){return n<=1?n:fib(n-1)+fib(n-2);}\nint main(){std::cout<<fib(10);return 0;}',
  '#include <iostream>\nint main(){int a[]={4,2,9,1,7};int mx=a[0];for(int x:a)if(x>mx)mx=x;std::cout<<mx;return 0;}',
  '#include <iostream>\nint main(){int a=48,b=18;while(b){int t=a%b;a=b;b=t;}std::cout<<a;return 0;}',
  '#include <iostream>\nint main(){int n=29;bool p=true;for(int i=2;i*i<=n;i++)if(n%i==0)p=false;std::cout<<p;return 0;}',
  '#include <iostream>\nint main(){long p=1;for(int i=0;i<10;i++)p*=2;std::cout<<p;return 0;}',
  '#include <iostream>\nint main(){int c=0;for(int i=0;i<10;i++)for(int j=0;j<10;j++)c++;std::cout<<c;return 0;}',
  '#include <iostream>\nint main(){int a=0,b=1;for(int i=0;i<10;i++){int t=a+b;a=b;b=t;}std::cout<<a;return 0;}',
  '#include <iostream>\nint s(int n){return n<=0?0:n+s(n-1);}\nint main(){std::cout<<s(20);return 0;}',
];

function postJson(code) {
  // Distinct-user simulation (see burst.js): per-(VU, iter) XFF so the soak
  // tests drift, not the per-IP quota.
  const id = (__VU * 100003 + __ITER) % 65536;
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': `10.${(id >> 8) & 255}.${id & 255}.${(__VU + __ITER) % 250 + 1}`,
  };
  let res = http.post(
    `${base()}/execute`,
    JSON.stringify({ code, raw_stdin: '' }),
    { headers, timeout: '60s' },
  );
  // 4.2 client behavior: honor Retry-After once, then accept the outcome.
  if (res.status === 429) {
    const wait = parseInt(res.headers['Retry-After'] || '5', 10) || 5;
    sleep(wait);
    res = http.post(
      `${base()}/execute`,
      JSON.stringify({ code, raw_stdin: '' }),
      { headers, timeout: '60s' },
    );
  }
  return res;
}

export default function () {
  // Every 20th iteration: NDJSON streaming probe (compressed=true).
  if (__ITER % 20 === 19) {
    const res = http.post(
      `${base()}/execute`,
      JSON.stringify({ code: WARM[0], raw_stdin: '', compressed: true }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '60s' },
    );
    check(res, {
      'soak ndjson: 200': (r) => r.status === 200,
      'soak ndjson: content-type': (r) =>
        (r.headers['Content-Type'] || '').includes('application/x-ndjson'),
      'soak ndjson: X-CFG': (r) => r.headers['X-Cfg'] === 'true' || r.headers['X-CFG'] === 'true',
    });
    sleep(1);
    return;
  }
  if (__ITER % 10 < 8) {
    const res = postJson(WARM[__ITER % WARM.length]);
    if (res.status === 200 && res.headers['X-Cache'] === 'HIT') {
      hit_duration.add(res.timings.duration);
    }
    check(res, {
      'soak hit: 200': (r) => r.status === 200,
      'soak hit: X-Cache HIT': (r) => r.headers['X-Cache'] === 'HIT',
    });
  } else {
    const res = postJson(WIDE[__ITER % WIDE.length]);
    if (res.status === 200 && res.headers['X-Cache'] === 'HIT') {
      hit_duration.add(res.timings.duration);
    }
    check(res, {
      'soak wide: 200': (r) => r.status === 200,
      'soak wide: X-Cache HIT': (r) => r.headers['X-Cache'] === 'HIT',
    });
  }
  sleep(0.5);
}
