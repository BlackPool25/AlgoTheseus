# Security Policy

## Supported Versions

| Component | Version | Supported |
| --------- | ------- | --------- |
| Backend (`backend/pyproject.toml:3`) | 0.1.0 | Yes |
| Frontend (`frontend/package.json:4`) | 1.0.0 | Yes |
| Sandbox image (`backend/docker/Dockerfile.sandbox:18`, `FROM gcc:16`) | gcc:16 | Yes |

Only the latest release on the default branch (`main`) receives security fixes.
Older tags, if any, are unsupported unless noted in the release notes.

## Reporting a Vulnerability

**DO NOT open a public issue for a suspected vulnerability.**

Report privately to `TODO(owner-email)` with:

- Affected component and version (see table above)
- Steps to reproduce (minimal C++ input plus request shape where relevant)
- Impact you observed or suspect

Response SLA: TODO (owner must confirm a response timeline; no timeline is promised until this line is updated).

We do not offer bounties. Reports are handled privately and credited only with the reporter's consent.

## Scope

This project compiles and runs arbitrary user-supplied C++ in a Docker
sandbox, so the sandbox boundary is the highest-risk surface. The backend
entry points are `POST /execute` and `POST /execute-batch`
(`backend/app/api/routes/execute.py`) plus test-case upload
(`backend/app/api/routes/upload.py`); stdin handling lives in
`backend/app/core/stdin/parser.py` and the sandbox image is defined in
`backend/docker/Dockerfile.sandbox`.

In scope:

- Sandbox escape (container breakout, host file access, network egress from the sandbox)
- stdin-parser denial of service (crafted stdin that hangs or exhausts the executor)
- NDJSON stream abuse (malformed streaming responses that break or hang consumers)

Out of scope:

- Social engineering of maintainers or users

Please include logs without secrets, and do not probe third-party deployments.
