"""
_libclang_compat.py — libclang toolchain pin + bindings gap-fill.

Root cause (Task 1): two compounding defects made every AST test fail with
``ValueError: Unknown template argument kind 437``:

1. ``_find_libclang`` only globbed ``*.so*`` directly under
   ``site-packages/clang/``, but the ``libclang==18.1.1`` wheel ships its
   native library at ``site-packages/clang/native/libclang.so``. The finder
   returned ``None``, so the bindings silently fell back to the SYSTEM
   libclang (v22.1 on this machine) — a major-version skew versus the 18.1.1
   Python bindings.
2. Even with the matched 18.1.1 native library, the wheel's ``cindex.py``
   never registered cursor kinds 155, 305-306 and 420-437 (the LLVM
   maintainers skipped them when generating the bindings). Any STL-heavy
   translation unit (``<vector>`` pulls in ``attribute(flag_enum)`` = 437)
   crashes ``cursor.kind`` with ``ValueError``.

Fix: resolve the bundled ``clang/native/libclang.so`` first (never the
system lib), and register the 21 missing ``CursorKind`` values (verified
against the bundled 18.1.1 native library via ``clang_getCursorKindSpelling``;
spot-checked identical on system libclang 22.1).

Do NOT add the obsolete PyPI ``clang`` package (latest release 9.0 — no
18.x wheel exists, and it collides with ``libclang`` on the ``clang/``
package directory). ``libclang==18.1.1`` alone bundles matched bindings +
native library; it IS the pin.
"""

from __future__ import annotations

import logging
from pathlib import Path

import clang.cindex as clang

logger = logging.getLogger(__name__)


def _find_libclang() -> str | None:
    """Locate the bundled libclang shared library.

    Prefers the ``libclang`` wheel's bundled ``clang/native/libclang.so``
    (version-matched to the Python bindings) over any system libclang, which
    may be a different major version and emit cursor kinds the bindings do
    not know about.
    """
    try:
        import clang

        pkg_dir = Path(clang.__file__).parent
        for pattern in (
            "native/libclang.so",
            "native/libclang*.so*",
            "native/*.so*",
            "libclang*.so*",
            "*.so*",
        ):
            for candidate in sorted(pkg_dir.glob(pattern)):
                if candidate.is_file():
                    return str(candidate)
    except Exception:
        logger.debug("Failed to find libclang", exc_info=True)
    return None


def ensure_libclang() -> str | None:
    """Pin the bindings to the bundled native library (idempotent)."""
    lib = _find_libclang()
    if lib and not clang.Config.loaded:
        clang.Config.set_library_file(lib)
    elif not lib:
        logger.warning(
            "Bundled libclang not found; falling back to system libclang. "
            "Version skew may raise 'Unknown template argument kind' errors."
        )
    return lib


# Cursor kinds present in libclang 18.1.1's native library but missing from
# the wheel's cindex.py table. Names follow the existing SNAKE_UPPER_ATTR /
# _DIRECTIVE / _EXPR conventions, derived from the native spellings
# (e.g. ``attribute(flag_enum)`` -> ``FLAG_ENUM_ATTR``).
_MISSING_CURSOR_KINDS: tuple[tuple[str, int], ...] = (
    ("CXX_PAREN_LIST_INIT_EXPR", 155),
    ("OMP_ERROR_DIRECTIVE", 305),
    ("OMP_SCOPE_DIRECTIVE", 306),
    ("NS_RETURNS_RETAINED_ATTR", 420),
    ("NS_RETURNS_NOT_RETAINED_ATTR", 421),
    ("NS_RETURNS_AUTORELEASED_ATTR", 422),
    ("NS_CONSUMES_SELF_ATTR", 423),
    ("NS_CONSUMED_ATTR", 424),
    ("OBJC_EXCEPTION_ATTR", 425),
    ("NSOBJECT_ATTR", 426),
    ("OBJC_INDEPENDENT_CLASS_ATTR", 427),
    ("OBJC_PRECISE_LIFETIME_ATTR", 428),
    ("OBJC_RETURNS_INNER_POINTER_ATTR", 429),
    ("OBJC_REQUIRES_SUPER_ATTR", 430),
    ("OBJC_ROOT_CLASS_ATTR", 431),
    ("OBJC_SUBCLASSING_RESTRICTED_ATTR", 432),
    ("OBJC_PROTOCOL_REQUIRES_EXPLICIT_IMPLEMENTATION_ATTR", 433),
    ("OBJC_DESIGNATED_INITIALIZER_ATTR", 434),
    ("OBJC_RUNTIME_VISIBLE_ATTR", 435),
    ("OBJC_BOXABLE_ATTR", 436),
    ("FLAG_ENUM_ATTR", 437),
)


def _register_missing_kinds() -> None:
    """Register missing CursorKind values (idempotent, future-wheel-safe)."""
    kinds = clang.CursorKind._kinds
    for name, value in _MISSING_CURSOR_KINDS:
        if value < len(kinds) and kinds[value] is not None:
            continue  # already registered (e.g. fixed upstream wheel)
        if getattr(clang.CursorKind, name, None) is not None:
            continue
        setattr(clang.CursorKind, name, clang.CursorKind(value))


_libclang_path = ensure_libclang()
_register_missing_kinds()
