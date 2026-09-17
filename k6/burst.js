// k6/burst.js — Wave7 5.1 burst harness: 0 -> 200 VUs (10s ramp, 1m hold).
//
// Mix (HIT 80/20): 80% hot-key replays + 20% wide-key replays across the 20
// seed.js canonicals (run seed.js FIRST against the same BASE_URLS). Both
// classes are cache-HITs post-seed by design: 200 VUs of TRUE-unique MISS
// traffic would need ~500 sandbox pool slots (200 VUs x 20% x ~1.3s
// instrument+compile hold vs 60 fleet-wide), so true-MISS backpressure is
// spike.js's job, not burst's. Burst proves cache throughput: 200 concurrent
// users replaying a hot/warm working set with zero pool touch and zero 429s.
//
// Usage:
//   k6 run k6/burst.js -e BASE_URL=http://localhost:8000
//   k6 run --out json=burst-summary.json k6/burst.js -e BASE_URL=https://<prod>
//   Local fleet sim: -e BASE_URLS=http://127.0.0.1:8021,...,http://127.0.0.1:8030
//
// Thresholds: failed<1% (a 429 here is a failure — burst must NOT 429),
// HIT p50<200ms p95<500ms, global p99<1200ms.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '10s', target: 200 }, // ramp 0 -> 200
    { duration: '1m', target: 200 }, // hold
    { duration: '10s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1200'],
    hit_duration: ['p(50)<200', 'p(95)<500'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
// BASE_URLS (comma-separated) spreads VUs across fleet instances behind a
// round-robin, e.g. 10 local uvicorns standing in for the maxScale-10 fleet.
const BASES = (__ENV.BASE_URLS || BASE).split(',').map((s) => s.trim());
function base() {
  return BASES[__VU % BASES.length];
}
const hit_duration = new Trend('hit_duration');

// Subset of seed.js canonicals (must be seeded first for HIT).
const WARM = [
  '#include <iostream>\nint main(){std::cout<<"hi";return 0;}',
  '#include <iostream>\nint main(){long s=0;for(int i=0;i<100;i++)s+=i;std::cout<<s;return 0;}',
  '#include <iostream>\nint fib(int n){return n<=1?n:fib(n-1)+fib(n-2);}\nint main(){std::cout<<fib(10);return 0;}',
  '#include <iostream>\nint main(){long f=1;for(int i=2;i<=8;i++)f*=i;std::cout<<f;return 0;}',
];

// Wide-key pool: the remaining seed.js canonicals (keep in sync with seed.js
// PROGRAMS). Post-seed these are HITs too — the 20% class widens the working
// set without touching the sandbox pool.
const WIDE = [
  '#include <iostream>\n#include <vector>\nint main(){std::vector<int>v={1,3,5,7,9};int lo=0,hi=4;while(lo<=hi){int m=(lo+hi)/2;if(v[m]==7){std::cout<<m;return 0;}else if(v[m]<7)lo=m+1;else hi=m-1;}std::cout<<-1;return 0;}',
  '#include <iostream>\nint main(){int a[]={4,2,9,1,7};int mx=a[0];for(int x:a)if(x>mx)mx=x;std::cout<<mx;return 0;}',
  '#include <iostream>\nint main(){int a[]={5,3,4,1,2};for(int i=0;i<5;i++)for(int j=0;j<4-i;j++)if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}std::cout<<a[0];return 0;}',
  '#include <iostream>\nint main(){int a=48,b=18;while(b){int t=a%b;a=b;b=t;}std::cout<<a;return 0;}',
  '#include <iostream>\nint main(){int n=29;bool p=true;for(int i=2;i*i<=n;i++)if(n%i==0)p=false;std::cout<<p;return 0;}',
  '#include <iostream>\n#include <string>\nint main(){std::string s="racecar";bool ok=true;for(size_t i=0;i<s.size()/2;i++)if(s[i]!=s[s.size()-1-i])ok=false;std::cout<<ok;return 0;}',
  '#include <iostream>\nint main(){int a[2][2]={{1,2},{3,4}},b[2][2]={{5,6},{7,8}},s=0;for(int i=0;i<2;i++)for(int j=0;j<2;j++)s+=a[i][j]+b[i][j];std::cout<<s;return 0;}',
  '#include <iostream>\nint main(){int a[]={1,2,3,4,5};for(int i=0;i<2;i++){int t=a[i];a[i]=a[4-i];a[4-i]=t;}std::cout<<a[0];return 0;}',
  '#include <iostream>\n#include <string>\nint main(){std::string s="hello world";int c=0;for(char ch:s)if(std::string("aeiou").find(ch)!=std::string::npos)c++;std::cout<<c;return 0;}',
  '#include <iostream>\nint main(){long p=1;for(int i=0;i<10;i++)p*=2;std::cout<<p;return 0;}',
  '#include <iostream>\nint main(){int c=0;for(int i=0;i<10;i++)for(int j=0;j<10;j++)c++;std::cout<<c;return 0;}',
  '#include <iostream>\nint main(){int n=100,s=0;while(n>0){s+=n%10;n/=10;}std::cout<<s;return 0;}',
  '#include <iostream>\nint main(){int d=3;switch(d){case 1:std::cout<<"one";break;case 3:std::cout<<"three";break;default:std::cout<<"other";}return 0;}',
  '#include <iostream>\nstruct P{int x,y;};\nint main(){P p={3,4};std::cout<<p.x*p.x+p.y*p.y;return 0;}',
  '#include <iostream>\nint s(int n){return n<=0?0:n+s(n-1);}\nint main(){std::cout<<s(20);return 0;}',
  '#include <iostream>\nint main(){int a=0,b=1;for(int i=0;i<10;i++){int t=a+b;a=b;b=t;}std::cout<<a;return 0;}',
];

function post(code, tag) {
  // Distinct-user simulation (established pattern: backend/tests/test_load.py
  // passes per-client X-Forwarded-For). Each VU rotates through a 65k-IP
  // pool so no single rate-limit key (EXECUTE_LIMIT 30/min/IP) sees more
  // than ~2 reqs over the run — the burst tests the sandbox + cache, not
  // the per-IP quota (covered by unit tests + the 429 contract in spike.js).
  const id = (__VU * 100003 + __ITER) % 65536;
  const xff = `10.${(id >> 8) & 255}.${id & 255}.${(__VU + __ITER) % 250 + 1}`;
  const res = http.post(
    `${base()}/execute`,
    JSON.stringify({ code, raw_stdin: '' }),
    {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
      tags: { kind: tag },
      timeout: '60s',
    },
  );
  if (res.status === 200 && res.headers['X-Cache'] === 'HIT') {
    hit_duration.add(res.timings.duration);
  }
  return res;
}

export default function () {
  // 80/20 HIT/MISS split by iteration.
  if (__ITER % 10 < 8) {
    const res = post(WARM[__ITER % WARM.length], 'hit');
    check(res, {
      'burst hit: 200': (r) => r.status === 200,
      'burst hit: X-Cache HIT': (r) => r.headers['X-Cache'] === 'HIT',
    });
  } else {
    const res = post(WIDE[__ITER % WIDE.length], 'wide');
    check(res, {
      'burst wide: 200': (r) => r.status === 200,
      'burst wide: X-Cache HIT': (r) => r.headers['X-Cache'] === 'HIT',
    });
  }
  sleep(0.1);
}
