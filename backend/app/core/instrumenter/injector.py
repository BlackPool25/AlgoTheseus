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

logger = logging.getLogger(__name__)

from .ast_walker import InjectionPoint, InjectKind, walk
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


def _trace_state(
    point: InjectionPoint,
    scope: FunctionScope | None,
    global_vars: list[str] | None = None,
) -> str:
    # Post-declaration snapshot: a STATE after `int x = 5;` sees x.
    var_names = list(point.var_names)
    if scope:
        visible = scope.vars_at_line_post.get(point.line, [])
        for v in visible:
            if v.name not in var_names:
                var_names.append(v.name)
    vars_args = _make_vars_args(var_names)
    # Globals shadowed by a same-named local read as the local — drop them
    # from the globals pack so `g` never mislabels a local value.
    g_names = [g for g in (global_vars or []) if g not in var_names]
    if not g_names:
        sep = ", " if vars_args else ""
        return f'__TRACE_STATE({point.line}, "{point.func_name}", {point.depth}{sep}{vars_args});'
    # Commas inside __vars_build(...) are paren-protected, so _G takes 5 args.
    v_json = f"__vars_build({vars_args})" if vars_args else "__vars_build()"
    g_json = f"__vars_build({_make_vars_args(g_names)})"
    return (
        f'__TRACE_STATE_G({point.line}, "{point.func_name}", {point.depth}, '
        f"{v_json}, {g_json});"
    )


def _trace_branch(point: InjectionPoint) -> str:
    # Normalise whitespace (multi-line conditions arrive single-lined from
    # the walker) and never emit a placeholder that isn't valid C++ — the
    # expression is spliced into __TRACE_BRANCH / __TRACE_BRANCH_OPS.
    cond_expr = " ".join(point.condition_text.split())
    if not cond_expr or cond_expr == "?" or re.fullmatch(r"line \d+", cond_expr):
        cond_expr = "true"
    cond = cond_expr.replace("\\", "\\\\").replace('"', '\\"')
    ops_vars = list(getattr(point, "cond_vars", []))
    if not ops_vars:
        return (
            f'__TRACE_BRANCH({point.line}, "{point.func_name}", {point.depth}, '
            f'"{cond}", ({cond_expr}));'
        )
    ops_args = ", ".join(f'"{v}", {v}' for v in ops_vars)
    return (
        f'__TRACE_BRANCH_OPS({point.line}, "{point.func_name}", {point.depth}, '
        f'"{cond}", ({cond_expr}), {ops_args});'
    )


def _trace_loop_iter(point: InjectionPoint) -> str:
    return (
        f'__TRACE_LOOP_ITER({point.line}, "{point.func_name}", {point.depth}, '
        f'{point.counter_var}++);'
    )


