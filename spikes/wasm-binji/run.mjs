// Spike harness: binji/wasm-clang (CppCon 2019 demo).
// There is no npm distribution and no programmatic compile API — the demo is
// "alpha demoware" (README) driven by bespoke worker.js + memfs + service
// worker in a real browser. This harness performs the evaluation that fits a
// time-boxed spike: (a) verify hosted toolchain assets are reachable and
// measure their bytes, (b) record why a full fixture-compile attempt is
// out of spike scope, (c) emit the kill verdict + empty TRACE.jsonl so the
// ground-truth diff attaches as a failing diff.
// Usage: node run.mjs [--out DIR]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(here, "out");
mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
const assets = {
  clang: "https://binji.github.io/wasm-clang/clang",
  lld: "https://binji.github.io/wasm-clang/lld",
  sysroot: "https://binji.github.io/wasm-clang/sysroot.tar",
};
const sizes = {};
for (const [name, url] of Object.entries(assets)) {
  const res = await fetch(url, { method: "HEAD" });
  sizes[name] = {
    status: res.status,
    bytes: Number(res.headers.get("content-length") ?? -1),
  };
}
const totalBytes = Object.values(sizes).reduce((a, s) => a + s.bytes, 0);
const meta = {
  candidate: "binji/wasm-clang (CppCon 2019 demo, no version tags)",
  repo: "https://github.com/binji/wasm-clang (45 commits, README: 'alpha demoware')",
  npmDistribution: null,
  assetBytes: sizes,
  toolchainMB: +(totalBytes / (1 << 20)).toFixed(1),
  compileAttempted: false,
  killReason:
    "No distributable toolchain (unversioned 2019 LLVM ~9.0 binaries + bespoke " +
    "memfs/service-worker browser harness, no programmatic compile API). " +
    "Integrating its custom worker.js into Node is a project, not a spike step. " +
    "Its WASI sysroot predates browsercc's and cannot supply the POSIX " +
    "fds (dup2/mkstemp) tracer.h needs at compile time either.",
  ok: false,
  traceLines: 0,
  totalMs: Date.now() - t0,
};
writeFileSync(join(outDir, "TRACE.jsonl"), "");
writeFileSync(join(outDir, "stdout.txt"), "");
writeFileSync(
  join(outDir, "stderr-other.txt"),
  "compile not attempted (see killReason in meta.json)\n",
);
writeFileSync(join(outDir, "compile.log"), JSON.stringify(meta, null, 2) + "\n");
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta));
