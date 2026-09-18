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
import os
import re
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

from .ast_walker import InjectionPoint, InjectKind, walk
from .diagnostics import InstrumentParseError
from .pointer_lifetime import track_pointer_lifetimes
from .scope_tracker import FunctionScope, build_scope_map

__all__ = ["InstrumentParseError", "instrument"]


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
    return (
        f'__TRACE_FUNC_ENTER({point.line}, "{point.func_name}", {point.depth}{sep}{params_args});'
    )


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
    insert_line: int | None = None,
) -> str:
    # Post-declaration snapshot: a STATE after `int x = 5;` sees x.
    var_names = list(point.var_names)
    if scope:
        visible = scope.vars_at_line_post.get(point.line, [])
        for v in visible:
            if v.name not in var_names:
                var_names.append(v.name)
    if scope:
        place = insert_line if insert_line is not None else point.line
        post = scope.vars_at_line_post.get(point.line, [])
        filtered: list[str] = []
        for name in var_names:
            ranges = scope.loop_var_ranges.get(name)
            if ranges:
                decl_lines = [v.decl_line for v in post if v.name == name]
                # Only the loop's own var is lifetime-bound (its decl sits
                # inside a loop interval). Outer/shadowing same-name decls
                # (decl outside all intervals) are different vars — keep.
                if (
                    decl_lines
                    and any(h <= d <= e for h, e in ranges for d in decl_lines)
                    # Emission lands AFTER `place`; inside the loop only
                    # while the body is still open (half-open [h, e)).
                    and not any(h <= place < e for h, e in ranges)
                ):
                    continue
            decl_lines = [v.decl_line for v in post if v.name == name]
            if decl_lines and min(decl_lines) > point.line:
                continue
            extents = [
                (v.decl_line, v.extent_end) for v in post if v.name == name and v.extent_end > 0
            ]
            if extents and not any(d <= place < e for d, e in extents):
                continue
            filtered.append(name)
        var_names = filtered
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
    return f'__TRACE_STATE_G({point.line}, "{point.func_name}", {point.depth}, {v_json}, {g_json});'


def _trace_branch(point: InjectionPoint, value_expr: str | None = None) -> str:
    # Normalise whitespace (multi-line conditions arrive single-lined from
    # the walker) and never emit a placeholder that isn't valid C++ — the
    # expression is spliced into __TRACE_BRANCH / __TRACE_BRANCH_OPS.
    cond_expr = " ".join(point.condition_text.split())
    if not cond_expr or cond_expr == "?" or re.fullmatch(r"line \d+", cond_expr):
        cond_expr = "true"
    cond = cond_expr.replace("\\", "\\\\").replace('"', '\\"')
    # Hoisted single-evaluation path passes the temp name; otherwise the
    # condition text itself is spliced (pure conditions stay byte-identical).
    val = value_expr if value_expr is not None else f"({cond_expr})"
    ops_vars = list(getattr(point, "cond_vars", []))
    if not ops_vars:
        return f'__TRACE_BRANCH({point.line}, "{point.func_name}", {point.depth}, "{cond}", {val});'
    ops_args = ", ".join(f'"{v}", {v}' for v in ops_vars)
    return (
        f'__TRACE_BRANCH_OPS({point.line}, "{point.func_name}", {point.depth}, '
        f'"{cond}", {val}, {ops_args});'
    )


def _byte_line_starts(raw: bytes) -> list[int]:
    """Byte offset where each 1-based line starts."""
    starts = [0]
    idx = 0
    while True:
        idx = raw.find(b"\n", idx)
        if idx < 0:
            return starts
        starts.append(idx + 1)
        idx += 1


