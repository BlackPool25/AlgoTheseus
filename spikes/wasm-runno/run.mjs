// Spike harness: @runno/sandbox clangpp — compile instrumented
// simple_bsearch.cpp (+ tracer.h via runFS), run with empty stdin,
// capture TRACE: stderr lines.
// Usage: node run.mjs [--out DIR]
// Writes: TRACE.jsonl, stdout.txt, stderr-other.txt, compile.log, meta.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const outDir = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(here, "out");
mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
const fixture = join(repoRoot, "backend", "tests", "fixtures", "simple_bsearch.cpp");
const venvPy = join(repoRoot, "backend", ".venv", "bin", "python");
const instrumented = execFileSync(
  venvPy,
  [
    "-c",
    "import sys; sys.path.insert(0, 'backend');"
    + "from app.core.instrumenter.injector import instrument;"
    + "print(instrument(open(sys.argv[1]).read(), source_path=sys.argv[1]), end='')",
    fixture,
  ],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 20 },
).toString();
const tracerH = readFileSync(
  join(repoRoot, "backend", "app", "core", "instrumenter", "tracer.h"),
  "utf8",
);
const tInstrumented = Date.now();

const { runFS } = await import("@runno/sandbox");
const now = new Date();
const fs = {
  "/main.cpp": {
    path: "/main.cpp",
    timestamps: { access: now, modification: now, change: now },
    mode: "string",
    content: instrumented,
  },
  "/tracer.h": {
    path: "/tracer.h",
    timestamps: { access: now, modification: now, change: now },
    mode: "string",
    content: tracerH,
  },
};
const tCompileStart = Date.now();
const result = await runFS("clangpp", "/main.cpp", fs, { stdin: "", timeout: 120 });
const tEnd = Date.now();

const meta = {
  candidate: "@runno/sandbox@0.10.2/clangpp(clang-8.0.1)",
  resultType: result.resultType,
  instrumentMs: tInstrumented - t0,
  totalMs: tEnd - tCompileStart,
};
if (result.resultType === "complete") {
  const traceLines = result.stderr
    .split("\n")
    .filter((l) => l.startsWith("TRACE:"))
    .map((l) => l.slice("TRACE:".length));
  const other = result.stderr
    .split("\n")
    .filter((l) => l && !l.startsWith("TRACE:"));
  writeFileSync(join(outDir, "TRACE.jsonl"), traceLines.join("\n") + (traceLines.length ? "\n" : ""));
  writeFileSync(join(outDir, "stdout.txt"), result.stdout);
  writeFileSync(join(outDir, "stderr-other.txt"), other.join("\n") + "\n");
  writeFileSync(join(outDir, "compile.log"), "(runno fuses compile+run; diagnostics land in stderr-other.txt)\n");
  Object.assign(meta, {
    ok: true,
    exitCode: result.exitCode,
    traceLines: traceLines.length,
    stdout: result.stdout,
  });
} else {
  Object.assign(meta, { ok: false, detail: result });
  writeFileSync(join(outDir, "compile.log"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(outDir, "TRACE.jsonl"), "");
}
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify({ ...meta, detail: undefined }));
if (meta.resultType !== "complete") console.log(JSON.stringify(meta.detail).slice(0, 2000));
