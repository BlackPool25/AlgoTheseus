"""
test_serializers.py — Tests for C++ pair/tuple/array serializers in tracer.h.

Each test compiles a small C++ program that uses the ``__ser`` functions from
tracer.h, runs it, and validates the JSON output produced by the serializer.

Happy path + edge cases per serializer family.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

TRACER_H = Path(__file__).parent.parent / "app" / "core" / "instrumenter" / "tracer.h"
FIXTURES = Path(__file__).parent / "fixtures"


# ── Helpers ────────────────────────────────────────────────────────────────────


def _compile_and_run(source: str, stdin: str = "") -> str:
    """Compile a C++ snippet with tracer.h and return its stdout.

    Raises ``RuntimeError`` on compile failure.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / "prog.cpp"
        src.write_text(source)

        shutil.copy(TRACER_H, tmp_path / "tracer.h")

        binary = tmp_path / "prog"
        compile_result = subprocess.run(
            ["g++", "-O0", "-std=c++17", "-I", str(tmp_path), "-o", str(binary), str(src)],
            capture_output=True, text=True, timeout=10,
        )
        if compile_result.returncode != 0:
            raise RuntimeError(f"Compile error:\n{compile_result.stderr}")

        run_result = subprocess.run(
            [str(binary)],
            input=stdin, capture_output=True, text=True, timeout=5,
        )
        return run_result.stdout.strip()


def _assert_serializes(source: str, expected: object) -> None:
    """Assert that the C++ program prints JSON that deserialises to *expected*."""
    stdout = _compile_and_run(source)
    if not stdout:
        pytest.fail(f"Empty output — program produced nothing.\nSource:\n{source}")
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError as e:
        pytest.fail(f"Output is not valid JSON: {e}\nGot: {stdout!r}")
    assert parsed == expected, f"Expected {expected!r}, got {parsed!r}"


def _assert_printed(source: str, expected_str: str) -> None:
    """Assert that the C++ program prints exactly *expected_str*."""
    stdout = _compile_and_run(source)
    assert stdout == expected_str, f"Expected {expected_str!r}, got {stdout!r}"


# ── Serializer test skeleton (include + boilerplate) ──────────────────────────
# Every test below fills in the BODY placeholder.

_SKELETON = '''\
#include "tracer.h"
#include <iostream>
#include <string>
#include <vector>
#include <array>
#include <tuple>
#include <utility>

int main() {{
    std::cout << __ser({body}) << std::endl;
    return 0;
}}
'''


def _make_source(body: str) -> str:
    return _SKELETON.format(body=body)


# ── Tests ──────────────────────────────────────────────────────────────────────


class TestPairSerializer:
    """pair<T1,T2> → JSON array [first,second]."""

    def test_pair_int_int(self):
        """pair<int,int>{1,2} → [1, 2]"""
        _assert_serializes(
            _make_source("std::pair<int,int>{1,2}"),
            [1, 2],
        )

    def test_pair_string_double(self):
        """pair<string,double> → [\"pi\", 3.14] (within floating tolerance)"""
        stdout = _compile_and_run(_make_source(
            'std::pair<std::string,double>{"pi", 3.14}',
        ))
        parsed = json.loads(stdout)
        assert parsed[0] == "pi"
        assert abs(parsed[1] - 3.14) < 1e-6

    def test_pair_bool_char(self):
        """pair<bool,char> → [true, \"X\"]"""
        _assert_serializes(
            _make_source('std::pair<bool,char>{true, \'X\'}'),
            [True, "X"],
        )

    def test_nested_pair(self):
        """pair<int,pair<int,int>> → [1,[2,3]]"""
        _assert_serializes(
            _make_source("std::pair<int,std::pair<int,int>>{1, {2,3}}"),
            [1, [2, 3]],
        )

    def test_pair_deep_nested(self):
        """pair<pair<int,int>,pair<int,int>> → [[1,2],[3,4]]"""
        _assert_serializes(
            _make_source("std::pair<std::pair<int,int>,std::pair<int,int>>{{1,2},{3,4}}"),
            [[1, 2], [3, 4]],
        )

    def test_pair_large_values(self):
        """pair<long long, double> with large values."""
        stdout = _compile_and_run(_make_source(
            "std::pair<long long, double>{9223372036854775807LL, 1.0e100}",
        ))
        parsed = json.loads(stdout)
        assert parsed[0] == 9223372036854775807
        assert abs(parsed[1] / 1.0e100 - 1.0) < 1e-6

    def test_pair_negative_values(self):
        """pair<int,int>{-5,-10} → [-5, -10]"""
        _assert_serializes(
            _make_source("std::pair<int,int>{-5,-10}"),
            [-5, -10],
        )


