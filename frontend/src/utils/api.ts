/**
 * utils/api.ts — Typed API client for the AlgoTheseus backend.
 *
 * Endpoints:
 *   POST /execute            — trace + CFG (JSON or NDJSON streaming)
 *   POST /upload-testcases   — test case file upload
 *   POST /jobs               — async submit (prod path, avoids LB timeouts)
 *   GET  /jobs/{id}          — poll async job to completion
 *
 * Streaming:
 *   When ``compressed=true`` is sent the backend responds with
 *   ``Content-Type: application/x-ndjson``.  The ``streamExecute()``
 *   helper parses the newline-delimited JSON stream and dispatches
 *   each chunk to the appropriate callback.  An ``AbortController``
 *   is returned so the caller can cancel the in-flight request.
 *
 * Async jobs (Cloud Run production):
 *   ``submitJob()`` + ``pollJob()`` (or the combined
 *   ``executeViaJobs()`` with sync ``POST /execute`` fallback) is the
 *   prod path.  Local compose keeps using sync ``POST /execute`` /
 *   ``streamExecute()`` directly.
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

      for (;;) {
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

  submitJob: (req: ExecuteRequest) => submitJob(req),
  pollJob: (jobId: string, opts?: PollOptions) => pollJob(jobId, opts),
  /** Prod path: async /jobs with sync /execute fallback. */
  executeViaJobs: (req: ExecuteRequest, opts?: PollOptions) =>
    executeViaJobs(req, opts),
};

// ── Async job polling (Cloud Run prod path) ────────────────────────────────

/** Response from POST /jobs. Accepts both `job_id` and `id` shapes. */
export interface SubmitJobResponse {
  job_id: string;
}

/** Discriminated job state returned by GET /jobs/{id}. */
export type JobStatus =
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; result: ExecuteResponse }
  | { status: "failed"; error: string };

export interface PollOptions {
  /** Per-poll interval in ms. Default 1000. */
  intervalMs?: number;
  /** Overall timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** External abort signal; polling stops and throws on abort. */
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Submit code for async execution. Prod path for Cloud Run, where sync
 * POST /execute can hit LB/proxy timeouts under load.
 */
export async function submitJob(req: ExecuteRequest): Promise<string> {
  const res = await fetch(`${BASE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API /jobs failed (${res.status}): ${text}`);
  }
  const data: SubmitJobResponse & { id?: string } =
    (await res.json()) as SubmitJobResponse & { id?: string };
  const jobId = data.job_id ?? data.id;
  if (!jobId) throw new Error("API /jobs returned no job id");
  return jobId;
}

function parseJobStatus(data: unknown): JobStatus {
  // Tolerate backends that use `state` instead of `status`.
  const record = data as Record<string, unknown>;
  if (typeof record["status"] !== "string" && typeof record["state"] === "string") {
    return { ...record, status: record["state"] } as JobStatus;
  }
  return data as JobStatus;
}

/**
 * Poll GET /jobs/{id} until terminal state. 1s interval, 60s cap.
 * Throws on timeout, failure state, HTTP error, or abort.
 */
export async function pollJob(
  jobId: string,
  opts: PollOptions = {},
): Promise<ExecuteResponse> {
  const intervalMs = opts.intervalMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const res = await fetch(`${BASE_URL}/jobs/${encodeURIComponent(jobId)}`, {
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API /jobs/${jobId} failed (${res.status}): ${text}`);
    }
    const job = parseJobStatus((await res.json()) as JobStatus);

    if (job.status === "completed") return job.result;
    if (job.status === "failed") {
      throw new Error(`Job ${jobId} failed: ${job.error}`);
    }
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
    }
    await sleep(intervalMs, opts.signal);
  }
}

/**
 * Prod execution path: submit async job and poll; fall back to sync
 * POST /execute when /jobs is unavailable (local compose).
 */
export async function executeViaJobs(
  req: ExecuteRequest,
  opts: PollOptions = {},
): Promise<ExecuteResponse> {
  try {
    const jobId = await submitJob(req);
    return await pollJob(jobId, opts);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return post<ExecuteResponse>("/execute", req);
  }
}
