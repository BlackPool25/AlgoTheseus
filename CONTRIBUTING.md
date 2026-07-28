# Contributing

Thanks for your interest! Here's how to get started.

## Development Setup

```bash
# Fork & clone
git clone <your-fork>
cd DSA-Visualiser

# Backend
cd backend
uv sync --extra dev

# Frontend
cd ../frontend
bun install

# Sandbox image
docker build -f backend/docker/Dockerfile.sandbox -t dsa-sandbox:latest backend/docker/
```

## Code Style

- **Python**: Follow Ruff defaults (line length 100). Run `ruff check .` before committing.
- **TypeScript**: Strict mode. No `any` types. Discriminated unions for trace events.
- **Imports**: Group stdlib → third-party → first-party.

## Testing

```bash
# Backend
cd backend && uv run pytest tests/ -v

# Frontend (visual regression)
cd frontend && npx playwright test
```

## Pull Request Checklist

- [ ] Tests pass (`pytest` + `playwright`)
- [ ] No TypeScript `any` types in new code
- [ ] No Python raw `dict` at API boundaries (use Pydantic models)
- [ ] New visual components have loading/error/empty states
- [ ] No LLM/Ollama dependencies added
- [ ] README updated if API or features changed

## Architecture Notes

- The instrumenter is the most critical component — changes to `ast_walker.py` or `tracer.h` must be tested with real C++ programs
- Container visual components are shape-driven (no algorithm awareness)
- All API responses must use Pydantic models (no bare `dict` returns)
- The sandbox uses Docker-in-Docker via socket mount — don't break the shared volume path