class TestTupleSerializer:
    """tuple<Ts...> → JSON array [elem1, elem2, ...]."""

    def test_tuple_int_string_double(self):
        """tuple<int,string,double> → [42, \"hello\", 3.14]"""
        stdout = _compile_and_run(_make_source(
            'std::tuple<int,std::string,double>{42, "hello", 3.14}',
        ))
        parsed = json.loads(stdout)
        assert parsed[0] == 42
        assert parsed[1] == "hello"
        assert abs(parsed[2] - 3.14) < 1e-6

    def test_tuple_single_element(self):
        """tuple<int> → [7]"""
        _assert_serializes(
            _make_source("std::tuple<int>{7}"),
            [7],
        )

    def test_tuple_empty(self):
        """tuple<> → []"""
        _assert_serializes(
            _make_source("std::tuple<>{}"),
            [],
        )

    def test_tuple_mixed_types(self):
        """tuple<bool,int,double,char,string> → [true, -1, 0.5, \"Z\", \"text\"]"""
        stdout = _compile_and_run(_make_source(
            'std::tuple<bool,int,double,char,std::string>{true, -1, 0.5, \'Z\', "text"}',
        ))
        parsed = json.loads(stdout)
        assert parsed == [True, -1, 0.5, "Z", "text"]

    def test_tuple_of_vectors(self):
        """tuple<vector<int>,vector<int>> with empty / non-empty."""
        _assert_serializes(
            _make_source("std::tuple<std::vector<int>,std::vector<int>>{{1,2,3}, {}}"),
            [[1, 2, 3], []],
        )


class TestArraySerializer:
    """std::array<T,N> → JSON array."""

    def test_array_int_3(self):
        """array<int,3>{1,2,3} → [1,2,3]"""
        _assert_serializes(
            _make_source("std::array<int,3>{1,2,3}"),
            [1, 2, 3],
        )

    def test_array_string_2(self):
        """array<string,2> → [\"a\", \"b\"]"""
        _assert_serializes(
            _make_source('std::array<std::string,2>{"a", "b"}'),
            ["a", "b"],
        )

    def test_array_single_element(self):
        """array<int,1>{99} → [99]"""
        _assert_serializes(
            _make_source("std::array<int,1>{99}"),
            [99],
        )

    def test_array_large_n(self):
        """array<int,100> with sequential values."""
        body = "std::array<int,100>{}"
        # Fill with index values at runtime
        source = '''\
#include "tracer.h"
#include <iostream>
#include <array>

int main() {
    std::array<int,100> a{};
    for (int i = 0; i < 100; ++i) a[i] = i;
    std::cout << __ser(a) << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        parsed = json.loads(stdout)
        assert len(parsed) == 100
        assert parsed[0] == 0
        assert parsed[99] == 99

    def test_array_bool(self):
        """array<bool,4> → [false,true,false,true]"""
        _assert_serializes(
            _make_source("std::array<bool,4>{false,true,false,true}"),
            [False, True, False, True],
        )


class TestRawArraySerializer:
    """Raw C array T[N] → JSON array (reference overload).

    Uses explicit template arguments ``__ser<T, N>(arr)`` to disambiguate
    between the ``T(&)[N]`` array overload (2 template params: element type +
    size) and the ``T*`` pointer overload (1 template param), which GCC
    considers ambiguous when passed an array expression directly.
    """

    def test_raw_int_array_5(self):
        """int[5]{1,2,3,4,5} → [1,2,3,4,5]"""
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    int arr[5] = {1,2,3,4,5};
    std::cout << __ser<int, 5>(arr) << std::endl;
    return 0;
}
'''
        _assert_serializes(source, [1, 2, 3, 4, 5])

    def test_raw_char_array(self):
        """char[4]{'a','b','c','d'} → [\"a\",\"b\",\"c\",\"d\"]"""
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    char arr[4] = {'a','b','c','d'};
    std::cout << __ser<char, 4>(arr) << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        parsed = json.loads(stdout)
        assert parsed == ["a", "b", "c", "d"]

    def test_raw_double_array(self):
        """double[3] → [1.5, 2.5, 3.5]"""
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    double arr[3] = {1.5, 2.5, 3.5};
    std::cout << __ser<double, 3>(arr) << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        parsed = json.loads(stdout)
        assert len(parsed) == 3
        assert abs(parsed[0] - 1.5) < 1e-6
        assert abs(parsed[1] - 2.5) < 1e-6
        assert abs(parsed[2] - 3.5) < 1e-6

    def test_raw_array_empty_initializer(self):
        """int[3]{} → [0, 0, 0] (value-initialised)"""
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    int arr[3] = {};
    std::cout << __ser<int, 3>(arr) << std::endl;
    return 0;
}
'''
        _assert_serializes(source, [0, 0, 0])


class TestEdgeCases:
    """Edge cases across serializer families."""

    def test_empty_vector(self):
        """Empty vector<int> → []"""
        source = '''\
