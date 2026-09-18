"""test_macro_hygiene_red.py — hygienic macro temporaries (P0-10, P1-05).

Macro-internal temporaries (`__v`, `__o`, `__p`, `__tg` in tracer.h) and
injector-emitted hoist temps (`__trace_c_N`, `__trace_ret_*` in injector.py)
collide with user identifiers:

- B2 c-collision: user `bool __trace_c_0` + hoisted `bool __trace_c_0`
  redeclares (g++ `redeclaration`).
- B3 v-self-init: user `int __v` captured by STATE expands to
  `std::string __v = __vars_build("__v", __v)` — the arg is the new string
  itself, so the trace holds garbage instead of the user value.
- B4 tg-opaque: user `int __tg` captured by STATE reads the macro's
  `__TraceGuard __tg` instead, tracing `"<opaque>"` via the __ser fallback.
- B5 o-exit: `return __o;` spliced into EXIT reads the macro's
  `std::string __o` (stdout delta), so exit `r` is wrong.
- B6 p-enter: param `int __p` captured by ENTER expands to
  `std::string __p = __vars_build("__p", __p)` — self-init garbage.

Fix: rename every macro-internal and injector-emitted temp to the reserved
`__algotrace_*` scheme, keeping the todo-7 brace-block + trailing-token
mechanism and the `auto` spelling (todo 9 owns `auto&&`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

# B2: user owns `__trace_c_0`; the hoisted cond temp must not redeclare it.
C_COLLISION_SRC = (
    "#include <iostream>\n"
    "int g(int x) { return x * 2; }\n"
    "int main() {\n"
    "    bool __trace_c_0 = false;\n"
    "    int n = 3;\n"
    "    if (g(n) > 2) { std::cout << \"yes \" << __trace_c_0 << std::endl; }\n"
    "    else { std::cout << \"no\" << std::endl; }\n"
    "    return 0;\n"
    "}\n"
)

# B3: user `__v` must trace as the user int, not self-init garbage.
V_SELF_INIT_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int __v = 42;\n"
    "    std::cout << __v << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# B4: user `__tg` must trace as the user int, not `<opaque>`.
TG_OPAQUE_SRC = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int __tg = 7;\n"
    "    std::cout << __tg << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

# B5: `return __o;` must record exit r=99, not the stdout-delta string.
O_EXIT_SRC = (
    "#include <iostream>\n"
    "int f() {\n"
    "    int __o = 99;\n"
    "    return __o;\n"
    "}\n"
    "int main() { std::cout << f() << std::endl; return 0; }\n"
)

# B6: param `__p` must enter-trace as 21, not self-init garbage.
P_ENTER_SRC = (
    "#include <iostream>\n"
    "int f(int __p) { return __p * 2; }\n"
    "int main() { std::cout << f(21) << std::endl; return 0; }\n"
)


def _compile_and_run(source: str) -> tuple[int, str, str, list[dict]]:
    """Compile instrumented source, run it; return (code, stderr, stdout, events)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)
        shutil.copy(TRACER_H, tmp_path / "tracer.h")
        binary = tmp_path / "prog"
        compiled = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path),
             "-o", str(binary), str(src)],
            capture_output=True, text=True, check=False, timeout=60,
        )
        if compiled.returncode != 0:
            return compiled.returncode, compiled.stderr, "", []
        ran = subprocess.run(
            [str(binary)], capture_output=True, text=True, check=False, timeout=60,
        )
        events = []
        for line in ran.stderr.splitlines():
            if line.startswith("TRACE:"):
                try:
                    events.append(json.loads(line[len("TRACE:"):]))
                except json.JSONDecodeError:
                    pass
        return 0, "", ran.stdout.strip(), events


def _instrument(src_text: str, tag: str, tmp_path: Path) -> str:
    src = tmp_path / f"{tag}.cpp"
    src.write_text(src_text)
    return instrument(src_text, str(src))


class TestMacroHygiene:
    def test_c_collision_compiles_and_runs(self, tmp_path: Path) -> None:
        """B2 RED: user `__trace_c_0` + hoist temp redeclaration breaks g++."""
        out = _instrument(C_COLLISION_SRC, "c-coll", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"hoist temp redeclares user __trace_c_0:\n{stderr}"
        assert stdout == "yes 0", f"wrong stdout: {stdout!r}"
        taken = [e["tk"] for e in events if e.get("t") == "branch"]
        assert taken and all(taken), f"branch must be taken: {taken}"

    def test_v_self_init_traces_user_value(self, tmp_path: Path) -> None:
        """B3 RED: STATE must show user `__v`=42, not self-init garbage."""
        out = _instrument(V_SELF_INIT_SRC, "v-self", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"v program failed to compile:\n{stderr}"
        assert stdout == "42", f"wrong stdout: {stdout!r}"
        vals = [e.get("v", {}).get("__v") for e in events if e.get("t") == "state"]
        assert vals and all(v == 42 for v in vals), f"STATE __v must be 42: {vals}"

    def test_tg_opaque_traces_user_value(self, tmp_path: Path) -> None:
        """B4 RED: STATE must show user `__tg`=7, not `<opaque>`."""
        out = _instrument(TG_OPAQUE_SRC, "tg-opq", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"tg program failed to compile:\n{stderr}"
        assert stdout == "7", f"wrong stdout: {stdout!r}"
        vals = [e.get("v", {}).get("__tg") for e in events if e.get("t") == "state"]
        assert vals and all(v == 7 for v in vals), f"STATE __tg must be 7: {vals}"

    def test_o_exit_records_return_value(self, tmp_path: Path) -> None:
        """B5 RED: exit `r` must be 99, not the macro stdout-delta string."""
        out = _instrument(O_EXIT_SRC, "o-exit", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"o program failed to compile:\n{stderr}"
        assert stdout == "99", f"wrong stdout: {stdout!r}"
        rs = [e["r"] for e in events if e.get("t") == "exit" and e.get("f") == "f"]
        assert rs == [99], f"exit r must be [99]: {rs}"

    def test_p_enter_records_param_value(self, tmp_path: Path) -> None:
        """B6 RED: enter `p` must show `__p`=21, not self-init garbage."""
        out = _instrument(P_ENTER_SRC, "p-enter", tmp_path)
        code, stderr, stdout, events = _compile_and_run(out)
        assert code == 0, f"p program failed to compile:\n{stderr}"
        assert stdout == "42", f"wrong stdout: {stdout!r}"
        ps = [e.get("p", {}).get("__p") for e in events
              if e.get("t") == "enter" and e.get("f") == "f"]
        assert ps == [21], f"enter p __p must be [21]: {ps}"