def _byte_to_line_col(raw: bytes, starts: list[int], off: int) -> tuple[int, int] | None:
    """Map a byte offset to (1-based line, 0-based char col). None on bad input."""
    import bisect

    if off < 0 or off > len(raw):
        return None
    ln = bisect.bisect_right(starts, off, 0, len(starts))
    try:
        col = len(raw[starts[ln - 1] : off].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return (ln, col)


_CALL_LIKE_RE = re.compile(r"(?<![A-Za-z0-9_:])[A-Za-z_][A-Za-z0-9_]*\s*\(")
_TEMPLATE_CALL_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_:]*\s*<[^;()]*>\s*\(")
_DETACHED_CALL_RE = re.compile(r"\)\s*\(")
_KEYWORD_CALLS = frozenset(
    ["if", "while", "for", "switch", "catch", "sizeof", "alignof", "decltype", "noexcept", "return"]
)
_COMPARISON_EQ_RE = re.compile(r"<=>|==|<=|>=|!=")
_DQ_STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')
_SQ_STRING_RE = re.compile(r"'(?:\\.|[^'\\])*'")
_SIDE_EFFECT_KW_RE = re.compile(r"\b(new|delete|throw|co_await|co_yield)\b")


def _may_have_side_effects(norm: str) -> bool:
    """Best-effort textual check for side-effecting if-conditions.

    Pure conditions keep the legacy duplicate-evaluation trace (byte-identical
    goldens); only maybe-impure ones pay for hoisting. Conservative in the
    hoist direction — an uncertain condition is hoisted (single-eval,
    correct) rather than left on duplicate-eval legacy.
    """
    text = _DQ_STRING_RE.sub('""', norm)
    text = _SQ_STRING_RE.sub("''", text)
    if "?" in text or "," in text:
        return True
    if "++" in text or "--" in text:
        return True
    if _SIDE_EFFECT_KW_RE.search(text):
        return True
    if "=" in _COMPARISON_EQ_RE.sub("", text):
        return True
    for m in _CALL_LIKE_RE.finditer(text):
        if m.group(0).split("(")[0].strip() not in _KEYWORD_CALLS:
            return True
    if _TEMPLATE_CALL_RE.search(text):
        return True
    return bool(_DETACHED_CALL_RE.search(text))


def _branch_cond_source(point: InjectionPoint, raw: bytes) -> str | None:
    """Normalized condition source for *point* via its libclang byte extent.

    Returns None when hoisting is unsafe or pointless — the caller keeps the
    legacy duplicate-evaluation trace: unset extent (switch labels), extent /
    text mismatch, literal true/false, or an empty extraction.
    """
    cs = getattr(point, "cond_start", -1)
    ce = getattr(point, "cond_end", -1)
    if cs is None or ce is None or cs < 0 or ce <= cs or ce > len(raw):
        return None
    try:
        span = raw[cs:ce].decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        return None
    norm = " ".join(span.split())
    if not norm or norm != " ".join(point.condition_text.split()):
        return None
    if norm in ("true", "false") or norm.startswith("true /*"):
        return None
    if not _may_have_side_effects(norm):
        return None
    return norm


def _branch_header_simple(raw: bytes, starts: list[int], from_line: int, ce: int) -> bool:
    """True when the if-header region holds no constexpr / init-statement.

    `if constexpr` cannot use a runtime temp, and `if (init; cond)` embeds a
    declaration the single-span rewrite must not touch — both keep the legacy
    path. Paren counting only (condition extraction itself stays libclang).
    """
    if from_line < 1 or from_line > len(starts) or ce > len(raw):
        return False
    try:
        region = raw[starts[from_line - 1] : ce].decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        return False
    if re.search(r"\bconstexpr\b", region):
        return False
    paren = region.find("(")
    if paren < 0:
        return False
    depth = 0
    brace = 0
    in_str: str | None = None
    for ch in region[paren:]:
        if in_str:
            if ch == in_str:
                in_str = None
            continue
        if ch in ("'", '"'):
            in_str = ch
            continue
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth <= 0:
                return True
        elif ch == "{":
            brace += 1
        elif ch == "}":
            brace -= 1
        elif ch == ";" and depth >= 1 and brace <= 0:
            return False
    return True


def _try_hoist_branch(
    point: InjectionPoint,
    lines: list[str],
    raw: bytes,
    starts: list[int],
    temp: str,
    claimed: set[int],
) -> str | None:
    """Hoist an if-condition into `temp`, rewriting the header in place.

    Returns the normalized condition source on success (caller emits the
    `bool temp = ((cond) ? true : false);` decl + trace on it); None to keep
    the legacy path. The rewrite preserves every newline, so all other
    line-keyed insertions stay valid. `claimed` holds header lines already
    rewritten (same-line nested ifs) — those keep the legacy path.
    """
    norm = _branch_cond_source(point, raw)
    if norm is None:
        return None
    cs = point.cond_start
    ce = point.cond_end
    slc = _byte_to_line_col(raw, starts, cs)
    elc = _byte_to_line_col(raw, starts, ce)
    if slc is None or elc is None:
        return None
    sl, sc = slc
    el, ec = elc
    if sl > len(lines) or el > len(lines):
        return None
    if any(k in claimed for k in range(sl, el + 1)):
        return None
    if not _branch_header_simple(raw, starts, point.line, ce):
        return None
    if _is_braceless_then_body(point.line, lines):
        return None
    try:
        if sl == el:
            line = lines[sl - 1]
            if sc > len(line) or ec > len(line):
                return None
            lines[sl - 1] = line[:sc] + temp + line[ec:]
        else:
            if sc > len(lines[sl - 1]) or ec > len(lines[el - 1]):
                return None
            lines[sl - 1] = lines[sl - 1][:sc] + temp + "\n"
            for k in range(sl, el - 1):
                lines[k] = "\n"
            lines[el - 1] = lines[el - 1][ec:]
    except (IndexError, ValueError):
        return None
    claimed.update(range(sl, el + 1))
    return norm


def _trace_loop_iter(point: InjectionPoint) -> str:
    return (
        f'__TRACE_LOOP_ITER({point.line}, "{point.func_name}", {point.depth}, '
        f"{point.counter_var}++);"
    )


_IF_HEADER_RE = re.compile(r"(else\s+)?if\s*\(")


def _is_braceless_then_body(point_line: int, lines: list[str]) -> bool:
    """True when line *point_line* is the single-statement body of a braceless if.

    The previous non-blank line is a bare `if (...)` / `else if (...)`
    header (no `{`): inserting anything between that header and this line
    detaches the body and orphans a trailing `else` (S5).
    """
    j = point_line - 2
    while j >= 0 and not lines[j].strip():
        j -= 1
    if j < 0:
        return False
    prev = lines[j].strip()
    if "{" not in prev and _IF_HEADER_RE.match(prev) is not None:
        return True
    # Multi-line `if (a &&\n b)` condition: the body follows the
    # condition's last line, which alone never matches the header regex.
    # Join upward (string-aware blanking, so `//` or parens inside
    # literals can't truncate the scan) and test the whole header.
    parts: list[str] = []
    k = j
    steps = 0
    while k >= 0 and steps < 10:
        if not lines[k].strip():
            k -= 1
            steps += 1
            continue
        parts.append(_blank_return_scan(lines[k]))
        joined = " ".join(reversed(parts))
        if (
            "{" not in joined
            and re.match(r"\s*(else\s+)?if\s*\(.*\)\s*$", joined, re.DOTALL)
            and joined.count("(") == joined.count(")")
        ):
            return True
        k -= 1
        steps += 1
    return False


_LOOP_KW_RE = re.compile(r"\b(for|while)\s*\(")


def _sanitize_for_scan(line: str) -> str:
    """Strip // comments and blank out string/char literals, columns intact.

    Literals are blanked FIRST so a `//` inside a string (e.g. `"http://x"`)
    never truncates the scan line — same idiom as `_blank_return_scan`.
    """
    code = _DQ_STRING_RE.sub(lambda m: " " * len(m.group(0)), line)
    code = _SQ_STRING_RE.sub(lambda m: " " * len(m.group(0)), code)
    return code.split("//")[0]


_RETURN_WORD_RE = re.compile(r"\breturn\b")
_RETURN_LEAD_RE = re.compile(r"\s*return\b")


def _blank_return_scan(line: str) -> str:
    """Column-preserving blank for return-keyword scans.

    Strips string/char literals FIRST, then the `//` comment tail, so a
    `//` inside a string (e.g. `"http://x"`) never truncates the line and
    a `return` inside a string/comment never matches. Deliberately
    independent of `_sanitize_for_scan` (which splits `//` first).
    """
    code = _DQ_STRING_RE.sub(lambda m: " " * len(m.group(0)), line)
    code = _SQ_STRING_RE.sub(lambda m: " " * len(m.group(0)), code)
    return code.split("//")[0]


def _has_return_word(line: str) -> bool:
    """True when `line` holds the `return` keyword (word-boundary)."""
    return _RETURN_WORD_RE.search(_blank_return_scan(line)) is not None


def _starts_with_return_word(line: str) -> bool:
    """True when `line` is a return statement (keyword in lead position)."""
    return _RETURN_LEAD_RE.match(_blank_return_scan(line)) is not None


def _split_return_word(line: str) -> tuple[str, str] | None:
    """Split `line` around the `return` keyword; None when absent.

    Splits at the keyword span found on the blanked scan, so identifiers
    like `returned` (or `"return"` in a string) never win the split.
    """
    m = _RETURN_WORD_RE.search(_blank_return_scan(line))
    if m is None:
        return None
    return line[: m.start()], line[m.end():]


def _match_paren(s: str, open_idx: int) -> int:
    """Index of the paren closing s[open_idx] == '('; -1 when unbalanced."""
    depth = 0
    for k in range(open_idx, len(s)):
        if s[k] == "(":
            depth += 1
        elif s[k] == ")":
            depth -= 1
            if depth == 0:
                return k
    return -1


def _loop_governed_if(point_line: int, lines: list[str]) -> tuple[str, int, int] | None:
    """Detect an `if` that is the direct braceless body of a for/while loop.

    A before-placement on such a line lands outside the loop scope, so a
    condition naming a for-init variable fails to compile (`'i' was not
    declared in this scope` — Bug-C, topoSort preset). Returns
    ("same", line_idx0, header_close_col) when `for (...)/while (...)` and
    the `if` share the line (innermost loop wins), ("split", hdr_idx0, -1)
    when the previous non-blank line is a bare loop header, else None.
    """
    if point_line < 1 or point_line > len(lines):
        return None
    here = _sanitize_for_scan(lines[point_line - 1])
    best: tuple[str, int, int] | None = None
    for m in _LOOP_KW_RE.finditer(here):
        close = _match_paren(here, m.end() - 1)
        if close < 0:
            continue
        if re.match(r"\s*if\s*\(", here[close + 1 :]):
            best = ("same", point_line - 1, close)
    if best is not None:
        return best
    # Multi-line for-header with the `if` on its last line
    # (`for (int i = 0;\n i < n; ++i) if (...)`): the `for` keyword sits
    # on an earlier line, so re-run the same-line scan on the joined
    # buffer. Only a close paren landing on the current line counts —
    # earlier closes are the split shape handled below.
    buf_lines: list[str] = []
    kk = point_line
    while kk >= 1 and len(buf_lines) < 10:
        buf_lines.append(_sanitize_for_scan(lines[kk - 1]))
        kk -= 1
    buf_lines.reverse()
    buf = "\n".join(buf_lines)
    prefix = len(buf) - len(here)
    for m in _LOOP_KW_RE.finditer(buf):
        close = _match_paren(buf, m.end() - 1)
        if close < prefix:
            continue
        if re.match(r"\s*if\s*\(", buf[close + 1 :]):
            return ("same", point_line - 1, close - prefix)
    j = point_line - 2
    while j >= 0 and not lines[j].strip():
        j -= 1
    if j < 0:
        return None
    prev = _sanitize_for_scan(lines[j])
    if "{" in prev:
        return None
    if re.match(r"\s*(for|while)\s*\(.*\)\s*$", prev) is None:
        # Multi-line loop header above a split-line `if`: join upward to
        # the `for(`/`while(` opener and test the whole header. The wrap
        # still appends `{` to the header's last line (j), so columns
        # need no mapping back.
        found = False
        up: list[str] = []
        u = j
        while u >= 0 and len(up) < 10:
            if lines[u].strip():
                up.append(_sanitize_for_scan(lines[u]))
                joined = " ".join(reversed(up))
                if (
                    "{" not in joined
                    and re.match(r"\s*(for|while)\s*\(.*\)\s*$", joined, re.DOTALL)
                    and joined.count("(") == joined.count(")")
                ):
                    found = True
                    break
            u -= 1
        if not found:
            return None
    if _IF_HEADER_RE.match(lines[point_line - 1].strip()) is None:
        return None
    return ("split", j, -1)


def _probe_names_loop_var(point: InjectionPoint, scope: FunctionScope | None) -> bool:
    """True when *point*'s STATE would name a loop-scoped variable.

    Mirrors `_trace_state`'s name resolution (point vars unioned with the
    scope post set) and its loop-lifetime test: a name counts only when one
    of its declarations sits inside a loop-var interval. Such probes must
    never `add_before` onto a line whose next line is `else` — that lands
    between a bare loop header and its body (detaching it) or before the
    loop itself (undeclared var).
    """
    if scope is None:
        return False
    post = scope.vars_at_line_post.get(point.line, [])
    names = set(point.var_names)
    names.update(v.name for v in post)
    for name in names:
        ranges = scope.loop_var_ranges.get(name)
        if not ranges:
            continue
        decl_lines = [v.decl_line for v in post if v.name == name]
        if decl_lines and any(h <= d <= e for h, e in ranges for d in decl_lines):
            return True
    return False


def _loop_body_stmt_end(start_line: int, lines: list[str]) -> int | None:
    """Last line of the (else-absorbing) statement starting at start_line.

    None past the safety bound — the caller then keeps the legacy path.
    """
    n = len(lines)

    def scan(fr: int, budget: int) -> int | None:
        depth = 0
        k = fr
        while k <= n and budget > 0:
            code = _sanitize_for_scan(lines[k - 1])
            for ch in code:
                if ch in "([{":
                    depth += 1
                elif ch in ")]}":
                    depth -= 1
            s = code.strip()
            if depth <= 0 and s.endswith((";", "}")):
                j = k
                while True:
                    nxt = j + 1
                    while nxt <= n and not lines[nxt - 1].strip():
                        nxt += 1
                    if nxt <= n and re.match(r"else\b", lines[nxt - 1].strip()):
                        e = scan(nxt, budget - (nxt - k))
                        if e is None:
                            return None
                        j = e
                        continue
                    return j
            k += 1
            budget -= 1
        return None

    return scan(start_line, 100)


def _wrap_loop_governed_if(
    point: InjectionPoint, lines: list[str], temp: str | None = None
) -> tuple[bool, bool]:
    """Brace-wrap a loop-governed braceless if with the BRANCH probe inside.

    Turns `for (...) if (c) body;` into `for (...) { PROBE; if (c) body; }`
    (same-line), or appends `{` to a bare loop header, prepends the probe to
    the if line, and closes after the if/else chain (split-line). Line count
    never changes, so other line-keyed insertions stay valid. Placement is
    exactly the 3bf52f7 wrap; only the condition handling differs: a
    side-effecting condition is hoisted into the introduced braces
    (`bool temp = ((c) ? true : false);` evaluated once, shared by the probe
    and the `if`), while pure conditions keep the legacy duplicate-evaluation
    shape byte-identical. `temp` is the caller's reserved hoist name (None
    forces the legacy shape). Returns (wrapped, temp_used) — the caller
    consumes a sequence number only when the temp was actually emitted.
    """
    span = _loop_governed_if(point.line, lines)
    if span is None:
        return (False, False)

    def cond_span(code: str, scan: str, frm: int) -> tuple[int, int, str] | None:
        """(open, close, text) of the first `if (...)` cond at/after frm.

        Indices are computed on the column-preserving sanitized twin (so a
        paren inside a literal can't win) and used to splice the original.
        None when the cond leaves the line (multi-line cond keeps legacy).
        """
        m = re.search(r"\bif\s*\(", scan[frm:])
        if m is None:
            return None
        opi = frm + m.end() - 1
        if opi >= len(code):
            return None
        cpi = _match_paren(scan, opi)
        if cpi < 0 or cpi >= len(scan) or opi >= len(code):
            return None
        return (opi, cpi, code[opi + 1 : cpi])

    def hoist_decl(pre: str, found: tuple[int, int, str] | None) -> str | None:
        """Hoist decl for a side-effecting cond, else None for legacy."""
        if temp is None or found is None:
            return None
        norm = " ".join(found[2].split())
        if not norm or not _may_have_side_effects(norm):
            return None
        blank = _SQ_STRING_RE.sub("''", _DQ_STRING_RE.sub('""', norm))
        if ";" in blank or re.search(r"\bconstexpr\b", pre) is not None:
            return None
        return f"bool {temp} = (({found[2]}) ? true : false);"

    kind, idx, close = span
    if kind == "same":
        line = lines[idx]
        nl = "\n" if line.endswith("\n") else ""
        body = line[:-1] if nl else line
        cpos = body.find("//", close + 1)
        comment = ""
        if cpos >= 0:
            comment, body = body[cpos:], body[:cpos]
        code = body.rstrip()
        scan = _sanitize_for_scan(code)
        found = cond_span(code, scan, close + 1)
        decl = hoist_decl(code[: found[0]] if found else "", found)
        if decl is None:
            probe = _trace_branch(point)
            lines[idx] = (
                f"{code[: close + 1]} {{ {probe} {code[close + 1 :].lstrip()} }}"
                f"{comment}{nl}"
            )
            return (True, False)
        probe = _trace_branch(point, f"({temp})")
        opi, cpi, _ = found
        tail = code[cpi:]
        lines[idx] = (
            f"{code[: close + 1]} {{ {decl} {probe} if ({temp}{tail} }}"
            f"{comment}{nl}"
        )
        return (True, True)
    end = _loop_body_stmt_end(point.line, lines)
    if end is None:
        return (False, False)
    pl = lines[point.line - 1]
    pnl = "\n" if pl.endswith("\n") else ""
    pbody = pl[:-1] if pnl else pl
    indent = pbody[: len(pbody) - len(pbody.lstrip())]
    pscan = _sanitize_for_scan(pbody)
    found = cond_span(pbody, pscan, 0)
    decl = hoist_decl(pbody[: found[0]] if found else "", found)
    hdr = lines[idx]
    hnl = "\n" if hdr.endswith("\n") else ""
    hbody = hdr[:-1] if hnl else hdr
    cpos = hbody.find("//")
    if cpos >= 0:
        lines[idx] = hbody[:cpos].rstrip() + " {" + " " + hbody[cpos:] + hnl
    else:
        lines[idx] = hbody.rstrip() + " {" + hnl
    if decl is None:
        probe = _trace_branch(point)
        lines[point.line - 1] = f"{indent}{probe} {pbody.lstrip()}{pnl}"
    else:
        probe = _trace_branch(point, f"({temp})")
        opi, cpi, _ = found
        new_if = pbody[: opi + 1] + temp + pbody[cpi:]
        lines[point.line - 1] = f"{indent}{decl} {probe} {new_if.lstrip()}{pnl}"
    el = lines[end - 1]
    enl = "\n" if el.endswith("\n") else ""
    ebody = el[:-1] if enl else el
    epos = ebody.find("//")
    if epos >= 0:
        lines[end - 1] = ebody[:epos].rstrip() + " }" + " " + ebody[epos:] + enl
    else:
        lines[end - 1] = ebody.rstrip() + " }" + enl
    return (True, decl is not None)


def _is_braceless_do_body(point_line: int, lines: list[str]) -> bool:
    """True when line *point_line* is the body of a braceless `do ... while`.

    Any splice between the body and its trailing `while (...)` detaches the
    continuation (and before-placement detaches the body from `do`): skip.
    """
    j = point_line - 2
    while j >= 0 and not lines[j].strip():
        j -= 1
    if j < 0:
        return False
    prev = lines[j].strip()
    return "{" not in prev and (prev == "do" or prev.startswith(("do ", "do\t")))


def _is_braceless_do_header(point_line: int, lines: list[str]) -> bool:
    """True when *point_line* is a bare `do` header with a braceless body.

    Its STATE would slide onto the body line (statement-complete scan) and
    split `do <body> while (...)`: skip.
    """
    if point_line < 1 or point_line > len(lines):
        return False
    here = lines[point_line - 1].strip()
    if "{" in here or not (here == "do" or here.startswith(("do ", "do\t"))):
        return False
    j = point_line
    while j < len(lines) and not lines[j].strip():
        j += 1
    return j < len(lines) and "{" not in lines[j]


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
    code0 = re.sub(r'"(?:\\.|[^"\\])*"', '""', lines[point_line - 1].split("//")[0])
    if re.search(r"\[[^\]]*\]\s*(\(.*\))?\s*\{\s*$", code0):
        # Lambda-initializer DECL (`auto f = [...](...){`, `auto g = [...]{`):
        # the statement only completes at the closing `};` — placing after
        # the header lands inside the lambda body (self-reference before
        # `auto` deduction). The paren group is optional: parens-less
        # lambdas (`auto g = []{`, `[&]{`) need the same deferral.
        k = point_line + 1
        bdepth = 1  # header opened one brace; body `;` lines must not stop the scan
        while k <= n and k - point_line <= 100:
            codek = re.sub(r'"(?:\\.|[^"\\])*"', '""', lines[k - 1].split("//")[0])
            bdepth += codek.count("{") - codek.count("}")
            if bdepth <= 0 and codek.strip().endswith(";"):
                return k
            k += 1
        return point_line
    if re.search(r"=\s*\{\s*$", code0) or code0.strip().endswith("="):
        # Braced-initializer DECL (`int values[] = {`): the statement only
        # completes at the closing `};` — placing after the header lands
        # inside the initializer list (g++: expected primary-expression
        # before 'do' via __TRACE_STATE). Same brace-balance scan as lambda.
        k = point_line + 1
        bdepth = code0.count("{") - code0.count("}")
        while k <= n and k - point_line <= 100:
            codek = re.sub(r'"(?:\\.|[^"\\])*"', '""', lines[k - 1].split("//")[0])
            bdepth += codek.count("{") - codek.count("}")
            if bdepth <= 0 and codek.strip().endswith(";"):
                return k
            k += 1
        return point_line
    if (
        code0.strip().endswith("{")
        and "=" not in code0
        and "(" not in code0
        and re.search(r"[A-Za-z_][A-Za-z0-9_]*\s*(\[[^\]]*\])?\s*\{\s*$", code0)
        and not re.match(
            r"\s*(if|for|while|switch|catch|class|struct|enum|namespace|union|do|try|else)\b",
            code0,
        )
    ):
        # Direct-list-init DECL (`std::vector<int> v{`): same shape as the
        # `= {` initializer above minus the `=` — the statement only
        # completes at the closing `};`. Guards keep control/compound
        # headers (`if (`, `else {`, `struct S {`, ...) on the legacy path:
        # no `=`/`(` plus a leading keyword means "not a declaration".
        k = point_line + 1
        bdepth = code0.count("{") - code0.count("}")
        while k <= n and k - point_line <= 100:
            codek = re.sub(r'"(?:\\.|[^"\\])*"', '""', lines[k - 1].split("//")[0])
            bdepth += codek.count("{") - codek.count("}")
            if bdepth <= 0 and codek.strip().endswith(";"):
                return k
            k += 1
        return point_line
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
    if (
        re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*" r"(\.[A-Za-z_][A-Za-z0-9_]*)*" r"(\[[^\]]+\])*",
            expr,
        )
        is None
    ):
        return False
    # P1-03: a mutating bracket (`a[i++]`, `a[--i]`, `a[i = 0]`) would run
    # twice on the safe path (once for __TRACE_FUNC_EXIT, once for return) —
    # reroute to the temp bind so it evaluates once. Pure `a[i]`/`p.x[0]`
    # stay safe (fail toward hoist: `==` also reroutes, harmlessly).
    for bracket in re.findall(r"\[[^\]]*\]", expr):
        if "++" in bracket or "--" in bracket or "=" in bracket:
            return False
    return True


