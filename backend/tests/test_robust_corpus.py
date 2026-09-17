"""test_robust_corpus.py — Wave 4 seed corpus (8 fixtures).

Each row asserts: instrument() raises no InstrumentParseError,
g++ -O0 -std=c++17 compiles, runs rc==0, TRACE enter/state/exit
present on stderr, stdout matches uninstrumented build.
Multibyte/UTF-8 folds into the macro row (string-literal case).
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.instrumenter.injector import instrument

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"

SRC_MACRO_UTF8 = (
    "#define DOUBLE(x) ((x)*2)\n"
    "#include <iostream>\n"
    "#include <string>\n"
    "int main() {\n"
    '    std::string s = "h\\u00e9llo\\u2192\\u2713";\n'
    "    int v = DOUBLE(21);\n"
    '    std::cout << s << " " << v << std::endl;\n'
    "    return 0;\n"
    "}\n"
)

SRC_FUNC_TEMPLATE = (
    "template <typename T>\n"
    "T add(T a, T b) {\n"
    "    T c = a + b;\n"
    "    return c;\n"
    "}\n"
    "#include <iostream>\n"
    "int main() {\n"
    "    int v = add<int>(2, 3);\n"
    "    std::cout << v << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

SRC_CLASS_TEMPLATE = (
    "template <typename T>\n"
    "class Box {\n"
    "public:\n"
    "    T value;\n"
    "    T get() {\n"
    "        T tmp = value;\n"
    "        return tmp;\n"
    "    }\n"
    "    void set(T v) {\n"
    "        value = v;\n"
    "    }\n"
    "};\n"
    "#include <iostream>\n"
    "int main() {\n"
    "    Box<int> b;\n"
    "    b.set(3);\n"
    "    int x = b.get();\n"
    "    std::cout << x << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

SRC_LAMBDA = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int base = 10;\n"
    "    auto f = [base](int v) {\n"
    "        int w = v + base;\n"
    "        return w;\n"
    "    };\n"
    "    int r = f(5);\n"
    "    std::cout << r << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

SRC_NAMESPACE = (
    "#include <iostream>\n"
    "namespace myns {\n"
    "int helper(int x) {\n"
    "    int y = x * 2;\n"
    "    return y;\n"
    "}\n"
    "}\n"
    "int main() {\n"
    "    int v = myns::helper(21);\n"
    "    std::cout << v << std::endl;\n"
    "    return 0;\n"
    "}\n"
)

SRC_OVERLOAD = (
    "#include <iostream>\n"
    "int calc(int a, int b) {\n"
    "    int s = a + b;\n"
    "    return s;\n"
    "}\n"
    "double calc(double a) {\n"
    "    double d = a * 2.0;\n"
    "    return d;\n"
    "}\n"
    "int main() {\n"
    "    int i = calc(2, 3);\n"
    "    double d = calc(2.5);\n"
    '    std::cout << i << " " << d << std::endl;\n'
    "    return 0;\n"
    "}\n"
)

SRC_NEW_DELETE = (
    "#include <iostream>\n"
    "int main() {\n"
    "    int* p = new int(7);\n"
    "    int v = *p + 1;\n"
    "    delete p;\n"
    "    int* q = new int[3];\n"
    "    q[0] = 1;\n"
    "    q[1] = 2;\n"
    "    q[2] = 3;\n"
    "    int s = q[0] + q[1] + q[2];\n"
    "    delete[] q;\n"
    '    std::cout << v << " " << s << std::endl;\n'
    "    return 0;\n"
    "}\n"
)

SRC_SMART_PTR = (
    "#include <iostream>\n"
    "#include <memory>\n"
    "int main() {\n"
    "    auto u = std::make_unique<int>(21);\n"
    "    int a = *u + 0;\n"
    "    auto s = std::make_shared<int>(20);\n"
    "    int b = *s + 1;\n"
    '    std::cout << a << " " << b << std::endl;\n'
    "    return 0;\n"
    "}\n"
)


def _build_and_run(source: str, tmp_path: Path, name: str):
    src = tmp_path / name
    src.write_text(source, encoding="utf-8")
    shutil.copy(TRACER_H, tmp_path / "tracer.h")
    binary = tmp_path / name.replace(".cpp", "")
    comp = subprocess.run(
        ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert comp.returncode == 0, f"{name}: compile failed:\n{comp.stderr}"
    run = subprocess.run(
        [str(binary)], capture_output=True, text=True, check=False, timeout=10
    )
    assert run.returncode == 0, f"{name}: run rc={run.returncode} err={run.stderr!r}"
    return run.stdout, run.stderr


def _check(source: str, tmp_path: Path, name: str):
    src = tmp_path / name
    src.write_text(source, encoding="utf-8")
    instrumented = instrument(source, str(src))  # must not raise InstrumentParseError
    out_instr, err_instr = _build_and_run(instrumented, tmp_path, f"i_{name}")
    out_plain, _ = _build_and_run(source, tmp_path, f"p_{name}")
    assert (
        out_instr == out_plain
    ), f"{name}: stdout mismatch: instrumented={out_instr!r} plain={out_plain!r}"
    assert '"t":"enter"' in err_instr, f"{name}: no enter event:\n{err_instr}"
    assert '"t":"state"' in err_instr, f"{name}: no state event:\n{err_instr}"
    assert '"t":"exit"' in err_instr, f"{name}: no exit event:\n{err_instr}"
    return out_instr, err_instr


class TestRobustCorpus:
    def test_macro_utf8_string_literal(self, tmp_path):
        out, _ = _check(SRC_MACRO_UTF8, tmp_path, "c_macro.cpp")
        assert "42" in out

    def test_function_template(self, tmp_path):
        out, _ = _check(SRC_FUNC_TEMPLATE, tmp_path, "c_functmpl.cpp")
        assert "5" in out

    def test_class_template(self, tmp_path):
        out, _ = _check(SRC_CLASS_TEMPLATE, tmp_path, "c_classtmpl.cpp")
        assert "3" in out

    def test_lambda_capture(self, tmp_path):
        out, _ = _check(SRC_LAMBDA, tmp_path, "c_lambda.cpp")
        assert "15" in out

    def test_namespace(self, tmp_path):
        out, _ = _check(SRC_NAMESPACE, tmp_path, "c_ns.cpp")
        assert "42" in out

    def test_overloading(self, tmp_path):
        out, _ = _check(SRC_OVERLOAD, tmp_path, "c_overload.cpp")
        assert "5" in out

    def test_new_delete(self, tmp_path):
        out, _ = _check(SRC_NEW_DELETE, tmp_path, "c_newdel.cpp")
        assert "8" in out and "6" in out

    def test_smart_pointers(self, tmp_path):
        out, _ = _check(SRC_SMART_PTR, tmp_path, "c_smart.cpp")
        assert "21" in out
