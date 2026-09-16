"""Instrumenter package — Wave 2a re-exports the diagnostics gate error."""

from app.core.instrumenter.diagnostics import InstrumentParseError, parse_with_diagnostics

__all__ = ["InstrumentParseError", "parse_with_diagnostics"]