def _expand_single_line_bodies(source: str) -> str:
    """Split single-line compound bodies into one-statement-per-line form.

    Fix 5 (trace-zero): the injector skips whole functions whose body sits
    on one line (``int main(){...}``) because line-based splicing has
    nowhere to land — the program then compiles+runs with zero ``__TRACE_``
    calls and /execute reports "No trace points were injected". The scope
    tracker already sees for-init decls (``i`` is in ``vars_at_line``); the
    drop happens in the ``single_line_funcs`` guard below, not in scoping.

    This pre-pass inserts newlines (whitespace only — semantics-preserving)
    at libclang statement boundaries: after a single-line compound's ``{``,
    after each direct child's extent end, and at the compound's end. Split
    points come from libclang extent offsets only — no textual C++ parsing.
    Sources without single-line compounds return unchanged.
    """
    try:
        if not re.search(r"\bfor\s*\(", source) and not any(
            "{" in ln and "}" in ln for ln in source.splitlines()
        ):
            return source
    except (AttributeError, ValueError):
        return source
    try:
        import clang.cindex as clang

        from . import _libclang_compat

        _libclang_compat.ensure_libclang()
        with tempfile.NamedTemporaryFile(
            suffix=".cpp", mode="w", delete=False, encoding="utf-8"
        ) as _tmp:
            _tmp.write(source)
            _tmp.flush()
            _tmp_name = _tmp.name
        try:
            index = clang.Index.create()
            tu = index.parse(_tmp_name, args=_libclang_compat.default_extra_args())
            src_abs = _tmp_name
            try:
                src_abs = os.path.abspath(_tmp_name)
            except (AttributeError, ValueError, OSError):
                pass
            splits: set[int] = set()
            wrappers: dict[int, str] = {}
            raw = source.encode("utf-8")

            def _stmt_end(e: int) -> int:
                # Child extents exclude the terminating `;` (`s+=i` ends
                # before it). Splitting there strands the `;` on the next
                # line and breaks statement-completeness scans downstream,
                # so absorb one same-line `;` (plus blanks) into the split.
                # Byte-level, no C++ parsing: inside a single-line compound
                # the next `;` can only terminate this statement.
                j = e
                while j < len(raw) and raw[j] in (0x20, 0x09):
                    j += 1
                if j < len(raw) and raw[j] == 0x3B:
                    return j + 1
                return e

            def _kind(node: clang.Cursor) -> clang.CursorKind | None:
                try:
                    return node.kind
                except ValueError:
                    return None

            def _in_user(node: clang.Cursor) -> bool:
                try:
                    loc = node.location
                    return loc.file is not None and os.path.abspath(loc.file.name) == src_abs
                except (AttributeError, ValueError, OSError):
                    return False

            def _extent_ok(node: clang.Cursor) -> tuple[int, int] | None:
                try:
                    ext = node.extent
                    s, e = ext.start.offset, ext.end.offset
                    sf, ef = ext.start.file, ext.end.file
                    if (
                        s is None
                        or e is None
                        or s < 0
                        or e <= s
                        or sf is None
                        or ef is None
                        or os.path.abspath(sf.name) != src_abs
                        or os.path.abspath(ef.name) != src_abs
                    ):
                        return None
                    return (s, e)
                except (AttributeError, ValueError, OSError, TypeError):
                    return None

            def _is_macro(node: clang.Cursor) -> bool:
                try:
                    return (
                        node.location.file is not None
                        and node.extent.start.offset != node.extent.end.offset
                        and node.location.offset == 0
                    )
                except (AttributeError, TypeError, ValueError):
                    return True

            def _subtree_has_branch(node: clang.Cursor) -> bool:
                try:
                    kids = list(node.get_children())
                except (AttributeError, TypeError, RuntimeError, ValueError):
                    return False
                for ch in kids:
                    if _kind(ch) in (
                        clang.CursorKind.IF_STMT,
                        clang.CursorKind.SWITCH_STMT,
                    ):
                        return True
                    if _subtree_has_branch(ch):
                        return True
                return False

            def _visit(node: clang.Cursor) -> None:
                try:
                    children = list(node.get_children())
                except (AttributeError, TypeError, RuntimeError, ValueError):
                    return
                # Braceless range-for bodies are wrapped only when the body
                # subtree holds a branch (if/switch): __TRACE_BRANCH splices
                # the condition text, so it must land inside the loop. Plain
                # bodies stay unwrapped (S8/R3) — their STATE lands post-loop
                # with the loop var dropped by _trace_state's lifetime filter.
                if (
                    _kind(node) == clang.CursorKind.CXX_FOR_RANGE_STMT
                    and _in_user(node)
                    and children
                ):
                    body = children[-1]
                    bounds = _extent_ok(body)
                    if (
                        bounds is not None
                        and _kind(body) != clang.CursorKind.COMPOUND_STMT
                        and (
                            _kind(body)
                            in (
                                clang.CursorKind.IF_STMT,
                                clang.CursorKind.SWITCH_STMT,
                            )
                            or _subtree_has_branch(body)
                        )
                    ):
                        start, end = bounds
                        end = _stmt_end(end)
                        wrappers[start] = wrappers.get(start, "") + "{\n"
                        wrappers[end] = "\n}" + wrappers.get(end, "")
                        splits.add(end)
                if _kind(node) == clang.CursorKind.COMPOUND_STMT and _in_user(node):
                    bounds = _extent_ok(node)
                    try:
                        one_line = (
                            node.extent.start.line == node.extent.end.line
                            and node.extent.start.line > 0
                        )
                    except (AttributeError, ValueError):
                        one_line = False
                    if bounds is not None and not _is_macro(node):
                        cs, ce = bounds
                        if one_line and ce > cs + 1:
                            splits.add(cs + 1)
                            splits.add(ce)
                        for ch in children:
                            cr = _extent_ok(ch)
                            if cr is not None and cs < cr[1] <= ce and cr[0] >= cs:
                                if one_line:
                                    splits.add(_stmt_end(cr[1]))
                                start = cr[0]
                                prefix = raw[raw.rfind(b"\n", 0, start) + 1 : start]
                                if prefix.strip():
                                    splits.add(start)
                for ch in children:
                    _visit(ch)

            _visit(tu.cursor)
            if not splits:
                return source
            if any(off <= 0 or off > len(raw) for off in splits):
                return source
            for off in sorted(splits | wrappers.keys(), reverse=True):
                insertion = wrappers.get(off, "") + ("\n" if off in splits else "")
                raw = raw[:off] + insertion.encode("utf-8") + raw[off:]
            return raw.decode("utf-8")
        finally:
            Path(_tmp_name).unlink(missing_ok=True)
    except (OSError, ValueError, RuntimeError, UnicodeError):
        logger.debug("single-line expansion skipped", exc_info=True)
        return source