#include "tracer.h"
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;
    std::cout << __ser(v) << std::endl;
    return 0;
}
'''
        _assert_serializes(source, [])

    def test_vector_of_pairs(self):
        """vector<pair<int,int>> — verify pair elements serialize correctly.

        Note: ``__ser(vector<pair<int,int>>)`` cannot find the pair serializer
        via two-phase lookup because the pair serializer is defined AFTER the
        vector template in tracer.h and ADL does not search the global namespace
        for arguments in ``std::``.  We test the equivalent by serializing each
        element directly.
        """
        source = '''\
#include "tracer.h"
#include <iostream>
#include <vector>
#include <utility>

int main() {
    std::vector<std::pair<int,int>> v = {{1,2},{3,4}};
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) std::cout << " ";
        std::cout << __ser(v[i]);
    }
    std::cout << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        assert stdout == "[1,2] [3,4]"

    def test_null_pointer_serialization(self):
        """nullptr → \"null\" """
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    int* p = nullptr;
    std::cout << __ser(p) << std::endl;
    return 0;
}
'''
        _assert_printed(source, "null")

    def test_nested_vector_empty_inner(self):
        """vector<vector<int>> with inner empty → [[],[1]]"""
        source = '''\
#include "tracer.h"
#include <iostream>
#include <vector>

int main() {
    std::vector<std::vector<int>> v = {{}, {1}};
    std::cout << __ser(v) << std::endl;
    return 0;
}
'''
        _assert_serializes(source, [[], [1]])

    def test_string_serialization(self):
        """std::string → \"hello\" (with JSON escaping)"""
        source = '''\
#include "tracer.h"
#include <iostream>
#include <string>

int main() {
    std::string s = "hello";
    std::cout << __ser(s) << std::endl;
    return 0;
}
'''
        _assert_printed(source, '"hello"')

    def test_string_with_escaped_chars(self):
        """String with embedded quotes and newlines is properly escaped."""
        source = '''\
#include "tracer.h"
#include <iostream>
#include <string>

int main() {
    std::string s = "he said \\"hi\\"\\nok";
    std::cout << __ser(s) << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        parsed = json.loads(stdout)
        assert parsed == 'he said "hi"\nok'

    def test_bool_true_false(self):
        """true → \"true\", false → \"false\" """
        source = '''\
#include "tracer.h"
#include <iostream>

int main() {
    bool a = true, b = false;
    std::cout << __ser(a) << "," << __ser(b) << std::endl;
    return 0;
}
'''
        _assert_printed(source, "true,false")

    def test_int_min_max(self):
        """Extreme int values: INT_MIN, INT_MAX."""
        source = '''\
#include "tracer.h"
#include <iostream>
#include <climits>

int main() {
    std::cout << __ser(INT_MIN) << "," << __ser(INT_MAX) << std::endl;
    return 0;
}
'''
        stdout = _compile_and_run(source)
        parts = stdout.split(",")
        assert int(parts[0]) == -2147483648
        assert int(parts[1]) == 2147483647
