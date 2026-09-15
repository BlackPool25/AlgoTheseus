/**
 * utils/wasmToolchain.ts — Lazy-loaded WASM toolchain chunk.
 *
 * Split out via dynamic import from executionEngine so zero toolchain bytes
 * land in the main bundle. D1 (docs/deploy-decision.md) killed browser-WASM
 * as primary, so this chunk currently rejects with a typed, retryable error.
 * A future WASM retry (gated on a WASI-compatible tracer) implements the
 * real loader here: fetch pinned toolchain → browser-storage cache → WASI
 * shim mapping fd1/fd2 writes into incremental stdout + TRACE events using
 * the same "o"/stdout fields as the backend (todo 10) → feed raw_stdin →
 * surface exit code.
 */

import { WasmToolchainError } from "./executionEngine";

export function loadWasmToolchain(): Promise<never> {
  return Promise.reject(
    new WasmToolchainError(
      "browser-WASM killed per docs/deploy-decision.md (D1); server-container is primary",
    ),
  );
}
