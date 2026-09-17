from __future__ import annotations

import os
from pathlib import Path

import clang.cindex as clang

from . import _libclang_compat


def track_pointer_lifetimes(source: str, source_path: str) -> str:
    tu = clang.Index.create().parse(
        source_path,
        args=_libclang_compat.default_extra_args() + ["-I" + str(Path(__file__).parent)],
        unsaved_files=[(source_path, source)],
    )
    raw = source.encode("utf-8")
    insertions: dict[int, list[str]] = {}

    def wrap(start: int, end: int, helper: str) -> None:
        insertions.setdefault(start, []).append(helper + "(")
        insertions.setdefault(end, []).insert(0, ")")

    def visit(node: clang.Cursor) -> None:
        if node.location.file is not None and os.path.abspath(
            node.location.file.name
        ) != os.path.abspath(source_path):
            return
        try:
            kind = node.kind
        except ValueError:
            return
        children = list(node.get_children())
        if kind == clang.CursorKind.CXX_NEW_EXPR:
            wrap(node.extent.start.offset, node.extent.end.offset, "__trace_allocated")
        elif kind == clang.CursorKind.CXX_DELETE_EXPR and children:
            operand = children[-1]
            wrap(operand.extent.start.offset, operand.extent.end.offset, "__trace_deleting")
        for child in children:
            visit(child)

    visit(tu.cursor)
    for offset in sorted(insertions, reverse=True):
        raw = raw[:offset] + "".join(insertions[offset]).encode() + raw[offset:]
    return raw.decode("utf-8")
