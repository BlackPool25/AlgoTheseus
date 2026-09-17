from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import app.api.routes.execute as execute_mod
from app.core.trace import parser
from app.models.request import ExecuteRequest

CASES = (
    ("vector<int>", "vector", """
    std::vector<int> v{1, 2};
    v.push_back(3);
    v[0] = 4;
    std::cout << v[0] << ' ' << v.back() << ' ' << v.size();
    """, "4 3 3"),
    ("vector<string>", "vector", """
    std::vector<std::string> v{"one", "two"};
    v.push_back("three");
    std::cout << v.front() << ' ' << v.back() << ' ' << v.size();
    """, "one three 3"),
    ("deque<int>", "deque", """
    std::deque<int> d{2, 3};
    d.push_front(1);
    d.push_back(4);
    d.pop_front();
    std::cout << d.front() << ' ' << d.back() << ' ' << d.size();
    """, "2 4 3"),
    ("array<int,5>", "array", """
    std::array<int, 5> a{1, 2, 3, 4, 5};
    a[2] = 9;
    std::cout << a.front() << ' ' << a[2] << ' ' << a.back() << ' ' << a.size();
    """, "1 9 5 5"),
    ("stack<int>", "stack", """
    std::stack<int> s;
    s.push(4);
    s.push(9);
    std::cout << s.top() << ' ';
    s.pop();
    std::cout << s.top() << ' ' << s.size();
    """, "9 4 1"),
    ("queue<int>", "queue", """
    std::queue<int> q;
    q.push(4);
    q.push(9);
    std::cout << q.front() << ' ' << q.back() << ' ';
    q.pop();
    std::cout << q.front() << ' ' << q.size();
    """, "4 9 9 1"),
    ("map<string,int>", "map", """
    std::map<std::string, int> m;
    m.insert({"b", 2});
    m.insert({"a", 1});
    auto found = m.find("b");
    std::cout << found->second << ' ';
    for (const auto& entry : m) {
        std::cout << entry.first << ':' << entry.second << ' ';
    }
    """, "2 a:1 b:2 "),
    ("unordered_map<string,int>", "unordered_map", """
    std::unordered_map<std::string, int> m{{"b", 2}, {"a", 1}};
    m.insert({"c", 3});
    int total = 0;
    for (const auto& entry : m) {
        total += entry.second;
    }
    std::cout << m.at("b") << ' ' << m.count("c") << ' ' << total;
    """, "2 1 6"),
    ("set<int>", "set", """
    std::set<int> s{3, 1, 3};
    s.insert(2);
    s.erase(3);
    for (int x : s) {
        std::cout << x << ' ';
    }
    std::cout << s.size();
    """, "1 2 2"),
    ("unordered_set<int>", "unordered_set", """
    std::unordered_set<int> s{3, 1, 3};
    s.insert(2);
    int total = 0;
    for (int x : s) {
        total += x;
    }
    std::cout << s.size() << ' ' << s.count(3) << ' ' << total;
    """, "3 1 6"),
    ("multiset<int>", "set", """
    std::multiset<int> s{2, 1, 2};
    s.insert(2);
    std::cout << s.count(2) << ' ';
    s.erase(s.find(2));
    std::cout << s.count(2) << ' ' << s.size();
    """, "3 2 3"),
    ("priority_queue<int> max", "queue", """
    std::priority_queue<int> q;
    q.push(2);
    q.push(9);
    q.push(4);
    std::cout << q.top() << ' ';
    q.pop();
    std::cout << q.top() << ' ' << q.size();
    """, "9 4 2"),
    ("priority_queue min greater", "queue", """
    std::priority_queue<int, std::vector<int>, std::greater<int>> q;
    q.push(2);
    q.push(9);
    q.push(4);
    std::cout << q.top() << ' ';
    q.pop();
    std::cout << q.top() << ' ' << q.size();
    """, "2 4 2"),
    ("pair<int,string>", "utility", """
    std::pair<int, std::string> p{7, "seven"};
    p.first += 1;
    p.second.append("!");
    std::cout << p.first << ' ' << p.second;
    """, "8 seven!"),
    ("tuple<int,string,double>", "tuple", """
    std::tuple<int, std::string, double> t{3, "pi", 3.5};
    std::get<0>(t) = 4;
    std::cout << std::get<0>(t) << ' ' << std::get<1>(t) << ' ' << std::get<2>(t);
    """, "4 pi 3.5"),
    ("vector<vector<int>>", "vector", """
    std::vector<std::vector<int>> v{{1, 2}, {3}};
    v[1].push_back(4);
    std::cout << v[0][1] << ' ' << v[1].back() << ' ' << v.size();
    """, "2 4 2"),
    ("vector<map<string,int>>", "map", """
    std::vector<std::map<std::string, int>> v{{{"a", 1}}, {{"b", 2}}};
    v[0]["c"] = 3;
    std::cout << v[0].at("a") << ' ' << v[0].at("c") << ' ' << v[1].at("b");
    """, "1 3 2"),
    ("map<string,vector<int>>", "map", """
    std::map<std::string, std::vector<int>> m{{"a", {1, 2}}, {"b", {3}}};
    m["b"].push_back(4);
    std::cout << m.at("a")[1] << ' ' << m.at("b").back() << ' ' << m.size();
    """, "2 4 2"),
    ("raw int[5]", "array", """
    int a[5] = {1, 2, 3, 4, 5};
    a[2] = 9;
    int total = 0;
    for (int x : a) {
        total += x;
    }
    std::cout << a[0] << ' ' << a[2] << ' ' << a[4] << ' ' << total;
    """, "1 9 5 21"),
    ("string append/substr/find", "string", """
    std::string s = "hello";
    s.append(" world");
    std::string part = s.substr(6, 5);
    std::cout << s << '|' << part << '|' << s.find("world");
    """, "hello world|world|6"),
    ("iterator loops", "vector", """
    std::vector<int> v{1, 2, 3};
    for (auto it = v.begin(); it != v.end(); ++it) {
        *it *= 2;
    }
    for (auto it = v.cbegin(); it != v.cend(); ++it) {
        std::cout << *it << ' ';
    }
    """, "2 4 6 "),
    ("emplace vs push", "queue", """
    std::vector<std::string> v;
    v.push_back("xx");
    v.emplace_back(3, 'y');
    std::queue<std::string> q;
    q.push(v.front());
    q.emplace(2, 'z');
    std::cout << v[0] << ' ' << v[1] << ' ' << q.front() << ' ' << q.back();
    """, "xx yyy xx zz"),
)


