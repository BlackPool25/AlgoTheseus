/**
 * utils/executionEngine.ts — Task 19: execution-engine selection.
 *
 * D1 DECISION (docs/deploy-decision.md): kill-criteria FIRED — every
 * browser-WASM candidate fails at COMPILE time on the instrumented fixture
 * (tracer.h needs mkstemp/dup/dup2, absent from WASI libc). Server-container
 * is PRIMARY. Per the task brief this module therefore implements the
 * fallback-flag + server-path hardening instead of a live WASM compile:
 *
 *   - `selectEngine()` always resolves to the server engine while WASM is
 *     killed; `!crossOriginIsolated` (SAB disabled) is recorded on the
 *     selection and the UI pins data-engine/data-fallback flags for it.
 *   - `loadWasmToolchain()` is the lazy-load seam: a dynamic import (never
 *     in the main bundle) of the toolchain chunk. The chunk currently
 *     rejects with a typed, retryable error so a future caller gets a panel
 *     with retry instead of a hang. A WASM retry is gated on a WASI-tracer
 *     redesign re-opening D1 — not on more toolchain shopping.
 *   - Cached toolchain entries are version-pinned: any cached version is
 *     stale by definition while no toolchain is shipped, so selection notes
 *     the refetch instead of trusting the cache.
 */

export const TOOLCHAIN_CACHE_KEY = "algo-theseus-toolchain";

/** No toolchain is shipped while browser-WASM is killed (D1). */
export const TOOLCHAIN_VERSION = "none";

export type EngineKind = "server" | "browser-wasm";

export interface EngineSelection {
  engine: EngineKind;
  /** Engine traffic actually routes to (always "server" while WASM killed). */
  fallback: EngineKind;
  crossOriginIsolated: boolean;
  /** Cache verdict for the pinned toolchain version. */
  toolchainNote: string;
}

/** Typed, retryable toolchain failure — renders as an error panel, never a hang. */
export class WasmToolchainError extends Error {
  readonly code = "WASM_TOOLCHAIN_UNAVAILABLE";
  readonly retryable = true;
  constructor(detail: string) {
    super(`WASM toolchain unavailable: ${detail}`);
    this.name = "WasmToolchainError";
  }
}

/** Read the cached toolchain version from browser storage (null = absent/unparseable). */
export function readCachedToolchainVersion(): string | null {
  try {
    const raw = window.localStorage.getItem(TOOLCHAIN_CACHE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const v = (parsed as { version: unknown }).version;
      return typeof v === "string" ? v : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function selectEngine(): EngineSelection {
  const isolated = window.crossOriginIsolated;
  const cached = readCachedToolchainVersion();
  // While WASM is killed there is no downloadable toolchain: any cached
  // entry is stale by definition → version-pinned refetch note, engine
  // stays server. (Future WASM retry: compare cached against the shipped
  // TOOLCHAIN_VERSION and re-fetch on mismatch.)
  const toolchainNote =
    cached === null
      ? `${TOOLCHAIN_VERSION}-pinned`
      : `stale-refetched:pinned (was ${cached})`;
  return {
    // D1 kill — never "browser-wasm" until a WASI-tracer redesign re-opens it.
    engine: "server",
    fallback: "server",
    crossOriginIsolated: isolated,
    toolchainNote,
  };
}

/**
 * Lazy toolchain entry — dynamic import keeps every toolchain byte out of
 * the main bundle; the browser fetches (and caches) the chunk only if a
 * future engine selection ever routes here.
 */
export function loadWasmToolchain(): Promise<never> {
  return import("./wasmToolchain").then((m) => m.loadWasmToolchain());
}
