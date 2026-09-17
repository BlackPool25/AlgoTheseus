# API Reference

Standalone reference for the AlgoTheseus backend. The `README.md` API section
(lines 324–384) shows the same shapes condensed; this file is the full version.
Every endpoint cites its route file:line — nothing here is asserted from memory.

Base URL: same-origin in local compose, or `VITE_API_URL` for static builds
(`frontend/src/utils/api.ts:30`). All bodies are JSON unless noted.

## `POST /execute`

Submit C++ code for instrumentation, execution, and trace generation.
Route: `backend/app/api/routes/execute.py:808` (mounted at `/execute` in
`backend/app/main.py:93`; rate limit `30/minute` per
`backend/app/core/rate_limit.py:71`).

Request (`backend/app/models/request.py:10`):

```json
{
  "code": "#include <vector>\n...",
  "raw_stdin": "5\n1 2 3 4 5",
  "compressed": false
}
```

`compressed` (`request.py:19`): when true, consecutive STATE events with identical
vars collapse server-side to reduce payload.

Response (`backend/app/models/response.py:13`):

```json
{
  "stdout": "Found at index: 3\n",
  "compile_error": null,
  "runtime_error": null,
  "timed_out": false,
  "truncated": false,
  "warnings": [],
  "trace": [
    {"t":"enter","l":5,"f":"bsearch","d":1,"p":{"arr":[1,3,5,7,9],"target":7}},
    {"t":"state","l":6,"f":"bsearch","d":1,"v":{"lo":0,"hi":4}},
    {"t":"branch","l":9,"f":"bsearch","d":1,"c":"arr[mid]==target","tk":false},
    {"t":"iter","l":7,"f":"bsearch","d":1,"it":0},
    {"t":"exit","l":13,"f":"bsearch","d":1,"r":3}
  ],
  "cfg_nodes": [],
  "cfg_edges": [],
  "total_steps": 16
}
```

> **Streaming mode:** set `"compressed": true` on the HTTP contract used by
> `streamExecute` (`frontend/src/utils/api.ts:140`) to get an NDJSON stream
> (`Content-Type: application/x-ndjson`): one trace event per line (`{"type":
> "event", ...}`), then a final `{"type": "cfg", ...}` line with stdout, CFG, and
> metadata (`api.ts:108-111`). Cancel via the returned `AbortController`.

```bash
curl -s -X POST localhost:8000/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"int main(){return 0;}","raw_stdin":""}'
```

## `POST /execute-batch`

Run the same code against multiple uploaded test cases in parallel.
Route: `backend/app/api/routes/execute.py:949` (mounted at `/execute-batch` in
`backend/app/main.py:94`; rate limit `5/minute` per `rate_limit.py:72`).

Request (`backend/app/models/request.py:25`): `{"code": "...", "test_ids":
["uuid-1", "uuid-2"]}` — each UUID needs `input.txt` under
`/tmp/algo-theseus/testcases/<uuid>/`. Response: a list of
`ExecuteBatchResponseItem` (`backend/app/models/response.py:42`) — same shape as
`ExecuteResponse` plus `test_id`:

```json
[
  {"test_id": "uuid-1", "stdout": "6\n", "passed": true, "...": "..."},
  {"test_id": "uuid-2", "stdout": "10\n", "passed": false, "...": "..."}
]
```

The frontend coalesces identical batch calls fired within 50 ms into one POST
(`batchedExecuteBatch`, `frontend/src/utils/api.ts:292`).

```bash
curl -s -X POST localhost:8000/execute-batch \
  -H 'Content-Type: application/json' \
  -d '{"code":"...","test_ids":["uuid-1","uuid-2"]}'
```

## `POST /upload-testcases`

Upload test case files for batch execution (multipart/form-data).
Route: `backend/app/api/routes/upload.py:93` (mounted at `/upload-testcases` in
`backend/app/main.py:96`).

Limits (`upload.py:26,38`): up to **50 files**, 10 MB each; extensions `.txt`,
`.in`, `.out`, `.ans`. Files land under `/tmp/algo-theseus/testcases/<uuid>/`.
Returns `{test_id, files: [{name, size, preview}]}` (200-char preview;
`upload.py:85`).

```bash
curl -s -X POST localhost:8000/upload-testcases \
  -F 'files=@input1.in' -F 'files=@expected1.out'
```

## `POST /jobs` + `GET /jobs/{id}` (async path)

Prod path for Cloud Run, where sync `POST /execute` can hit LB/proxy timeouts.
Routes: `backend/app/api/routes/jobs.py:21` (submit, returns **202**) and
`jobs.py:35` (poll), mounted at `/jobs` in `backend/app/main.py:95`; rate limit
`30/minute` (`rate_limit.py:73`). Enqueue + record-read only — execution itself
lives in the worker (`jobs.py:1-9`).

`POST /jobs` takes an `ExecuteRequest` body and returns `{job_id, status:
"queued"}` (`JobSubmitResponse`, via `app.core.queue.jobs`). `GET /jobs/{id}`
returns `{job_id, status, result?, error?}` (`JobStatusResponse`); unknown id ⇒
404 (`jobs.py:35-44`). Statuses: `pending` | `running` | `completed` (+
`ExecuteResponse` result) | `failed` (+ error).

Frontend driver (`frontend/src/utils/api.ts:391-468`; contract also in
`frontend/README.md:22-27`): `submitJob` → `pollJob` (1 s interval, 60 s cap) →
`executeViaJobs`, which falls back to sync `POST /execute` when `/jobs` is
unavailable (local compose). `api.execute` defaults to this path (`api.ts:316`).

```bash
JOB=$(curl -s -X POST localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"code":"int main(){return 0;}","raw_stdin":""}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["job_id"])')
curl -s localhost:8000/jobs/$JOB
```

## Error envelope

Every execution response carries `compile_error` and `runtime_error` (string or
null), plus `timed_out` and `truncated` flags (`response.py:13-31`). `truncated`
means the trace hit `MAX_TRACE_LINES` (100 000) — the program may have more steps.
Over-limit callers get **429 + integer `Retry-After`** (`backend/app/core/rate_limit.py:174`);
the frontend honors it with jittered retries (`fetchWith429Retry`, `api.ts:239`).

## Limits

Live values from `backend/app/core/executor/sandbox_config.py:13-32`:

| Limit | Value |
|---|---|
| Memory | 128 MB (`mem_limit: 128m`) |
| CPU | 50% of one core |
| Network | disabled; filesystem read-only except `/tmp` tmpfs (64 MB, exec) |
| Processes | 64 (`pids_limit`); no new privileges, all capabilities dropped |
| Execution timeout | 10 s (`EXECUTION_TIMEOUT_SECONDS`) |
| Trace cap | 100 000 lines (`MAX_TRACE_LINES`, sets `truncated`) |
| Upload | 50 files, 10 MB each (`upload.py:26`) |
| Batch rate | 5/min; execute + jobs 30/min (`rate_limit.py:71-73`) |

## Cross-links

- Event/CFG shapes: [trace-schema-v2.md](trace-schema-v2.md) · serializer overloads: [serializer-design.md](serializer-design.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · self-hosting: [SELF-HOSTING.md](SELF-HOSTING.md)
