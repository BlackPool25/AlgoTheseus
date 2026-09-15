# Deploy Decision Record (filled by todo 18, 2026-09-15)

Status: decided. KILL-CRITERIA FIRED — browser-WASM killed as primary,
server-container is primary. All four candidate diffs exit 1 (0/17 TRACE
lines each). Evidence: `.omo/evidence/task-18-dsa-visualiser-improvements.log`;
harnesses: `spikes/wasm-<candidate>/run.mjs`; ground truth:
`spikes/wasm-ground-truth/TRACE.jsonl` (17 lines, local g++ 16.2.1 path,
exit 0, stdout `3`).

## 1. Candidate

| Candidate | Toolchain source | Result |
| browsercc 0.1.1 (2025-04-19, MIT) | npm, local bundle 109 MB (clang.wasm 43 + lld.wasm 23 + sysroot.tar 29 + pch 19) | FAIL: fixture does not compile — `tracer.h` needs `mkstemp`/`dup`/`dup2`, all undeclared in the WASI sysroot (verbatim clang log in `spikes/wasm-browsercc/out/compile.log`). Cold compile attempt 1465 ms to first error. |
| runno-clangpp via @runno/sandbox 0.10.2 (clang 8.0.1, 2019-era) | npm bundle 117 MB (clang.wasm + clang-fs.tar.gz + wasm-ld.wasm, local) | FAIL: prepare-step crash on instrumented fixture (`PrepareError`, diagnostics swallowed by API). Control passes: plain fixture compiles+runs, exit 0, stdout `3` — so failure is tracer-specific (same WASI-libc gap class as browsercc, `-Werror` + `-ferror-limit 4` fatal). Total 1485 ms to crash. |
| binji wasm-clang (CppCon 2019 demo, "alpha demoware", 45 commits) | no distribution; hosted assets clang 31.2 + lld 19.5 + sysroot 9.3 ≈ 60 MB decoded (≈18.5 MB HEAD-transfer, gzip) | KILL without compile attempt: unversioned 2019 LLVM (~9.0), bespoke memfs/service-worker harness, no programmatic compile API — integration is a project, not a spike step. Older sysroot than browsercc, same POSIX gap guaranteed. Asset sizes HEAD-measured live. |
| llvm-wasi (wasi-sdk upstream concept) | none — registry `GET /llvm-wasi` → 404 | KILL without compile attempt: no prebuilt in-browser toolchain exists; wasi-sdk is a host-side cross SDK. Adopting it means building/hosting our own clang.wasm + sysroot (duplicating browsercc with no maintainer). |

Per-candidate numbers: toolchain download MB, cold compile ms on the
instrumented `simple_bsearch.cpp` fixture, TRACE completeness vs
the Docker-path ground truth (`spikes/wasm-ground-truth/TRACE.jsonl`),
and the file-I/O verdict (ephemeral temp-dir testcase reads: supported
or not) — all in the table above plus §3.

## 2. Kill-criteria

Kill browser-WASM and set server-container as primary when: no candidate
captures stderr TRACE lines completely on the fixture (byte-equal diff
against ground truth fails for every candidate), or cold compile exceeds
the operator's patience budget with no lazy-caching path. Record the
failing diffs as attachments; a kill is still a PASS for the spike todo
when recorded with reasons.

FIRED 2026-09-15: `diff <(sort spikes/wasm-<c>/out/TRACE.jsonl)
<(sort spikes/wasm-ground-truth/TRACE.jsonl)` exits 1 for all four
candidates (0 lines vs 17). Root cause (empirical, not theoretical): the
`tracer.h` incremental-stdout design (`mkstemp` + `dup2(fd,1)`) is POSIX;
every browser candidate targets `wasi_snapshot_preview1`, whose libc
declares neither — the fixture fails at COMPILE time, before any shim
question arises. A WASM path would need a `__wasi__`-gated tracer
redesign (streambuf redirect instead of fd redirect) — that is production
instrumenter work, explicitly out of this spike.

## 3. Winner

- Winner: NONE — kill-criteria fired, server-container is primary (todo 20 builds it).
- Toolchain download: n/a (measured sizes: browsercc 109 MB local / ~95 MB CDN-decoded; runno 117 MB local; binji ≈60 MB decoded; llvm-wasi nonexistent).
- Cold compile: browsercc 1465 ms to first error; runno 1485 ms to prepare-crash; binji/llvm-wasi not attempted (recorded kill reasons above).
- TRACE diff vs ground truth: exit 1 all four (0/17 lines); logs: `spikes/wasm-<candidate>/out/` (untracked — toolchain blobs excluded) + evidence log.
- File-I/O verdict: NOT SUPPORTED end-to-end. No candidate executed the fixture, so `/tmp` testcase reads were never exercised. Partial credit only: `@bjorn3/browser_wasi_shim` offers `PreopenDirectory` (a `/tmp` memfs preopen is possible in principle), but server-side testcase files cannot reach a browser sandbox without a virtual-FS injection layer that does not exist — todo 19's WASM path depends on BOTH a WASI tracer redesign AND that layer. Neither exists.
- Rationale: numbers first — 0/17 TRACE lines on every candidate, with the two runnable candidates failing in ~1.5 s at compile time on the same POSIX-gap class (`mkstemp`/`dup`/`dup2` absent from WASI libc), and the other two killed on distribution grounds (2019 demoware / nonexistent). The honest primary is the server container (todo 20); a browser-WASM retry is gated on a WASI-compatible tracer, not on more toolchain shopping.

## 4. Fallback trigger

- Primary engine: server-container (`SANDBOX_MODE=subprocess`, todo 20).
- Fallback engine: none active — browser-WASM is KILLED, not fallback; do not route traffic to it.
- Automatic fallback flag: n/a while WASM is killed (todo 19 is unblocked only after a WASI-tracer redesign re-opens this decision; `!crossOriginIsolated` routing stays reserved for that future).
- Server fallback host order: SnapDeploy free primary, Render free
  fallback (`SANDBOX_MODE=subprocess` on both)
- RETHINK trigger: if measured cold-start-to-200 exceeds 60s on the
  chosen host, record a RETHINK verdict with alternatives instead of
  passing (todo 21 measures this; this template only reserves the line).
- RETHINK verdict: TODO (todo 21)

## 5. Trace-schema-v2 ("o"/stdout) implications for a future WASM retry (todo 19)

- Even if the fixture compiled, `dup2`-based stdout capture cannot work under
  `wasi_snapshot_preview1` (no fd-duplication call exists in the API; the
  shim implements preview1 only — verified symbol list in evidence). All
  `"o"` deltas would be `""` except a redesign: the WASM tracer must fill
  `"o"` identically (delta bytes as JSON string) via a streambuf-level
  redirect, never fd 1 surgery. Parser side needs no change (engine-agnostic
  by design, todo 10).
- Ground truth pins the bar: 16/17 events carry `"o":""`, one carries
  `"o":"3\n"` — a future WASM run must reproduce that byte-equal, including
  the nonzero delta on the post-`cout` STATE.
