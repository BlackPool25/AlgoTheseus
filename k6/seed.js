// k6/seed.js — warm the /tmp + Redis result cache with 20 canonical programs.
//
// Run FIRST: every later harness (burst 80/20 HIT mix, spike, soak) assumes
// these entries are cached, so replays return X-Cache: HIT without touching
// the Wave6 3.2 sandbox pool (pool saturation 429s would otherwise pollute
// the warm-up itself).
//
// Usage:
//   k6 run k6/seed.js -e BASE_URL=http://localhost:8000
//   k6 run --out json=seed-summary.json k6/seed.js -e BASE_URL=https://<prod>
//
// Contract (backend/app/api/routes/execute.py):
//   POST {BASE_URL}/execute {code, raw_stdin} -> 200 + X-Cache: HIT|MISS
//   First POST of a program  -> MISS (sandbox run, stores result)
//   Second POST of same code -> HIT  (served from cache, no pool slot used)

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  iterations: 40, // 20 programs x (1 MISS warm + 1 HIT verify)
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
const BASES = (__ENV.BASE_URLS || BASE).split(',').map((s) => s.trim());
function base() {
  return BASES[__ITER % BASES.length];
}

// 20 canonical programs: small, deterministic, fast to instrument (<10s sandbox).
// raw_stdin kept empty — stdin parsing is not what we are warming.
const PROGRAMS = [
  { name: 'hello', code: '#include <iostream>\nint main(){std::cout<<"hi";return 0;}' },
  { name: 'loop-sum', code: '#include <iostream>\nint main(){long s=0;for(int i=0;i<100;i++)s+=i;std::cout<<s;return 0;}' },
  { name: 'fib-iter', code: '#include <iostream>\nint main(){int a=0,b=1;for(int i=0;i<10;i++){int t=a+b;a=b;b=t;}std::cout<<a;return 0;}' },
  { name: 'fib-rec', code: '#include <iostream>\nint fib(int n){return n<=1?n:fib(n-1)+fib(n-2);}\nint main(){std::cout<<fib(10);return 0;}' },
  { name: 'bsearch', code: '#include <iostream>\n#include <vector>\nint main(){std::vector<int>v={1,3,5,7,9};int lo=0,hi=4;while(lo<=hi){int m=(lo+hi)/2;if(v[m]==7){std::cout<<m;return 0;}else if(v[m]<7)lo=m+1;else hi=m-1;}std::cout<<-1;return 0;}' },
  { name: 'linear-scan', code: '#include <iostream>\nint main(){int a[]={4,2,9,1,7};int mx=a[0];for(int x:a)if(x>mx)mx=x;std::cout<<mx;return 0;}' },
  { name: 'bubble-sort', code: '#include <iostream>\nint main(){int a[]={5,3,4,1,2};for(int i=0;i<5;i++)for(int j=0;j<4-i;j++)if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}std::cout<<a[0];return 0;}' },
  { name: 'factorial', code: '#include <iostream>\nint main(){long f=1;for(int i=2;i<=8;i++)f*=i;std::cout<<f;return 0;}' },
  { name: 'gcd', code: '#include <iostream>\nint main(){int a=48,b=18;while(b){int t=a%b;a=b;b=t;}std::cout<<a;return 0;}' },
  { name: 'prime-check', code: '#include <iostream>\nint main(){int n=29;bool p=true;for(int i=2;i*i<=n;i++)if(n%i==0)p=false;std::cout<<p;return 0;}' },
  { name: 'palindrome', code: '#include <iostream>\n#include <string>\nint main(){std::string s="racecar";bool ok=true;for(size_t i=0;i<s.size()/2;i++)if(s[i]!=s[s.size()-1-i])ok=false;std::cout<<ok;return 0;}' },
  { name: 'matrix-add', code: '#include <iostream>\nint main(){int a[2][2]={{1,2},{3,4}},b[2][2]={{5,6},{7,8}},s=0;for(int i=0;i<2;i++)for(int j=0;j<2;j++)s+=a[i][j]+b[i][j];std::cout<<s;return 0;}' },
  { name: 'reverse-arr', code: '#include <iostream>\nint main(){int a[]={1,2,3,4,5};for(int i=0;i<2;i++){int t=a[i];a[i]=a[4-i];a[4-i]=t;}std::cout<<a[0];return 0;}' },
  { name: 'count-vowels', code: '#include <iostream>\n#include <string>\nint main(){std::string s="hello world";int c=0;for(char ch:s)if(std::string("aeiou").find(ch)!=std::string::npos)c++;std::cout<<c;return 0;}' },
  { name: 'power', code: '#include <iostream>\nint main(){long p=1;for(int i=0;i<10;i++)p*=2;std::cout<<p;return 0;}' },
  { name: 'nested-loops', code: '#include <iostream>\nint main(){int c=0;for(int i=0;i<10;i++)for(int j=0;j<10;j++)c++;std::cout<<c;return 0;}' },
  { name: 'while-acc', code: '#include <iostream>\nint main(){int n=100,s=0;while(n>0){s+=n%10;n/=10;}std::cout<<s;return 0;}' },
  { name: 'switch-case', code: '#include <iostream>\nint main(){int d=3;switch(d){case 1:std::cout<<"one";break;case 3:std::cout<<"three";break;default:std::cout<<"other";}return 0;}' },
  { name: 'struct-use', code: '#include <iostream>\nstruct P{int x,y;};\nint main(){P p={3,4};std::cout<<p.x*p.x+p.y*p.y;return 0;}' },
  { name: 'recursion-sum', code: '#include <iostream>\nint s(int n){return n<=0?0:n+s(n-1);}\nint main(){std::cout<<s(20);return 0;}' },
];

function post(code) {
  return http.post(
    `${base()}/execute`,
    JSON.stringify({ code, raw_stdin: '' }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '60s' },
  );
}

export default function () {
  // 40 iterations map to 20 programs x 2 passes: pass 0 warms (MISS ok),
  // pass 1 verifies (must be HIT — proves the cache stored it).
  const pass = Math.floor(__ITER / PROGRAMS.length); // 0 or 1
  const prog = PROGRAMS[__ITER % PROGRAMS.length];
  const res = post(prog.code);
  if (pass === 0) {
    check(res, {
      [`seed warm ${prog.name}: 200`]: (r) => r.status === 200,
      [`seed warm ${prog.name}: has X-Cache`]: (r) => !!r.headers['X-Cache'],
    });
  } else {
    check(res, {
      [`seed verify ${prog.name}: 200`]: (r) => r.status === 200,
      [`seed verify ${prog.name}: X-Cache HIT`]: (r) => r.headers['X-Cache'] === 'HIT',
    });
  }
  sleep(2); // stay under EXECUTE_LIMIT 30/min/IP (single VU, single key)
}
