"""
core/stdin/parser.py — Deterministic stdin parser.

Replaces the LLM-based input_cleaner with pure regex extraction.
Extracts cin/scanf patterns from C++ code to understand expected input
shape, then parses the user's raw input accordingly.

Gracefully degrades: always returns a string, never crashes.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Regex patterns for C++ input statements
# ---------------------------------------------------------------------------

# cin >> variable (simple, including chained: cin >> n >> m)
_RE_CIN_VAR = re.compile(r"cin\s*>>\s*(\w+)")

# cin >> array[index] — captures array name
_RE_CIN_ARRAY = re.compile(r"cin\s*>>\s*(\w+)\[")

# scanf("format", &var1, &var2, ...) — captures the call body
_RE_SCANF = re.compile(r'scanf\s*\(([^)]*)\)')

# getline(cin, variable)
_RE_GETLINE = re.compile(r"getline\s*\(\s*cin\s*,\s*(\w+)")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_cin_summary(code: str) -> str:
    """Extract input-related lines from C++ code for context.

    Returns a short snippet (up to 10 lines) showing how the program
    reads input. Mirrors the old ``_extract_cin_usage`` interface.
    """
    lines = code.splitlines()
    input_lines = [
        l.strip()
        for l in lines
        if "cin" in l or "scanf" in l or "getline" in l
    ]
    return "\n".join(input_lines[:10])


def _extract_expected_tokens(code: str) -> list[dict]:
    """Parse C++ code and return a list of expected input tokens.

    Each entry describes one expected read operation so the parser
    can validate and organise the raw input meaningfully.

    This is currently used for analysis / debugging; the main parsing
    logic uses a simpler heuristic pass.
    """
    tokens: list[dict] = []

    for m in _RE_CIN_VAR.finditer(code):
        tokens.append({"type": "cin_var", "var": m.group(1)})

    for m in _RE_CIN_ARRAY.finditer(code):
        tokens.append({"type": "cin_array", "var": m.group(1)})

    for m in _RE_SCANF.finditer(code):
        args = m.group(1)
        # Extract format string and count % directives
        fmt_match = re.search(r'"([^"]*)"', args)
        fmt = fmt_match.group(1) if fmt_match else ""
        directives = len(re.findall(r'%[sd]', fmt))
        tokens.append({"type": "scanf", "format": fmt, "directives": directives})

    for m in _RE_GETLINE.finditer(code):
        tokens.append({"type": "getline", "var": m.group(1)})

    return tokens


def _is_clean_stdin(text: str) -> bool:
    """Check whether *text* looks like clean stdin (just values, no prose).

    Clean stdin contains only digits, whitespace, newlines, and basic
    punctuation (minus/hyphen for negatives, decimal point for floats).
    The presence of any alphabetic character ⟶ likely prose.
    """
    stripped = text.strip()
    if not stripped:
        return True
    return not bool(re.search(r"[a-zA-Z]", stripped))


def _strip_prose(raw_input: str) -> str | None:
    """Remove prose from *raw_input*, keeping only numeric value tokens.

    Returns a cleaned string with values separated by spaces, or
    ``None`` when no useful numeric content could be extracted.
    """
    # Normalise common prose delimiters to whitespace
    normalized = raw_input
    normalized = re.sub(r"[\[\](){};:]", " ", normalized)
    normalized = normalized.replace(",", " ")

    values: list[str] = []
    for token in normalized.split():
        token = token.strip()
        if not token:
            continue
        # Integer or float (including negative)
        if re.fullmatch(r"-?\d+(?:\.\d+)?", token):
            values.append(token)

    if not values:
        return None

    return " ".join(values)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def parse_stdin(code: str, raw_input: str) -> tuple[str, str]:
    """Parse and format the user's raw stdin to match the program's expectations.

    Uses regex to extract ``cin`` / ``scanf`` patterns from *code*, then
    determines whether *raw_input* is already clean or needs prose stripped.

    Args:
        code: The user's C++ source code.
        raw_input: The user's raw stdin (may be messy or empty).

    Returns:
        Tuple of ``(cleaned_stdin, preview_message)``.
        ``cleaned_stdin`` is the formatted stdin string ready to pipe to the
        program.  ``preview_message`` is a human-readable description of what
        (if anything) was changed.
    """
    cin_summary = _extract_cin_summary(code)

    # ── Empty input ──────────────────────────────────────────────────────
    if not raw_input.strip():
        if not cin_summary:
            return "", "Program reads no stdin — running directly"
        return "", "No input provided (program will read from empty stdin)"

    # ── No cin / scanf usage found — pass through ────────────────────────
    if not cin_summary:
        return raw_input, "No cin usage found — using raw input as-is"

    try:
        # ── Already clean?  Return as-is ─────────────────────────────────
        if _is_clean_stdin(raw_input):
            return raw_input, "Input looks correct — no changes needed"

        # ── Try to strip prose ───────────────────────────────────────────
        cleaned = _strip_prose(raw_input)
        if cleaned is not None and cleaned.strip():
            preview = _make_preview(raw_input, cleaned)
            return cleaned, preview

        # Nothing useful extracted — return original
        return raw_input, "Could not parse input — using raw input as-is"

    except Exception as e:  # noqa: BLE001 — graceful degradation, never crash
        logger.warning("Input parsing failed, using raw input: %s", e)
        return raw_input, f"Input parsing failed ({e}) — using raw input as-is"


def _make_preview(original: str, cleaned: str) -> str:
    """Generate a human-readable preview of what changed."""
    if original.strip() == cleaned.strip():
        return "Input looks correct — no changes needed"
    orig_lines = len(original.splitlines())
    clean_lines = len(cleaned.splitlines())
    return f"Reformatted from {orig_lines} line(s) to {clean_lines} line(s)"