def instrument(
    source: str,
    source_path: str | None = None,
    warnings_out: list[str] | None = None,
) -> str:
    """Instrument C++ source by inserting trace calls.

    Args:
        source: The original C++ source code as a string.
        source_path: Optional path hint for libclang. If None, written to a temp file.
        warnings_out: Optional list receiving non-fatal warning strings
            (currently: user template definitions skipped in v1). The run
            still succeeds — callers surface these next to the trace.

    Returns:
        Instrumented C++ source as a string, ready to compile.
        The returned source has #include "tracer.h" at the top.
        The caller must ensure tracer.h is in the include path when compiling.
    """
    _tmp_name = None
    _orig_source = source
    # Fix 5: walk/scope/serializer must parse the EXPANDED text (line
    # numbers diverge), so a changed source forces the temp-file path.
    source = _expand_single_line_bodies(source)
    parse_path = source_path
    if source_path is None or source != _orig_source:
        with tempfile.NamedTemporaryFile(suffix=".cpp", mode="w", delete=False) as _tmp:
            _tmp.write(source)
            _tmp.flush()
            _tmp_name = _tmp.name
        parse_path = _tmp_name

    try:
        walk_result = walk(parse_path)
        scope_map = build_scope_map(parse_path)
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
    cond_temp_seq = 0
    # Byte view of the expanded source for libclang-offset hoisting; claimed
    # header lines already rewritten (same-line nested ifs keep legacy path).
    raw = source.encode("utf-8")
    line_starts = _byte_line_starts(raw)
    claimed_cond_lines: set[int] = set()

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
                name = f"__algotrace_ret_{ret_temp_seq}"
                ret_temp_seq += 1
                return name

            def trace_exit_with(var_name: str, _point: InjectionPoint = point) -> str:
                return f'__TRACE_FUNC_EXIT({_point.line}, "{_point.func_name}", {_point.depth}, ({var_name}));'

            # Only inject when the line starts with 'return' to avoid breaking inline returns.
            if _starts_with_return_word(line_text):
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
                    # Preserve tokens trailing the return's `;` (e.g. the `}`
                    # closing the function in minified `return x;}`) that the
                    # rewrite below would otherwise drop. The `;` is located
                    # on the string-blanked scan (column-preserving) so a `;`
                    # inside a literal can't win.
                    semi = _blank_return_scan(line_text).find(";")
                    trailing = line_text[semi + 1 :].removesuffix("\n") if semi >= 0 else ""
                    # For simple, side-effect-free expressions, skip the temp
                    # variable to avoid "crosses initialization" errors in
                    # switch case bodies (C++ forbids jumping past a var decl).
                    if _is_safe_return_expr(ret_expr):
                        add_before(point.line, _trace_exit(point))
                        lines[point.line - 1] = f"{indent}return {ret_expr};{trailing}\n"
                    else:
                        # P0-07/P0-08: temp scoped in its own brace block so
                        # case/goto jumps never cross its init (jumping over
                        # a whole block is legal; every path here returns).
                        # P0-11: `auto&&` binds non-copyable refs (ostream&)
                        # without copying; `__ser` serializes the bound ref
                        # to the "<opaque>" placeholder.
                        ret_var = make_ret_temp()
                        lines[point.line - 1] = (
                            f"{indent}{{ auto&& {ret_var} = ({ret_expr}); "
                            f"{trace_exit_with(ret_var)} "
                            f"return {ret_var}; }}{trailing}\n"
                        )
                else:
                    add_before(point.line, _trace_exit(point))
            elif (
                _has_return_word(line_text)
                and "if" in line_text
                and "{" not in line_text
                and ")" in line_text
            ):
                # Inline if-return on the same line: wrap in braces and inject trace inline.
                split_ret = _split_return_word(line_text)
                before, after = split_ret if split_ret is not None else (line_text, "")
                ret_expr_inline = after.strip().rstrip(";")
                if ret_expr_inline:
                    ret_var = make_ret_temp()
                    body = f"auto&& {ret_var} = ({ret_expr_inline}); {trace_exit_with(ret_var)} return {ret_var};"
                else:
                    body = f"{_trace_exit(point)} return;"
                lines[point.line - 1] = f"{indent}{before.strip()} {{ {body} }}\n"

        elif point.kind == InjectKind.STATE:
            # Braceless do-body / bare-do header: any splice splits `do <body> while (...)` — skip (header-adjacent STATEs keep it observable).
            if _is_braceless_do_body(point.line, lines) or _is_braceless_do_header(
                point.line, lines
            ):
                continue
            insert_line = _state_insert_line(point.line, lines)
            line_text = lines[insert_line - 1] if insert_line <= len(lines) else ""
            if _has_return_word(line_text):
                # R4 (M5): never leave a return-line step snapshot-less. STATE
                # after a return is unreachable, so snapshot BEFORE it. Reading
                # vars needs no return-expr evaluation, so no temp var is
                # needed here; FUNC_EXIT (walker-ordered after STATE) still
                # handles the return value via the safe-expr/temp-var paths.
                add_before(
                    point.line,
                    _trace_state(point, scope, walk_result.global_vars, point.line),
                )
                continue
            next_line = lines[insert_line].strip() if insert_line < len(lines) else ""
            if next_line.startswith("else"):
                # Splicing after this line would split the if/else chain
                # (compile break). The else branch gets its own STATE points
                # from the walker over the same parent scope, so snapshot
                # BEFORE this line (chain-safe) — except when before-placement
                # splits the chain too; then skip (BRANCH on the header keeps
                # the region observable, and the else-body STATE covers it):
                #  * this line is itself an `else` one-liner;
                #  * this line is a braceless then-body (prev line is a bare
                #    `if (...)` / `else if (...)` header): inserting between
                #    header and body detaches the body and orphans `else` (S5).
                if line_text.lstrip().startswith("else"):
                    continue
                if _is_braceless_then_body(point.line, lines):
                    continue
                if _probe_names_loop_var(point, scope):
                    # P0-01: add_before here would splice into a chain the
                    # probe must not split (between a bare loop header and
                    # its body, before the loop, or between an if-header
                    # and its then-body, orphaning `else` — the wrap's
                    # probe prefix blinds the S5 check above, so this gate
                    # is the backstop). Slide after the whole if/else chain
                    # instead; _trace_state's lifetime filter drops the dead
                    # loop var at that placement. Probes without loop vars
                    # keep the pre-body snapshot below.
                    end = _loop_body_stmt_end(point.line, lines)
                    if end is None:
                        continue
                    add_after(
                        end,
                        _trace_state(point, scope, walk_result.global_vars, end),
                    )
                    continue
                add_before(
                    point.line,
                    _trace_state(point, scope, walk_result.global_vars, point.line),
                )
                continue
            add_after(
                insert_line,
                _trace_state(point, scope, walk_result.global_vars, insert_line),
            )

        elif point.kind == InjectKind.BRANCH:
            # Loop-governed braceless if (Bug-C): before-placement lands
            # outside the loop scope, so brace-wrap with the probe inside.
            # The temp name is offered for a single-eval hoist; the wrap
            # consumes a sequence number only when it actually emits it
            # (pure governed conds keep the legacy shape, numbering dense).
            gov_temp = f"__algotrace_c_{cond_temp_seq}"
            wrapped, gov_used = _wrap_loop_governed_if(point, lines, gov_temp)
            if wrapped:
                if gov_used:
                    cond_temp_seq += 1
                continue
            # Single-evaluation hoist: `auto` copy-init would drop explicit
            # bool conversions, so the ternary replays the if's own
            # contextual conversion exactly once. while/for/else-if emit no
            # BRANCH points, so their conditions already evaluate once.
            temp = f"__algotrace_c_{cond_temp_seq}"
            norm = _try_hoist_branch(point, lines, raw, line_starts, temp, claimed_cond_lines)
            if norm is None:
                add_before(point.line, _trace_branch(point))
            else:
                cond_temp_seq += 1
                header = lines[point.line - 1] if point.line <= len(lines) else ""
                indent = header[: len(header) - len(header.lstrip())]
                add_before(
                    point.line,
                    f"{indent}bool {temp} = (({norm}) ? true : false);",
                )
                add_before(point.line, _trace_branch(point, f"({temp})"))

        elif point.kind == InjectKind.LOOP_ITER:
            add_after(point.line, _trace_loop_iter(point))

    # ── Fallback return tracing for functions with no FUNC_EXIT ───────────────
    funcs_with_exit = {
        p.func_name for p in walk_result.injection_points if p.kind == InjectKind.FUNC_EXIT
    }
    funcs_with_enter = {
        p.func_name for p in walk_result.injection_points if p.kind == InjectKind.FUNC_ENTER
    }

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

            if _starts_with_return_word(line):
                expr = line.strip()[len("return") :].strip().rstrip(";")
                if not expr:
                    add_before(i + 1, f'__TRACE_FUNC_EXIT_VOID({i + 1}, "{fn}", 0);')
                    break
                ret_var = f"__algotrace_ret_fallback_{fn}"
                # P0-07/P0-08: same brace-block scoping as the main temp
                # path — the temp never leaks to case/goto-crossed scope.
                indent_fb = " " * (len(line) - len(line.lstrip()))
                exit_fb = f'__TRACE_FUNC_EXIT({i + 1}, "{fn}", 0, ({ret_var}));'
                lines[i] = (
                    f"{indent_fb}{{ auto&& {ret_var} = ({expr}); "
                    f"{exit_fb} return {ret_var}; }}\n"
                )
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
        _gen_path = parse_path
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

    if warnings_out is not None:
        for name in walk_result.skipped_templates:
            warnings_out.append(
                f"Template '{name}' is not traced — template bodies aren't "
                "instrumented yet, so calls to it show no steps. Move the "
                "logic into a plain function to see it step by step."
            )

    return track_pointer_lifetimes(instrumented, parse_path)
