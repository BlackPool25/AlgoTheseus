# AlgoTheseus frontend

React 19 + Vite + TypeScript UI for AlgoTheseus: Monaco editor, React Flow
CFG chart, variable state panel, 12 container visuals, trace scrubber.

## Commands (run from `frontend/`)

```bash
bun install --frozen-lockfile   # install (frozen)
bun run dev                     # dev server
bun run build                   # production build to dist/
npx tsc -b --noEmit             # typecheck (must exit 0)
npx eslint .                    # lint (must be zero errors)
npx playwright test             # full suite, 96 tests headless Chromium
```

Backend API base lives in `src/utils/api.ts` (same-origin/proxied by default;
point at a deployed backend URL when the frontend is hosted statically).
Theming uses CSS-variable tokens; the frozen 8-palette contract is
`../docs/theme-tokens.md`.

## Production API (Cloud Run)

Sync `POST /execute` is the local path. In production the frontend uses the
async job path (`POST /jobs` → poll `GET /jobs/{id}`, 1s interval, 60s cap)
via `submitJob` / `pollJob` / `api.executeViaJobs`, which falls back to sync
`POST /execute` when `/jobs` is unavailable.

Point a static build at the API with `VITE_API_URL`:

```bash
cp .env.production.example .env.production  # set VITE_API_URL=https://<api>
bun run build
```
