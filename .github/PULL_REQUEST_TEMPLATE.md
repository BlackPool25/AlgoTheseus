## What

<!-- Describe the change. -->

## Why

<!-- Link the issue and explain the motivation. -->

Closes #

## Test plan

```bash
# Backend tests
cd backend && uv run pytest tests/ -v

# Frontend tests (visual regression)
cd frontend && npx playwright test
```

## Checklist

- [ ] Tests pass (`pytest` + `playwright`)
- [ ] No TypeScript `any` types in new code
- [ ] No Python raw `dict` at API boundaries (use Pydantic models)
- [ ] New visual components have loading/error/empty states
- [ ] No LLM/Ollama dependencies added
- [ ] README updated if API or features changed
- [ ] CHANGELOG updated under `## [Unreleased]` if user-facing

## Screenshots

<!-- For visual PRs, attach screenshots under `docs/assets/screenshots/`. -->
