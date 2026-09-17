from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

import pytest

from app.core.trace import parser
from tests.test_serializers import TRACER_H, _compile_and_run


def test_const_array_pointer_elements_and_cstrings() -> None:
    source = r"""
#include "tracer.h"
struct Node { int value; };
int main() {
    const int values[5] = {1,2,3,4,5};
    Node* const children[26] = {};
    const char* text = "hello";
    char mutable_text[] = {'a', '\0'};
    const char letters[] = {'x', 'y'};
    std::cout << "{" << __vars_build("values", values, "children", children,
        "text", text, "chars", mutable_text, "letters", letters) << "}";
}
"""
    assert json.loads(_compile_and_run(source)) == {
        "values": [1, 2, 3, 4, 5],
        "children": [None] * 26,
        "text": "hello",
        "chars": ["a", "\0"],
        "letters": ["x", "y"],
    }


def test_array_elements_use_adl_and_multidimensional_arrays() -> None:
    source = r"""
#include "tracer.h"
struct Node { int value; };
std::string __ser(Node* p) {
    return p ? "{\"value\":" + __ser(p->value) + "}" : "null";
}
int main() {
    Node node{7};
    Node* children[26] = {&node};
    const int matrix[2][2] = {{1,2},{3,4}};
    const char* strings[2] = {"hello", nullptr};
    std::cout << "{" << __vars_build("children", children,
        "matrix", matrix, "strings", strings) << "}";
}
"""
    assert json.loads(_compile_and_run(source)) == {
        "children": [{"value": 7}] + [None] * 25,
        "matrix": [[1, 2], [3, 4]],
        "strings": ["hello", None],
    }


def test_jagged_graph_shape_survives_parser() -> None:
    source = r"""
#include "tracer.h"
int main() {
    std::vector<std::vector<int>> rows{{}, {1}};
    std::cout << "{" << __vars_build("rows", rows) << "}";
}
"""
    wire = _compile_and_run(source)
    events = parser.parse(['{"t":"state","l":1,"f":"main","d":0,"v":' + wire + "}"])
    assert len(events) == 1
    assert events[0].vars == {"rows": {"_type": "graph", "adj": [[], [1]]}}


def test_recursive_map_vector_lookup() -> None:
    source = r"""
#include "tracer.h"
int main() {
    std::vector<std::map<std::string, int>> vm{{{"a",1}}};
    std::map<std::string, std::vector<int>> mv{{"b",{2,3}}};
    std::vector<std::map<std::string, std::vector<std::map<std::string, int>>>> nested{
        {{"c", {{{"d",4}}}}}
    };
    std::vector<std::unordered_map<std::string, std::vector<int>>> unordered{
        {{"e",{5,6}}}
    };
    std::cout << "{" << __vars_build("vm", vm, "mv", mv,
        "nested", nested, "unordered", unordered) << "}";
}
"""
    expected = {
        "vm": [{"a": 1}],
        "mv": {"b": [2, 3]},
        "nested": [{"c": [{"d": 4}]}],
        "unordered": [{"e": [5, 6]}],
    }
    wire = _compile_and_run(source)
    assert json.loads(wire) == expected
    events = parser.parse(['{"t":"state","l":1,"f":"main","d":0,"v":' + wire + "}"])
    assert len(events) == 1
    assert events[0].vars == expected


def test_scalar_edge_exact_trace_bytes(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    source = r"""
#include "tracer.h"
#include <climits>
#include <limits>
#include <locale>
struct Comma : std::numpunct<char> {
    char do_decimal_point() const override { return ','; }
};
int main() {
    std::locale::global(std::locale(std::locale::classic(), new Comma));
    __TRACE_STATE(1, "main", 0, "v", LLONG_MIN);
    __TRACE_STATE(2, "main", 0, "v", LLONG_MAX);
    __TRACE_STATE(3, "main", 0, "v", std::numeric_limits<double>::max());
    __TRACE_STATE(4, "main", 0, "v", std::numeric_limits<double>::lowest());
    __TRACE_STATE(5, "main", 0, "v", std::numeric_limits<double>::infinity());
    __TRACE_STATE(6, "main", 0, "v", -std::numeric_limits<double>::infinity());
    __TRACE_STATE(7, "main", 0, "v", std::numeric_limits<double>::quiet_NaN());
    __TRACE_STATE(8, "main", 0, "v", static_cast<char>(CHAR_MIN));
    __TRACE_STATE(9, "main", 0, "v", static_cast<char>(CHAR_MAX));
    __TRACE_STATE(10, "main", 0, "v", '\0');
    __TRACE_STATE(11, "main", 0, "v", true);
    __TRACE_STATE(12, "main", 0, "v", false);
    __TRACE_STATE(13, "main", 0, "v", std::numeric_limits<double>::denorm_min());
    __TRACE_STATE(14, "main", 0, "v", std::string("\r\b\f\0\x01", 5));
    __TRACE_STATE(15, "main", 0, "v", std::numeric_limits<float>::infinity());
    __TRACE_STATE(16, "main", 0, "v", -0.0);
}
"""
    binary = tmp_path / "edges"
    compiled = subprocess.run(
        [
            "g++",
            "-std=c++17",
            "-fsigned-char",
            "-I",
            str(TRACER_H.parent),
            "-x",
            "c++",
            "-",
            "-o",
            str(binary),
        ],
        input=source,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert compiled.returncode == 0, compiled.stderr
    result = subprocess.run([str(binary)], capture_output=True, check=False, timeout=10)
    assert result.returncode == 0, result.stderr
    values = [
        b"-9223372036854775808",
        b"9223372036854775807",
        b"1.7976931348623157e+308",
        b"-1.7976931348623157e+308",
        b'"Infinity"',
        b'"-Infinity"',
        b'"NaN"',
        b'"\\u0080"',
        b'"\\u007f"',
        b'"\\u0000"',
        b"true",
        b"false",
        b"4.9406564584124654e-324",
        b'"\\r\\b\\f\\u0000\\u0001"',
        b'"Infinity"',
        b"-0",
    ]
    expected = b"".join(
        b'TRACE:{"t":"state","l":'
        + str(i).encode()
        + b',"f":"main","d":0,"v":{"v":'
        + value
        + b'},"o":""}\n'
        for i, value in enumerate(values, 1)
    )
    assert result.stderr == expected
    lines = [line.removeprefix("TRACE:") for line in result.stderr.decode().splitlines()]
    with caplog.at_level(logging.WARNING, logger=parser.__name__):
        events = parser.parse(lines)
    assert len(events) == len(values)
    assert [event.vars["v"] for event in events] == [json.loads(value) for value in values]
    assert not [record for record in caplog.records if record.name == parser.__name__]
