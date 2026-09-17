from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from pydantic import BaseModel

CASES = [
    (
        "hello world",
        '#include <iostream>\nint main() { std::cout << "hello world"; return 0; }',
        "hello world",
        "",
    ),
    ("empty main", "int main() {}", "", ""),
    (
        "structured bindings",
        "#include <iostream>\n#include <utility>\nint main() { auto [a,b] = std::make_pair(2,3); std::cout << a+b; return 0; }",
        "5",
        "",
    ),
    (
        "range-for value",
        "#include <iostream>\nint main() { int a[]={1,2,3}; int sum=0; for (int x:a) { sum+=x; } std::cout << sum; return 0; }",
        "6",
        "",
    ),
    (
        "range-for ref mutation",
        "#include <iostream>\nint main() { int a[]={1,2,3}; for (int &x:a) { x*=2; } std::cout << a[0] << a[1] << a[2]; return 0; }",
        "246",
        "",
    ),
    (
        "lambda value capture",
        "#include <iostream>\nint main() { int x=3; auto f=[x](int y) { return x+y; }; x=9; std::cout << f(2); return 0; }",
        "5",
        "",
    ),
    (
        "lambda ref capture",
        "#include <iostream>\nint main() { int x=3; auto f=[&x]() { x+=2; }; f(); std::cout << x; return 0; }",
        "5",
        "",
    ),
    (
        "lambda sort comparator",
        "#include <iostream>\n#include <algorithm>\nint main() { int a[]={2,1,3}; std::sort(a,a+3,[](int x,int y) { return x>y; }); std::cout << a[0] << a[1] << a[2]; return 0; }",
        "321",
        "",
    ),
    (
        "function overloading",
        '#include <iostream>\nint f(int x) { return x+1; }\ndouble f(double x) { return x+0.5; }\nint main() { std::cout << f(2) << " " << f(2.0); return 0; }',
        "3 2.5",
        "",
    ),
    (
        "switch fallthrough",
        "#include <iostream>\nint main() { int x=1; int sum=0; switch(x) { case 1: sum+=2; [[fallthrough]]; case 2: sum+=3; break; default: sum=9; } std::cout << sum; return 0; }",
        "5",
        "",
    ),
    (
        "do-while",
        "#include <iostream>\nint main() { int n=0; do { ++n; } while(n<3); std::cout << n; return 0; }",
        "3",
        "",
    ),
    (
        "break continue early-return",
        "#include <iostream>\nint f() { int sum=0; for(int i=0;i<10;++i) { if(i==1) continue; if(i==4) break; sum+=i; } if(sum==5) return sum; return -1; }\nint main() { std::cout << f(); return 0; }",
        "5",
        "",
    ),
    (
        "globals read written",
        "#include <iostream>\nint g=2;\nvoid bump() { g+=3; }\nint main() { bump(); std::cout << g; return 0; }",
        "5",
        "",
    ),
    (
        "const ref params",
        '#include <iostream>\nint f(const int &x,int &y) { y+=x; return y; }\nint main() { const int x=2; int y=3; int z=f(x,y); std::cout << z << " " << y; return 0; }',
        "5 5",
        "",
    ),
    (
        "new delete",
        '#include <iostream>\nint main() { int *p=new int(7); int x=*p; delete p; int *a=new int[2]{2,3}; int sum=a[0]+a[1]; delete[] a; std::cout << x << " " << sum; return 0; }',
        "7 5",
        "",
    ),
    (
        "long long double char bool edges",
        '#include <iostream>\n#include <limits>\nint main() { long long lo=std::numeric_limits<long long>::min(); long long hi=std::numeric_limits<long long>::max(); double d=-0.0; double tiny=std::numeric_limits<double>::min(); char c=\'\\0\'; char z=\'\\x7f\'; bool yes=true; bool no=false; std::cout << lo << " " << hi << " " << d << " " << (tiny>0) << " " << int(c) << " " << int(z) << " " << yes << " " << no; return 0; }',
        "-9223372036854775808 9223372036854775807 -0 1 0 127 1 0",
        "",
    ),
    (
        "cin sum raw_stdin",
        "#include <iostream>\nint main() { int n; std::cin >> n; long long sum=0; for(int i=0;i<n;++i) { int x; std::cin >> x; sum+=x; } std::cout << sum; return 0; }",
        "15",
        "5\n1 2 3 4 5\n",
    ),
    (
        "operator overloading",
        "#include <iostream>\nstruct Box { int value; Box operator+(const Box &b) const { return Box{value+b.value}; } };\nint main() { Box a{2}; Box b{3}; Box c=a+b; std::cout << c.value; return 0; }",
        "5",
        "",
    ),
    (
        "exceptions try catch",
        '#include <iostream>\n#include <stdexcept>\nint main() { int x=0; try { throw std::runtime_error("boom"); } catch(const std::exception &e) { x=7; } std::cout << x; return 0; }',
        "7",
        "",
    ),
    (
        "template function known limitation",
        "#include <iostream>\ntemplate<typename T> T add(T a,T b) { T c=a+b; return c; }\nint main() { int x=add<int>(2,3); std::cout << x; return 0; }",
        "5",
        "",
    ),
    (
        "define line-shifting macro",
        "#include <iostream>\n#define BUMP(x) do { \\\n ++x; \\\n x+=2; \\\n} while(0)\nint main() {\n int x=2;\n BUMP(x);\n std::cout << x;\n return 0;\n}",
        "5",
        "",
    ),
    (
        "deep recursion 2000",
        "#include <iostream>\nint recurse(int n) { if(n==0) return 0; return 1+recurse(n-1); }\nint main() { std::cout << recurse(2000); return 0; }",
        "2000",
        "",
    ),
    ("infinite loop 5s guard", "int main() { while(true) {} }", "", ""),
    (
        "range-for value vector",
        "#include <iostream>\n#include <vector>\nint main() { std::vector<int> a{1,2,3}; int sum=0; for(int x:a) { sum+=x; } std::cout << sum; return 0; }",
        "6",
        "",
    ),
    (
        "range-for ref mutation vector",
        "#include <iostream>\n#include <vector>\nint main() { std::vector<int> a{1,2,3}; for(int &x:a) { x*=2; } std::cout << a[0] << a[1] << a[2]; return 0; }",
        "246",
        "",
    ),
    (
        "lambda sort comparator vector",
        "#include <iostream>\n#include <algorithm>\n#include <vector>\nint main() { std::vector<int> a{2,1,3}; std::sort(a.begin(),a.end(),[](int x,int y) { return x>y; }); std::cout << a[0] << a[1] << a[2]; return 0; }",
        "321",
        "",
    ),
]


