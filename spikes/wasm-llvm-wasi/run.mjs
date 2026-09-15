// Spike harness: "llvm-wasi" (raw wasi-sdk / upstream LLVM WASI target).
// There is no prebuilt browser toolchain under this name: no npm package,
// no CDN bundle — wasi-sdk ships a NATIVE SDK (host clang + sysroot) for
// cross-compiling TO wasm32-wasi, not a compiler that RUNS IN the browser.
// This harness verifies that live (registry 404) and records the verdict:
// adopting llvm-wasi for in-browser compile means building + hosting our own
// clang.wasm/lld.wasm/sysroot bundle — i.e. re-doing browsercc's build.sh —
// which exceeds a time-boxed spike and duplicates a maintained artifact.
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
const reg = await fetch("https://registry.npmjs.org/llvm-wasi");
const registryStatus = reg.status;
const meta = {
  candidate: "llvm-wasi (wasi-sdk upstream concept, no browser distribution)",
  registryCheck: `GET https://registry.npmjs.org/llvm-wasi -> ${registryStatus}`,
  npmDistribution: null,
  toolchainMB: null,
  compileAttempted: false,
  killReason:
    "No prebuilt in-browser toolchain exists under this name (registry " +
    `${registryStatus}). wasi-sdk is a host-side cross SDK; running the ` +
    "fixture compile in-browser would require building, hosting, versioning " +
    "and caching our own clang.wasm + sysroot — duplicating browsercc with " +
    "no maintainer. Revisit only if browsercc dies upstream.",
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
