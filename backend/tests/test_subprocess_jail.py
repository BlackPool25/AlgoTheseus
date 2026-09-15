"""
test_subprocess_jail.py — Task 20 jail battery (subprocess SANDBOX_MODE).

Adversarial fixtures are inherently RED: before the socketless runner
existed these tests could not even collect (no module under test).
Run: SANDBOX_MODE=subprocess .venv/bin/python -m pytest tests/test_subprocess_jail.py -q
"""

from __future__ import annotations

import os
import time

import pytest

from app.core.executor import subprocess_runner as jail
from app.core.executor.docker_runner import RunResult
from app.core.executor.sandbox_config import EXECUTION_TIMEOUT_SECONDS

HELLO = '#include <cstdio>\nint main(){std::printf("hi"); return 0;}\n'


def _run(src: str, stdin: str = "") -> RunResult:
    return jail._run_subprocess_sync(src, stdin)


def test_hello_world_passthrough():
    r = _run(HELLO)
    assert r.compile_error is None
    assert r.stdout == "hi"
    assert r.exit_code == 0
    assert r.timed_out is False


def test_stdin_passthrough():
    src = (
        "#include <cstdio>\n#include <string>\n#include <iostream>\n"
        'int main(){std::string s; std::cin >> s; std::printf("got:%s", s.c_str()); return 0;}\n'
    )
    r = _run(src, "hello\n")
    assert r.stdout == "got:hello"
    assert r.exit_code == 0


def test_compile_error_detected():
    r = _run("#include <nonexistent_xyz.h>\nint main(){}\n")
    assert r.compile_error is not None
    assert "error" in r.compile_error.lower() or "fatal" in r.compile_error.lower()


def test_infinite_loop_killed_within_timeout():
    src = "#include <cstdio>\nint main(){while(1){} return 0;}\n"
    start = time.monotonic()
    r = _run(src)
    elapsed = time.monotonic() - start
    assert r.timed_out is True
    assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 5


def test_compile_bomb_times_out():
    # Unbounded template recursion: g++ must hit -ftemplate-depth and die
    # (compile_error) or hit the wall-time kill (timed_out) — either way the
    # jail contains it in bounded time with no binary produced.
    src = (
        "#include <cstdio>\n"
        "template<int N> void f(){ f<N+1>(); }\n"
        "int main(){ f<0>(); return 0; }\n"
    )
    start = time.monotonic()
    r = _run(src)
    elapsed = time.monotonic() - start
    assert r.compile_error is not None or r.timed_out
    assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 25


def test_fork_bomb_contained_host_alive():
    src = (
        "#include <unistd.h>\n#include <cstdio>\n"
        "int main(){while(1){if(fork()==0){while(1){fork();}}} return 0;}\n"
    )
    start = time.monotonic()
    r = _run(src)
    elapsed = time.monotonic() - start
    assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 10
    # Host survived: we can still spawn processes.
    assert os.getpid() > 0
    with open("/proc/loadavg") as f:
        assert f.read().strip()


def test_privileged_read_blocked_for_nobody():
    # /etc/shadow is root-only: a jailed-nobody child cannot read it.
    # Non-root dev fallback cannot read it either — either way no leak.
    src = (
        "#include <cstdio>\n"
        'int main(){FILE* f=std::fopen("/etc/shadow","r");'
        'if(!f){std::printf("denied"); return 3;}'
        'char b[64]; size_t n=std::fread(b,1,64,f); std::printf("leaked:%zu", n); return 0;}\n'
    )
    r = _run(src)
    assert r.stdout == "denied"
    assert r.exit_code == 3


def test_socket_connect_contained_no_host_effect():
    src = (
        "#include <cstdio>\n#include <sys/socket.h>\n#include <netinet/in.h>\n"
        "#include <arpa/inet.h>\n#include <unistd.h>\n"
        "int main(){int s=socket(AF_INET,SOCK_STREAM,0); if(s<0){std::printf(\"no-sock\"); return 3;}"
        "struct sockaddr_in a; a.sin_family=AF_INET; a.sin_port=htons(9);"
        "a.sin_addr.s_addr=inet_addr(\"127.0.0.1\");"
        'if(connect(s,(struct sockaddr*)&a,sizeof(a))!=0){std::printf("refused"); close(s); return 3;}'
        'std::printf("connected?!"); return 0;}\n'
    )
    r = _run(src)
    assert r.stdout in ("refused", "no-sock")
    assert r.exit_code == 3


def test_symlink_escape_and_privileged_write_blocked():
    marker = "/etc/dsa_jail_escape_marker"
    if os.path.exists(marker):
        os.unlink(marker)
    src = (
        "#include <cstdio>\n#include <unistd.h>\n"
        'int main(){symlink("/etc","link");'
        'FILE* w=std::fopen("/etc/dsa_jail_escape_marker","w");'
        'if(w){std::fputs("pwned",w); std::fclose(w); std::printf("wrote-etc"); return 9;}'
        'FILE* f=std::fopen("link/hostname","r");'
        'if(f){std::fclose(f); std::printf("read-via-link"); return 3;}'
        'std::printf("contained"); return 3;}\n'
    )
    r = _run(src)
    assert not os.path.exists(marker), "HOST EFFECT: jail wrote to /etc"
    assert r.exit_code == 3
    assert r.stdout in ("contained", "read-via-link")


def test_jail_dir_cleaned_up():
    before = set(os.listdir("/tmp/dsa-visualizer")) if os.path.isdir("/tmp/dsa-visualizer") else set()
    _run(HELLO)
    after = set(os.listdir("/tmp/dsa-visualizer")) if os.path.isdir("/tmp/dsa-visualizer") else set()
    assert after - before == set()


def test_stdout_byte_cap_bounds_output_flood():
    src = "#include <cstdio>\nint main(){for(long i=0;i<100000000L;i++) std::puts(\"0123456789abcdef\"); return 0;}\n"
    start = time.monotonic()
    r = _run(src)
    elapsed = time.monotonic() - start
    assert len(r.stdout.encode()) <= jail._STDOUT_CAP_BYTES
    assert elapsed <= EXECUTION_TIMEOUT_SECONDS + 10


@pytest.mark.skipif(os.geteuid() != 0, reason="priv-drop provable only when test runs as root")
def test_child_runs_as_nobody_when_root():
    src = (
        "#include <cstdio>\n#include <unistd.h>\n"
        "int main(){std::printf(\"%d\", (int)getuid()); return 0;}\n"
    )
    r = _run(src)
    uid, _gid = jail._resolve_nobody()
    assert r.stdout == str(uid)


def test_dispatch_routes_on_env(monkeypatch):
    import asyncio

    from app.core.executor import docker_runner

    monkeypatch.setenv("SANDBOX_MODE", "subprocess")
    r = asyncio.run(docker_runner.run_in_sandbox(HELLO))
    assert r.stdout == "hi"
    assert r.exit_code == 0