class Report(BaseModel):
    name: str
    outcome: str
    message: str
    seconds: float = 0
    stdout: str = ""
    raw: int = 0
    parsed: int = 0
    cache_hit: bool = False
    max_depth: int = 0
    functions: list[str] = []
    lines: list[int] = []
    timed_out: bool = False
    truncated: bool = False
    warnings: list[str] = []


async def resolve_case(index: int) -> Report:
    from app.api.routes.execute import _resolve, parse_trace
    from app.core.executor import subprocess_runner
    from app.models.request import ExecuteRequest

    name, code, expected, stdin = CASES[index]
    if name == "infinite loop 5s guard":
        subprocess_runner.EXECUTION_TIMEOUT_SECONDS = 5
    resolved = await _resolve(ExecuteRequest(code=code, raw_stdin=stdin), kind="single")
    report = Report(
        name=name,
        outcome="GRACEFUL-FAIL",
        message="",
        cache_hit=resolved.cache_hit,
        warnings=list(resolved.warnings),
    )
    for stage in ("input_error", "instrumentation_error", "sandbox_error"):
        error = getattr(resolved, stage)
        if error:
            report.message = f"{stage}: {error}"
            return report
    result = resolved.run_result
    if result is None:
        report.message = "No RunResult and no error returned"
        return report
    if result.compile_error:
        report.message = "compile_error: " + result.compile_error
        return report
    events = parse_trace(result.trace_raw)
    report.stdout = result.stdout
    report.raw = len(result.trace_raw)
    report.parsed = len(events)
    report.timed_out = result.timed_out
    report.truncated = result.truncated
    report.max_depth = max((event.depth for event in events), default=0)
    report.functions = sorted({event.func for event in events})
    report.lines = sorted({event.line for event in events})
    report.message = f"exit_code={result.exit_code}; timed_out={result.timed_out}; truncated={result.truncated}; stderr_clean={result.stderr_clean!r}"
    if result.exit_code != 0 or result.timed_out or result.truncated:
        return report
    if result.stdout != expected or not events or len(events) != len(result.trace_raw):
        report.message += f"; VALIDATION FAILURE: expected stdout={expected!r}; raw={report.raw}; parsed={report.parsed}"
        return report
    report.outcome = "PASS"
    return report


def run_case(index: int) -> Report:
    env = dict(
        os.environ,
        SANDBOX_MODE="subprocess",
        CACHE_DIR="/tmp/at-sweep-c",
        PYTHONDONTWRITEBYTECODE="1",
    )
    root = Path(__file__).resolve().parents[1]
    env["PYTHONPATH"] = str(root)
    started = time.monotonic()
    with subprocess.Popen(
        [sys.executable, "-B", str(Path(__file__).resolve()), "--case", str(index)],
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=45)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)
            return Report(
                name=CASES[index][0],
                outcome="HANG",
                message="Sweep hard watchdog fired after 45s; worker process group SIGKILL",
                seconds=time.monotonic() - started,
            )
    if process.returncode != 0:
        return Report(
            name=CASES[index][0],
            outcome="GRACEFUL-FAIL",
            message=f"UNHANDLED worker exit={process.returncode}: {stderr}",
            seconds=time.monotonic() - started,
        )
    report = Report.model_validate_json(stdout)
    report.seconds = round(time.monotonic() - started, 3)
    if stderr:
        report.message += "; worker_stderr=" + stderr
    return report


@pytest.mark.parametrize("index", range(len(CASES)), ids=[case[0] for case in CASES])
def test_sweep_lang(index: int) -> None:
    report = run_case(index)
    print(report.model_dump_json(), flush=True)
    assert report.outcome != "HANG", report.message


def _case_index(name: str) -> int:
    return next(i for i, case in enumerate(CASES) if case[0] == name)


def test_template_skip_warns_loudly() -> None:
    report = run_case(_case_index("template function known limitation"))
    print(report.model_dump_json(), flush=True)
    assert report.outcome == "PASS", report.message
    assert any("add" in warning for warning in report.warnings), (
        f"template skip must name the skipped template: {report.warnings!r}"
    )


def test_infinite_loop_guard_loud() -> None:
    report = run_case(_case_index("infinite loop 5s guard"))
    print(report.model_dump_json(), flush=True)
    assert report.outcome == "GRACEFUL-FAIL", report.message
    assert report.truncated or report.timed_out, (
        f"file-size-guard death must set truncated/timed_out semantics: {report.message}"
    )
    assert "output-size guard" in report.message, (
        f"guard death must name the output-size guard: {report.message}"
    )


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--case":
        print(asyncio.run(resolve_case(int(sys.argv[2]))).model_dump_json(), flush=True)
    else:
        for case_index in range(len(CASES)):
            print(run_case(case_index).model_dump_json(), flush=True)
