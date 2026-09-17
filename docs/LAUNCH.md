# Launch checklist

> Self-hosting consolidated in [SELF-HOSTING.md](SELF-HOSTING.md); this file keeps the launch checklist.

## 1. Domain swap (before first prod build)
Real domain replaces `https://www.example.com` in: `frontend/index.html`
(%VITE_SITE_URL%), `frontend/public/_redirects`, `frontend/public/_headers`
(CSP connect-src), `frontend/public/sitemap.xml`, `frontend/public/robots.txt`,
`frontend/.env.production.example`. Then set Pages env vars:
`VITE_SITE_URL=https://<real-domain>`, `VITE_API_URL=https://<api>`.
Production builds MUST set `VITE_SITE_URL` — otherwise the literal
`%VITE_SITE_URL%` token ships. Fail-closed check: `grep -r "%VITE_" dist/`
must print nothing. Backend CORS must allow the Pages domain (`backend/app/main.py`).

## 2. Legal review
`frontend/src/routes/{Privacy,Terms,Contact}.tsx` are baselines (see HTML
comment in LegalLayout). A human must review before launch — especially the
sandbox acceptable-use clause (malware / crypto-mining / abuse ban).

## 3. CSP enforcement
`public/_headers` ships CSP in **Report-Only**. After 1-2 weeks of clean
reports, flip to enforcing. Monaco needs `blob:`, `wasm-unsafe-eval`, and the
API origin in `connect-src`.

## 4. Day one
Grep dist for `%VITE_`; `curl -sI <domain>` shows no `noindex`; submit sitemap
to Google Search Console + Bing, request indexing on `/`; card-validator check
on link previews; PageSpeed Insights mobile pass (LCP ≤ 2.5s, INP ≤ 200ms,
CLS ≤ 0.1); footer/legal link check; Plausible snippet if analytics wanted
(cookieless — no banner needed).

## 5. Ongoing
Uptime monitor, GSC coverage alerts, honest sitemap `lastmod`, branded PNG/ICO
favicons when brand assets exist (SVG set ships now).
