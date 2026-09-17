# Contributing

Thanks for your interest! Here's how to get started.

## Development Setup

```bash
# Fork & clone
git clone <your-fork>
cd AlgoTheseus

# Backend
cd backend
uv sync --extra dev

# Frontend
cd ../frontend
bun install

# Sandbox image
docker build -f backend/docker/Dockerfile.sandbox -t algo-theseus-sandbox:latest backend/docker/
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

## Commit Convention

We use Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`.

```text
feat: add heap-sort step descriptions
fix: guard stdin parser against empty input
docs(community): upgrade Contributing (convention+triage+links)
```

Sync your fork before opening a PR:

```bash
git remote add upstream https://github.com/BlackPool25/AlgoTheseus.git
git fetch upstream && git rebase upstream/main
```

## Docs Convention

Keep docs lint-clean so CI stays green:

- ATX headings only (`#`, never Setext or closed `# heading #`).
- Fenced code blocks always declare a language (` ```bash `, ` ```text `).
- At most one trailing punctuation mark in headings (MD026).
- Tables use leading and trailing pipes on every row (table-pipe-style).
- Rules enforced in CI: MD023, MD026, MD031, MD032, MD035, MD060.
- Wrap prose at 120 columns.
- Local lint gate is Optional: run a markdown linter if you have one installed.
  CI-strict still applies on push, so fix what CI flags.

## Triage Ritual

- Maintainers apply labels within 72h (`bug`, `enhancement`, `good-first-issue`).
- Starter queue is issue#1-3; everything else waits in backlog until claimed.
- Fixes land within a two-release window or the issue is re-triaged.
- First-greens for new contributors: touch only CONTRIBUTING, docs, or tests.

| Label | Meaning | Template to use |
| ----- | ------- | --------------- |
| `bug` | Something broken, with repro steps | Bug report |
| `enhancement` | New feature or improvement | Feature request |
| `good-first-issue` | Small, well-scoped starter task | Either, link the issue |

Small platform notes: prefer WSL2 on Windows, Xcode CLT on macOS for the C++
toolchain, and rebuild the sandbox image after touching `backend/docker/`.
Add a CHANGELOG entry under `## [Unreleased]` with every user-facing change.

## Related Files

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)
- [Citation](CITATION.cff)
- [License](LICENSE)
- [Contributing section in README](README.md#contributing)
