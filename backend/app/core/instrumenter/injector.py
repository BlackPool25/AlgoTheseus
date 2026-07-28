"""
injector.py — Source rewriter that inserts trace calls into C++ source.

Takes the original source text + injection points from ast_walker and produces
a new .cpp string with all trace calls inserted. Never modifies the original.

Strategy:
  - Build a list of (line_number, position, text) insertions.
  - "before" insertions go on a new line before the target line.
  - "after" insertions go on a new line after the target line.
  - FUNC_ENTER is inserted as the first statement inside the function body
    (on the line after the opening brace).
  - BRANCH is inserted before the if/while line.
  - LOOP_ITER is inserted after the opening brace of the loop body.
  - STATE is inserted after the statement.
  - Loop counter declarations are prepended as static globals.

Gotcha: BRANCH must be inserted before the if statement, not between
if and else — otherwise the else loses its if.

Gotcha: Trailing comma in __TRACE_FUNC_ENTER when params is empty.
We handle this by only adding the comma separator when there are params.
"""

from __future__ import annotations

import logging
import re
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

from .ast_walker import InjectKind, InjectionPoint, WalkResult, walk
from .scope_tracker import FunctionScope, build_scope_map

def _make_vars_args(var_names: list[str]) -> str:
    """Build the variadic argument list for __TRACE_STATE / __TRACE_FUNC_ENTER.

    Example: ["lo", "hi"] → '"lo", lo, "hi", hi'
    Returns empty string (not ", ") when var_names is empty.
    """
    if not var_names:
        return ""
    parts = [f'"{name}", {name}' for name in var_names]
    return ", ".join(parts)


def _trace_enter(point: InjectionPoint) -> str:
    params_args = _make_vars_args(point.param_names)
    sep = ", " if params_args else ""
    return f'__TRACE_FUNC_ENTER({point.line}, "{point.func_name}", {point.depth}{sep}{params_args});'


def _trace_exit(point: InjectionPoint) -> str:
    """Emit __TRACE_FUNC_EXIT with the return expression captured."""
    ret_expr = point.condition_text  # we reuse condition_text to carry the return expr
    if ret_expr and ret_expr != "?":
        return f'__TRACE_FUNC_EXIT({point.line}, "{point.func_name}", {point.depth}, ({ret_expr}));'
    # void return or no expression
    return f'__TRACE_FUNC_EXIT_VOID({point.line}, "{point.func_name}", {point.depth});'


def _trace_state(point: InjectionPoint, scope: FunctionScope | None) -> str:
    # Always include ALL variables in scope — merge point-specific vars with scope
    var_names = list(point.var_names)
    if scope:
        visible = scope.vars_at_line.get(point.line, [])
        for v in visible:
            if v.name not in var_names:
                var_names.append(v.name)
    vars_args = _make_vars_args(var_names)
    sep = ", " if vars_args else ""
    return f'__TRACE_STATE({point.line}, "{point.func_name}", {point.depth}{sep}{vars_args});'


def _trace_branch(point: InjectionPoint) -> str:
    cond = point.condition_text.replace("\\", "\\\\").replace('"', '\\"')
    return (
        f'__TRACE_BRANCH({point.line}, "{point.func_name}", {point.depth}, '
        f'"{cond}", ({point.condition_text}));'
    )


def _trace_loop_iter(point: InjectionPoint) -> str:
    return (
        f'__TRACE_LOOP_ITER({point.line}, "{point.func_name}", {point.depth}, '
        f'{point.counter_var}++);'
    )


def _is_safe_return_expr(expr: str) -> bool:
    """Return True if *expr* is a simple, side-effect-free return expression.

    Safe expressions can be duplicated (one for __TRACE_FUNC_EXIT, one for the
    actual return) without concern.  Matches numeric literals, identifiers, and
    simple member/array-access chains — no parens, ternary, comma, or funccalls.
    """
    if not expr or expr == "?":
        return False
    if any(c in expr for c in "()?:,"):
        return False
    # Numeric literal (optionally signed)
    if expr.lstrip("-").replace(".", "", 1).isdigit():
        return True
    # Simple identifier or member/array-access chain
    return (
        re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*"
            r"(\.[A-Za-z_][A-Za-z0-9_]*)*"
            r"(\[[^\]]+\])*",
            expr,
        )
        is not None
    )


