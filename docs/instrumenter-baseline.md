# Instrumenter Baseline (robust-parser upgrade lock)

Date: 2026-09-16

## Modified files (git diff --stat)
- backend/app/core/instrumenter/ast_walker.py | 38 +++++++++++++---
- backend/app/core/instrumenter/injector.py | 61 +++++++++++++++++++++++---
- backend/app/core/instrumenter/scope_tracker.py | 24 ++++++++++
- 3 files changed, 111 insertions(+), 12 deletions(-)

## Quarantine
- Deleted: a.out (repo root, stray binary, 33880 bytes)
- Kept untracked: backend/tests/test_loop_header_leak_red.py, backend/tests/test_loop_header_leak_red2.py

## RED triage
- Command: uv run --project backend pytest backend/tests/test_loop_header_leak_red.py backend/tests/test_loop_header_leak_red2.py -q
- Result: 4 passed in 16.69s — PASS (keep)

## Full suite baseline
- Command: uv run --project backend pytest -q --ignore=backend/tests/test_api_endpoints.py
- Result: 1 failed, 218 passed, 31 skipped, 31 warnings in 106.89s
- Failing test: backend/tests/test_serializers.py::TestEdgeCases::test_nested_vector_empty_inner
- Failure: AssertionError: Expected [[], [1]], got {'_type': 'graph', 'adj': [[], [1]]}

## Git status at lock
- M backend/app/core/instrumenter/ast_walker.py
- M backend/app/core/instrumenter/injector.py
- M backend/app/core/instrumenter/scope_tracker.py
- ?? backend/tests/test_loop_header_leak_red.py
- ?? backend/tests/test_loop_header_leak_red2.py
