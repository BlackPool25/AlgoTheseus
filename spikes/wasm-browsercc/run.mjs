// Spike harness: browsercc@0.1.1 — compile instrumented simple_bsearch.cpp,
// run under @bjorn3/browser_wasi_shim, capture TRACE: stderr lines.
// Usage: node run.mjs [--out DIR]
// Writes: TRACE.jsonl (stderr TRACE payloads), stdout.txt, meta.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const outDir = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(here, "out");
mkdirSync(outDir, { recursive: true });

// Node fetch() has no file: support on all versions -> patch file URLs only.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.startsWith("file:")) {
    const buf = readFileSync(fileURLToPath(s));
    return Promise.resolve(
      new Response(buf, {
        status: 200,
        headers: { "content-length": String(buf.length) },
      }),
    );
  }
  return realFetch(url, init);
};

const t0 = Date.now();
// (a) instrument via the repo's own pipeline (faithful fixture)
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

// (b) compile with browsercc (cold: fresh process, local toolchain files)
const { compile } = await import("browsercc");
const tCompileStart = Date.now();
const { compileOutput, module } = await compile({
  source: instrumented,
  fileName: "simple_bsearch.cpp",
  flags: ["-std=c++17"],
  extraFiles: { "tracer.h": tracerH },
});
const tCompileEnd = Date.now();
writeFileSync(join(outDir, "compile.log"), compileOutput ?? "(empty)\n");
if (!module) {
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      { candidate: "browsercc", ok: false, compileMs: tCompileEnd - tCompileStart },
      null,
      2,
    ),
  );
  console.log("COMPILE_FAILED ms=" + (tCompileEnd - tCompileStart));
  process.exit(2);
}

// (c) run under the WASI shim: empty stdin, split stdout/stderr capture,
//     preopened /tmp (memfs) so mkstemp() has somewhere to go.
const { WASI, File, OpenFile, Directory, PreopenDirectory, ConsoleStdout } =
  await import("@bjorn3/browser_wasi_shim");
let stdoutBytes = [];
let stderrBytes = [];
const dec = new TextDecoder();
const fds = [
  new OpenFile(new File(new Uint8Array(0))),
  new ConsoleStdout((b) => stdoutBytes.push(Buffer.from(b))),
  new ConsoleStdout((b) => stderrBytes.push(Buffer.from(b))),
  new PreopenDirectory("/tmp", new Map()),
];
const wasi = new WASI([], [], fds);
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
});
const tRunStart = Date.now();
let exitCode = 0;
try {
  wasi.start(instance);
} catch (e) {
  exitCode = typeof e?.code === "number" ? e.code : 99;
  writeFileSync(join(outDir, "wasi-error.txt"), String(e?.stack ?? e));
}
const tRunEnd = Date.now();

// (d) split TRACE: lines from program stderr
const stdoutText = Buffer.concat(stdoutBytes).toString("utf8");
const stderrText = Buffer.concat(stderrBytes).toString("utf8");
const traceLines = stderrText
  .split("\n")
  .filter((l) => l.startsWith("TRACE:"))
  .map((l) => l.slice("TRACE:".length));
const otherStderr = stderrText
  .split("\n")
  .filter((l) => l && !l.startsWith("TRACE:"));
writeFileSync(join(outDir, "TRACE.jsonl"), traceLines.join("\n") + (traceLines.length ? "\n" : ""));
writeFileSync(join(outDir, "stdout.txt"), stdoutText);
writeFileSync(join(outDir, "stderr-other.txt"), otherStderr.join("\n") + "\n");
const meta = {
  candidate: "browsercc@0.1.1",
  ok: true,
  exitCode,
  traceLines: traceLines.length,
  stdout: stdoutText,
  instrumentMs: tInstrumented - t0,
  compileMs: tCompileEnd - tCompileStart,
  runMs: tRunEnd - tRunStart,
  totalMs: Date.now() - t0,
};
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta));