def instrument(source: str, source_path: str | None = None) -> str:
    """Instrument C++ source by inserting trace calls.

    Args:
        source: The original C++ source code as a string.
        source_path: Optional path hint for libclang. If None, written to a temp file.

    Returns:
        Instrumented C++ source as a string, ready to compile.
        The returned source has #include "tracer.h" at the top.
        The caller must ensure tracer.h is in the include path when compiling.
    """
    _tmp = None
    if source_path is None:
        _tmp = tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False)
        _tmp.write(source)
        _tmp.flush()
        source_path = _tmp.name

    try:
        walk_result = walk(source_path)
        scope_map = build_scope_map(source_path)
    finally:
        if _tmp:
            Path(_tmp.name).unlink(missing_ok=True)

    # Debug: write injection point counts per function
    try:
        counts: dict[str, dict[str, int]] = {}
        for p in walk_result.injection_points:
            counts.setdefault(p.func_name, {})
            counts[p.func_name][p.kind.name] = counts[p.func_name].get(p.kind.name, 0) + 1
        lines_debug = [f"{fn}: {counts[fn]}" for fn in sorted(counts.keys())]
        Path("/tmp/dsa_injection_debug.txt").write_text("\n".join(lines_debug), encoding="utf-8")
    except Exception:
        logger.debug("Failed to write injection debug file", exc_info=True)

    lines = source.splitlines(keepends=True)

    # insertions_before[line] = list of text to insert BEFORE that line
    # insertions_after[line]  = list of text to insert AFTER that line
    insertions_before: dict[int, list[str]] = {}
    insertions_after: dict[int, list[str]] = {}

    def add_before(line: int, text: str) -> None:
        insertions_before.setdefault(line, []).append(text)

    def add_after(line: int, text: str) -> None:
        insertions_after.setdefault(line, []).append(text)

    single_line_funcs: set[str] = set()
    wrapped_if_lines: set[int] = set()
    ret_temp_seq = 0

    for point in walk_result.injection_points:
        scope = scope_map.get(point.func_name)

        if point.func_name in single_line_funcs:
            continue

        if point.kind == InjectKind.FUNC_ENTER:
            line_text = lines[point.line - 1] if point.line <= len(lines) else ""
            # If the entire function body is on one line, skip instrumentation
            if "{" in line_text and "}" in line_text and line_text.find("{") < line_text.find("}"):
                single_line_funcs.add(point.func_name)
                continue
            add_after(point.line, _trace_enter(point))

        elif point.kind == InjectKind.FUNC_EXIT:
            # Inject __TRACE_FUNC_EXIT before the return statement.
            line_text = lines[point.line - 1] if point.line <= len(lines) else ""
            ret_expr = point.condition_text
            indent = line_text[: len(line_text) - len(line_text.lstrip())]

            def make_ret_temp() -> str:
                nonlocal ret_temp_seq
                name = f"__trace_ret_{ret_temp_seq}"
                ret_temp_seq += 1
                return name

            def trace_exit_with(var_name: str) -> str:
                return f'__TRACE_FUNC_EXIT({point.line}, "{point.func_name}", {point.depth}, ({var_name}));'

            # Only inject when the line starts with 'return' to avoid breaking inline returns.
            if line_text.lstrip().startswith("return"):
                # If the previous non-empty line is an if without braces, skip to avoid changing flow.
                prev_idx = point.line - 2
                while prev_idx >= 0 and not lines[prev_idx].strip():
                    prev_idx -= 1
                prev_line = lines[prev_idx] if prev_idx >= 0 else ""
                if prev_line.strip().startswith("if") and "{" not in prev_line and "else" not in prev_line:
                    if prev_idx not in wrapped_if_lines:
                        add_after(prev_idx + 1, "{")
                        add_after(point.line, "}")
                        wrapped_if_lines.add(prev_idx)
                if ret_expr:
                    # For simple, side-effect-free expressions, skip the temp
                    # variable to avoid "crosses initialization" errors in
                    # switch case bodies (C++ forbids jumping past a var decl).
                    if _is_safe_return_expr(ret_expr):
                        add_before(point.line, _trace_exit(point))
                        lines[point.line - 1] = f"{indent}return {ret_expr};\n"
                    else:
                        ret_var = make_ret_temp()
                        add_before(point.line, f"auto {ret_var} = ({ret_expr});")
                        add_before(point.line, trace_exit_with(ret_var))
                        lines[point.line - 1] = f"{indent}return {ret_var};\n"
                else:
                    add_before(point.line, _trace_exit(point))
            elif "return" in line_text and "if" in line_text and "{" not in line_text and ")" in line_text:
                # Inline if-return on the same line: wrap in braces and inject trace inline.
                before, after = line_text.split("return", 1)
                ret_expr_inline = after.strip().rstrip(";")
                ret_var = make_ret_temp()
                trace = trace_exit_with(ret_var) if ret_expr_inline else _trace_exit(point)
                lines[point.line - 1] = (
                    f"{indent}{before.strip()} {{ auto {ret_var} = ({ret_expr_inline}); {trace} return {ret_var}; }}\n"
                )

        elif point.kind == InjectKind.STATE:
            line_text = lines[point.line - 1] if point.line <= len(lines) else ""
            if "return" in line_text:
                continue
            next_line = lines[point.line].strip() if point.line < len(lines) else ""
            if next_line.startswith("else"):
                continue
            add_after(point.line, _trace_state(point, scope))

        elif point.kind == InjectKind.BRANCH:
            add_before(point.line, _trace_branch(point))

        elif point.kind == InjectKind.LOOP_ITER:
            add_after(point.line, _trace_loop_iter(point))

    # ── Fallback return tracing for functions with no FUNC_EXIT ───────────────
    funcs_with_exit = {p.func_name for p in walk_result.injection_points if p.kind == InjectKind.FUNC_EXIT}
    funcs_with_enter = {p.func_name for p in walk_result.injection_points if p.kind == InjectKind.FUNC_ENTER}

    for fn in funcs_with_enter - funcs_with_exit:
        # Naive scan: find the first return inside function body
        in_func = False
        brace_depth = 0
        for i, line in enumerate(lines):
            if not in_func:
                if fn in line and "(" in line:
                    if "{" in line:
                        in_func = True
                        brace_depth = line.count("{") - line.count("}")
                    else:
                        in_func = True
                        brace_depth = 0
                continue

            brace_depth += line.count("{") - line.count("}")

            if line.strip().startswith("return"):
                expr = line.strip()[len("return"):].strip().rstrip(";")
                ret_var = f"__trace_ret_fallback_{fn}"
                add_before(i + 1, f"auto {ret_var} = ({expr});" if expr else f"auto {ret_var} = 0;")
                add_before(i + 1, f'__TRACE_FUNC_EXIT({i + 1}, "{fn}", 0, ({ret_var}));')
                lines[i] = " " * (len(line) - len(line.lstrip())) + f"return {ret_var};\n"
                break

            if brace_depth <= 0:
                break

    # ── Build output ──────────────────────────────────────────────────────────
    output: list[str] = []

    # 1. tracer.h include
    output.append('#include "tracer.h"\n')

    # 2. Loop counter declarations (static so they survive across calls)
    for fn, counters in walk_result.loop_counters.items():
        for counter in counters:
            output.append(f"static int {counter} = 0;\n")

    # 3. Source lines with injections
    for i, line_text in enumerate(lines):
        line_num = i + 1  # 1-based

        for text in insertions_before.get(line_num, []):
            output.append(text + "\n")

        output.append(line_text)

        for text in insertions_after.get(line_num, []):
            output.append(text + "\n")

    instrumented = "".join(output)

    return instrumented