def _plain_stdout(source: str, binary: Path) -> str:
    """Compile *source* with plain g++ and return its stdout (ground truth)."""
    compile_result = subprocess.run(
        ["g++", "-std=c++17", "-O0", "-g", "-x", "c++", "-", "-o", str(binary)],
        input=source, capture_output=True, text=True, timeout=30,
        check=False,
    )
    assert compile_result.returncode == 0, compile_result.stderr
    run_result = subprocess.run(
        [str(binary)], capture_output=True, text=True, timeout=10, check=False,
    )
    assert run_result.returncode == 0, run_result.stderr
    return run_result.stdout


@pytest.mark.parametrize("case", CASES, ids=[case[0] for case in CASES])
async def test_sweep_containers(
    case: tuple[str, str, str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    name, header, body, expected = case
    source = (
        f"#include <{header}>\n#include <iostream>\n#include <string>\n"
        f"#include <vector>\n#include <functional>\nint main() {{\n{body}\nreturn 0;\n}}\n"
    )
    monkeypatch.setenv("SANDBOX_MODE", "subprocess")
    monkeypatch.setenv("CACHE_DIR", "/tmp/at-sweep-a")
    execute_mod.reset_cache()
    plain = _plain_stdout(source, tmp_path / "plain")
    assert plain == expected, f"plain stdout {plain!r} != {expected!r}"
    try:
        resolved = await execute_mod._resolve(
            ExecuteRequest(code=source, raw_stdin="", compressed=False),
            kind=f"sweep-containers-{uuid4().hex}",
        )
        assert resolved.input_error is None, f"_Resolved.input_error: {resolved.input_error}"
        assert resolved.instrumentation_error is None, (
            f"_Resolved.instrumentation_error: {resolved.instrumentation_error}"
        )
        assert resolved.sandbox_error is None, f"_Resolved.sandbox_error: {resolved.sandbox_error}"
        result = resolved.run_result
        assert result is not None, "_Resolved.run_result is None"
        assert result.compile_error is None, f"RunResult.compile_error: {result.compile_error}"
        assert result.exit_code == 0, f"exit {result.exit_code}: {result.stderr_clean}"
        assert not result.timed_out, "RunResult.timed_out"
        assert not result.truncated, "RunResult.truncated"
        assert result.stdout == plain, f"stdout {result.stdout!r} != {plain!r}"
        assert result.trace_raw, "zero raw traces"
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger=parser.__name__):
            events = parser.parse(result.trace_raw, compressed=False)
        warnings = [r.getMessage() for r in caplog.records if r.name == parser.__name__]
        assert not warnings, "\n".join(warnings)
        assert events, "zero parsed events"
        print(json.dumps({"case": name, "status": "PASS", "stdout": result.stdout,
                          "traces": len(result.trace_raw), "events": len(events)}))
    except Exception as error:
        print(json.dumps({"case": name, "status": "FAIL", "error_class": type(error).__name__,
                          "message": str(error)}))
        raise
