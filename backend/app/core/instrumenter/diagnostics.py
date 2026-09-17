"""diagnostics.py — Wave 2a diagnostics gate (single shared parse entry).

Both ASTWalker.walk and ScopeTracker.build (and therefore instrument())
parse through `parse_with_diagnostics`: one place that parses a TU,
collects tu.diagnostics (severity, spelling, location file:line), raises
typed InstrumentParseError on Error/Fatal, and proceeds on Warning/Note.
"""

from __future__ import annotations

import os

import clang.cindex as clang

_SEVERITY_NAMES: dict[int, str] = {
    0: "Ignored",
    1: "Note",
    2: "Warning",
    3: "Error",
    4: "Fatal",
}


class InstrumentParseError(Exception):
    """Raised when libclang reports Error/Fatal diagnostics for a TU."""


def collect_diagnostics(tu: clang.TranslationUnit) -> list[str]:
    """Format tu.diagnostics as `file:line: Severity: spelling` strings."""
    out: list[str] = []
    for d in tu.diagnostics:
        loc = d.location
        fname: str = loc.file.name if loc.file is not None else "<unknown>"
        out.append(
            f"{fname}:{loc.line}: {_SEVERITY_NAMES.get(int(d.severity), '?')}: {d.spelling}"
        )
    return out


def parse_with_diagnostics(
    index: clang.Index,
    path: str,
    args: list[str],
    options: int = 0,
) -> clang.TranslationUnit:
    """Parse `path` once; raise InstrumentParseError on Error/Fatal diags.

    Warning/Note diagnostics are tolerated — the TU is returned normally.
    """
    tu: clang.TranslationUnit = index.parse(path, args=args, options=options)
    user_path = os.path.abspath(path)
    user_errors = [
        d
        for d in tu.diagnostics
        if int(d.severity) >= 3
        and d.location.file is not None
        and os.path.abspath(d.location.file.name) == user_path
    ]
    if user_errors:
        msgs = "; ".join(
            f"{d.location.file.name}:{d.location.line}: "
            f"{_SEVERITY_NAMES.get(int(d.severity), '?')}: {d.spelling}"
            for d in user_errors
        )
        raise InstrumentParseError(msgs)
    return tu
