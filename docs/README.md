# docs/ — index

Every `docs/*.md` file appears below (no orphans). New canonical guides first,
then retained incumbents with their keep-reason. Nothing here was deleted by
todos 3–4/24 — incumbents are pointed at, never forked.

| Doc | Audience | One line + keep-reason |
|---|---|---|
| [README.md](README.md) | everyone | this index — guarantees no orphan doc |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | contributors, self-hosters | symptom→cause→fix + smoke health-check (new, todo 25) |
| [API.md](API.md) | frontend + integrators | standalone endpoint reference incl. async `/jobs` (new, todo 23) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | contributors | mermaid source of truth: flowchart + sequence (new, todo 22) |
| [SELF-HOSTING.md](SELF-HOSTING.md) | self-hosters | canonical deploy guide unifying the fragments below (new, todo 24) |
| [DEPLOY.md](DEPLOY.md) | self-hosters | free-tier detail (Pages/Netlify/SnapDeploy/Render) — kept per todo-4, pointer to SELF-HOSTING |
| [CLOUDRUN.md](CLOUDRUN.md) | self-hosters | Cloud Run production detail — kept per todo-4, pointer to SELF-HOSTING |
| [LAUNCH.md](LAUNCH.md) | maintainers | launch checklist (domain, legal, CSP, day-one) — kept, not deploy steps |
| [README-FORMAT.md](README-FORMAT.md) | contributors | fonts/formats/diagram policy + drawio export recipe (todo 21 format spec) |
| [theme-tokens.md](theme-tokens.md) | frontend | frozen 8-palette theming contract — kept, referenced by frontend README |
| [trace-schema-v2.md](trace-schema-v2.md) | backend + frontend | additive-only trace event schema — kept, parser/models agree on it |
| [serializer-design.md](serializer-design.md) | backend | `tracer.h` overload design — kept, explains runtime serialization |
| [render-spec.md](render-spec.md) | frontend | vendored render research — kept per todos 15/25/26 citation |
| [deploy-decision.md](deploy-decision.md) | maintainers | D1 kill-criteria record (WASM dead as primary) — kept, DEPLOY cites it |
| [instrumenter-baseline.md](instrumenter-baseline.md) | backend | robust-parser upgrade lock — kept, instrumenter baseline |
| [python-tutor-gap-analysis.md](python-tutor-gap-analysis.md) | contributors | gap analysis vs Python Tutor — kept, design context |
| [implementation-plan.md](implementation-plan.md) | contributors | DSA-visualiser upgrade plan — kept, historical context |
| [KEYWORD-MAP.md](KEYWORD-MAP.md) | contributors | repo keyword map — kept, navigation aid |
| [t13-skip.md](t13-skip.md) | backend | T13 expression-temp SKIP decision — kept, decision record |

Also in this tree (not `*.md`, listed so nothing is missed): `assets/README.md`
(single-SVG rule + no-custom-diagram-needed, todo 26), `assets/screenshots/`
(Playwright captures only), `assets/social-preview.png`.