def _state_insert_line(point_line: int, lines: list[str]) -> int:
    """Return the line a __TRACE_STATE call can safely follow.

    STATE is spliced after a line, but if that line is mid-statement (a
    multi-line if condition, call, or assignment) the splice splits the
    statement and g++ rejects it. Scan forward while parens/brackets are
    unbalanced or the line ends mid-expression, stopping at the first
    statement-complete line (ends with ;, {, or }). Bounded; falls back
    to point_line. The event keeps point_line for scope lookup and
    reporting — only the physical placement moves.
    """
    n = len(lines)
    depth = 0
    k = point_line
    while k <= n:
        code = re.sub(r'"(?:\\.|[^"\\])*"', '""', lines[k - 1].split("//")[0])
        for ch in code:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
        stripped = code.strip()
        if depth <= 0 and stripped.endswith((";", "{", "}")):
            return k
        k += 1
        if k - point_line > 100:
            return point_line
    return point_line


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
    _tmp_name = None
    if source_path is None:
        with tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False) as _tmp:
            _tmp.write(source)
            _tmp.flush()
            _tmp_name = _tmp.name
        source_path = _tmp_name

    try:
        walk_result = walk(source_path)
        scope_map = build_scope_map(source_path)
    finally:
        if _tmp_name:
            Path(_tmp_name).unlink(missing_ok=True)

    # Debug: write injection point counts per function
    try:
        counts: dict[str, dict[str, int]] = {}
        for p in walk_result.injection_points:
            counts.setdefault(p.func_name, {})
            counts[p.func_name][p.kind.name] = counts[p.func_name].get(p.kind.name, 0) + 1
        lines_debug = [f"{fn}: {counts[fn]}" for fn in sorted(counts.keys())]
        Path("/tmp/dsa_injection_debug.txt").write_text("\n".join(lines_debug), encoding="utf-8")
    except (OSError, ValueError):
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

            def trace_exit_with(var_name: str, _point: InjectionPoint = point) -> str:
                return f'__TRACE_FUNC_EXIT({_point.line}, "{_point.func_name}", {_point.depth}, ({var_name}));'

            # Only inject when the line starts with 'return' to avoid breaking inline returns.
            if line_text.lstrip().startswith("return"):
                # If the previous non-empty line is an if without braces, skip to avoid changing flow.
                prev_idx = point.line - 2
                while prev_idx >= 0 and not lines[prev_idx].strip():
                    prev_idx -= 1
                prev_line = lines[prev_idx] if prev_idx >= 0 else ""
                if (
                    prev_line.strip().startswith("if")
                    and "{" not in prev_line
                    and "else" not in prev_line
                    and prev_idx not in wrapped_if_lines
                ):
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
            insert_line = _state_insert_line(point.line, lines)
            line_text = lines[insert_line - 1] if insert_line <= len(lines) else ""
            if "return" in line_text:
                # R4 (M5): never leave a return-line step snapshot-less. STATE
                # after a return is unreachable, so snapshot BEFORE it. Reading
                # vars needs no return-expr evaluation, so no temp var is
                # needed here; FUNC_EXIT (walker-ordered after STATE) still
                # handles the return value via the safe-expr/temp-var paths.
                add_before(point.line, _trace_state(point, scope, walk_result.global_vars))
                continue
            next_line = lines[insert_line].strip() if insert_line < len(lines) else ""
            if next_line.startswith("else"):
                # Splicing after this line would split the if/else chain
                # (compile break). The else branch gets its own STATE points
                # from the walker over the same parent scope, so snapshot
                # BEFORE this line (chain-safe) — except when this line is
                # itself an `else` one-liner, where before-placement splits
                # the chain too; then skip (else-body STATE covers it).
                if line_text.lstrip().startswith("else"):
                    continue
                add_before(point.line, _trace_state(point, scope, walk_result.global_vars))
                continue
            add_after(insert_line, _trace_state(point, scope, walk_result.global_vars))

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

    # 4. Per-struct identity serializers (todo 15, T11a). Appended at END of
    # file so struct types are complete; ADL finds the global __ser
    # overloads from tracer.h's dependent calls. Never raises — on any
    # failure the program keeps the existing $addr fallback behavior.
    try:
        from . import serializer_gen as _serializer_gen

        # Production callers (execute.py) pass no source_path, and the walk
        # temp file is already unlinked above — materialize source to a real
        # .cpp file so libclang can parse it. Best-effort: any failure here
        # degrades to the $addr fallback exactly as before.
        _gen_path = source_path
        _gen_tmp_name = None
        try:
            if _gen_path is None or not Path(_gen_path).is_file():
                with tempfile.NamedTemporaryFile(
                    suffix=".cpp", mode="w", delete=False, encoding="utf-8"
                ) as _gen_tmp:
                    _gen_tmp.write(source)
                    _gen_tmp.flush()
                    _gen_tmp_name = _gen_tmp.name
                _gen_path = _gen_tmp_name
            output.append(_serializer_gen.generate_serializers(_gen_path))
        finally:
            if _gen_tmp_name is not None:
                try:
                    Path(_gen_tmp_name).unlink(missing_ok=True)
                except OSError:
                    logger.debug("serializer_gen tmp cleanup failed", exc_info=True)
    except (OSError, ValueError, RuntimeError):
        logger.debug("serializer_gen hookup skipped", exc_info=True)

    instrumented = "".join(output)

    return instrumented
