# Deploy Decision Record (template, filled by todo 18)

Status: template. The WASM engine spike (todo 18) fills every TODO below
with measured numbers. No production code is written in the spike todo.

## 1. Candidate

| Candidate | Toolchain source | TODO status |
| browsercc | TODO | TODO |
| binji wasm-clang | TODO | TODO |
| runno-clangpp | TODO | TODO |
| llvm-wasi | TODO | TODO |

Per-candidate numbers to record: toolchain download MB, cold compile ms
on the instrumented `simple_bsearch.cpp` fixture, TRACE completeness vs
the Docker-path ground truth (`spikes/wasm-ground-truth/TRACE.jsonl`),
and the file-I/O verdict (ephemeral temp-dir testcase reads: supported
or not).

## 2. Kill-criteria

Kill browser-WASM and set server-container as primary when: no candidate
captures stderr TRACE lines completely on the fixture (byte-equal diff
against ground truth fails for every candidate), or cold compile exceeds
the operator's patience budget with no lazy-caching path. Record the
failing diffs as attachments; a kill is still a PASS for the spike todo
when recorded with reasons.

## 3. Winner

- Winner: TODO (name plus version pin)
- Toolchain download: TODO MB
- Cold compile: TODO ms
- TRACE diff vs ground truth: TODO (`diff` exit code plus log path)
- File-I/O verdict: TODO (supported or not, with evidence)
- Rationale: TODO (one paragraph, numbers first)

## 4. Fallback trigger

- Primary engine: TODO (browser-WASM winner or server-container)
- Fallback engine: TODO (the other one)
- Automatic fallback flag: TODO (how `!crossOriginIsolated` or toolchain
  download failure routes to the server path)
- Server fallback host order: SnapDeploy free primary, Render free
  fallback (`SANDBOX_MODE=subprocess` on both)
- RETHINK trigger: if measured cold-start-to-200 exceeds 60s on the
  chosen host, record a RETHINK verdict with alternatives instead of
  passing (todo 21 measures this; this template only reserves the line).
- RETHINK verdict: TODO
