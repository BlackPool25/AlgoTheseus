/**
 * utils/api.ts — Typed API client for the DSA Visualiser backend.
 *
 * Endpoints:
 *   POST /execute            — trace + CFG (JSON or NDJSON streaming)
 *   POST /upload-testcases   — test case file upload
 *
 * Streaming:
 *   When ``compressed=true`` is sent the backend responds with
 *   ``Content-Type: application/x-ndjson``.  The ``streamExecute()``
 *   helper parses the newline-delimited JSON stream and dispatches
 *   each chunk to the appropriate callback.  An ``AbortController``
 *   is returned so the caller can cancel the in-flight request.
 */

import type { CFGEdge, CFGNode } from "../types/cfg";
import type { TraceEvent } from "../types/trace";

// Empty string = same origin, routed through Vite proxy to the backend.
// Set VITE_API_URL to override (e.g. in production).
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

export interface ExecuteRequest {
  code: string;
  raw_stdin: string;
}

export interface ExecuteResponse {
  stdout: string;
  compile_error: string | null;
  runtime_error: string | null;
  timed_out: boolean;
  truncated: boolean;
  trace: TraceEvent[];
  cfg_nodes: CFGNode[];
  cfg_edges: CFGEdge[];
  total_steps: number;
}

export interface UploadedFile {
  name: string;
  size: number;
  preview: string;
}

export interface UploadTestcasesResponse {
  test_id: string;
  files: UploadedFile[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postFormData<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface ExecuteBatchRequest {
  code: string;
  test_ids: string[];
}

export interface ExecuteBatchResponseItem {
  test_id: string;
  stdout: string;
  compile_error: string | null;
  runtime_error: string | null;
  timed_out: boolean;
  truncated: boolean;
  trace: TraceEvent[];
  cfg_nodes: CFGNode[];
  cfg_edges: CFGEdge[];
  total_steps: number;
}

// ── NDJSON streaming types ─────────────────────────────────────────────────

/** A parsed chunk from the NDJSON stream. */
export type StreamChunk =
  | { type: "event"; data: TraceEvent }
  | { type: "cfg"; stdout: string; runtime_error: string | null; timed_out: boolean; truncated: boolean; cfg_nodes: CFGNode[]; cfg_edges: CFGEdge[]; total_steps: number }
  | { type: "error"; compile_error?: string; runtime_error?: string };

/** Callbacks invoked as NDJSON lines arrive from the streaming /execute endpoint. */
export interface StreamCallbacks {
  onEvent: (event: TraceEvent) => void;
  onCFG: (data: {
    stdout: string;
    runtime_error: string | null;
    timed_out: boolean;
    truncated: boolean;
    cfg_nodes: CFGNode[];
    cfg_edges: CFGEdge[];
    total_steps: number;
  }) => void;
  onError: (error: { compile_error?: string; runtime_error?: string }) => void;
  onDone?: () => void;
}

/**
 * Execute code with NDJSON streaming.
 *
 * Sends ``compressed: true`` to trigger the streaming path on the backend.
 * Each trace event is dispatched to ``onEvent`` as it arrives.  The final
 * CFG + metadata is dispatched to ``onCFG``.  Errors are dispatched to
 * ``onError``.
 *
 * Returns an ``AbortController`` that can be used to cancel the request.
 */
export function streamExecute(
  req: ExecuteRequest,
  callbacks: StreamCallbacks,
): AbortController {
  const abort = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE_URL}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...req, compressed: true }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        callbacks.onError({ runtime_error: `HTTP ${res.status}: ${text}` });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const chunk: StreamChunk = JSON.parse(trimmed);

            if (chunk.type === "event") {
              callbacks.onEvent(chunk.data as TraceEvent);
            } else if (chunk.type === "cfg") {
              callbacks.onCFG({
                stdout: chunk.stdout,
                runtime_error: chunk.runtime_error,
                timed_out: chunk.timed_out,
                truncated: chunk.truncated,
                cfg_nodes: chunk.cfg_nodes,
                cfg_edges: chunk.cfg_edges,
                total_steps: chunk.total_steps,
              });
            } else if (chunk.type === "error") {
              callbacks.onError(chunk);
            }
          } catch (e) {
            console.error("Failed to parse NDJSON line:", trimmed.slice(0, 120), e);
          }
        }
      }

      callbacks.onDone?.();
    } catch (e) {
      if (!abort.signal.aborted) {
        callbacks.onError({ runtime_error: String(e) });
      }
    }
  })();

  return abort;
}

export const api = {
  execute: (req: ExecuteRequest) =>
    post<ExecuteResponse>("/execute", req),

  executeBatch: (req: ExecuteBatchRequest) =>
    post<ExecuteBatchResponseItem[]>("/execute-batch", req),

  uploadTestcases: (files: File[]) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }
    return postFormData<UploadTestcasesResponse>("/upload-testcases", formData);
  },
};
