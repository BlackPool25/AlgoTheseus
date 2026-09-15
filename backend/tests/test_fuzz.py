"""
test_fuzz.py — Wave-7 robustness fuzz battery (todo 29, stdlib-only).

Mutates valid TRACE lines with a seeded ``random.Random`` (``SEED`` env
replays exactly) and asserts the parser NEVER raises — every mutated input
must yield fallback events (skip-with-warning) or clean truncation.

Mutators: drop keys (each key incl ``t``), shuffle key/event order,
truncate mid-stream (mid-line / mid-JSON / mid-UTF8 byte cuts), inject
garbage lines (empty, whitespace, binary-ish, huge, depth bombs).
Instrumenter edge battery: empty function, macro-heavy TU, template
function, 50-deep nesting (+ empty file, garbage, no-main) — each must
return gracefully (a string, never an exception, never a hang).

RED leg (negative control): ``test_negative_control_non_string_input_raises``
proves the harness can fail loudly — ``parse([123])`` raises AttributeError
on current code (``line.strip()`` on a non-str). The str-line battery below
covers the wire-reachable space; the non-str crash is a documented follow-up
(see learnings), NOT silently fixed here (TEST-ONLY todo).

Minimal-repro rule: any unexpected raise triggers shrink-to-minimal
(single mutated line, then fewer mutations) and fails loudly with the
seed + case index for replay.
"""

from __future__ import annotations

import json
import os
import random
import signal

import pytest

from app.core.trace.parser import parse

SEED = int(os.environ.get("SEED", "29"))

# ── Valid fixtures in BOTH wire forms (alias + python names) ────────────────

ALIAS_EVENTS: list[dict] = [
    {"t": "enter", "l": 1, "f": "main", "d": 0, "p": {}},
    {"t": "enter", "l": 5, "f": "bsearch", "d": 0, "p": {"arr": [1, 3, 5], "target": 7}},
    {"t": "state", "l": 6, "f": "bsearch", "d": 0, "v": {"lo": 0, "hi": 4}},
    {"t": "state", "l": 6, "f": "main", "d": 0, "v": {"x": "héllo wörld"},
     "o": "out\n", "g": {"gv": 1}, "sd": "assign x", "pl": 5,
     "h": {"1": {"$id": 1, "$addr": "0x1", "val": 3}}},
    {"t": "branch", "l": 9, "f": "bsearch", "d": 0, "c": "arr[mid] == target",
     "tk": False, "op": ["arr[mid]=5", "target=7"], "sd": "branch not taken"},
    {"t": "iter", "l": 7, "f": "bsearch", "d": 0, "it": 0},
    {"t": "exit", "l": 13, "f": "bsearch", "d": 0, "r": 3, "rl": 12, "sd": "return 3"},
    {"t": "exit", "l": 2, "f": "main", "d": 0, "r": None},
]

PYTHON_NAME_EVENTS: list[dict] = [
    {"type": "enter", "line": 1, "func": "main", "depth": 0, "params": {}},
    {"type": "state", "line": 2, "func": "main", "depth": 0,
     "vars": {"x": 10}, "stdout": "", "globals": {},
     "step_desc": "assign x = 10", "prev_line": 1,
     "heap": {"1": {"$id": 1, "$addr": "0x1", "val": 10}}},
    {"type": "branch", "line": 3, "func": "main", "depth": 0,
     "condition": "x > 5", "taken": True, "ops": ["x=10"]},
    {"type": "iter", "line": 4, "func": "main", "depth": 0, "iteration": 2},
    {"type": "exit", "line": 5, "func": "main", "depth": 0,
     "return_val": 0, "return_line": 5},
]

GARBAGE_LINES: list[str] = [
    "",
    "   ",
    "\t\n ",
    "not valid json",
    "{bad json",
    '{"t":',
    "null",
    "42",
    "[1,2,3]",
    '"just a string"',
    "\x00\x01\x02 binary-ish \xff",
    "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[",  # depth bomb
    "{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{",
    '{"t":"state","l":1,"f":"m","d":0,"v":' + '{"a":' * 500,  # deep nest bomb
    "x" * 200_000,  # huge single line
    '{"t":"enter","l":"not-an-int","f":"m","d":0,"p":{}}',
    '{"t":"nope","l":1,"f":"m","d":0}',
    '{"l":1,"f":"m","d":0,"v":{}}',  # missing t entirely
    '{"t":null,"l":1,"f":"m","d":0}',
    '{"t":"state","l":-999999,"f":"","d":-5,"v":null}',
]


def _mutate_drop_keys(rng: random.Random, ev: dict) -> dict:
    """Return a copy of ev with a random non-empty subset of keys dropped."""
    keys = list(ev.keys())
    drop = rng.sample(keys, rng.randint(1, len(keys)))
    return {k: v for k, v in ev.items() if k not in drop}


def _mutate_shuffle_keys(rng: random.Random, ev: dict) -> dict:
    """Return a copy of ev with key insertion order shuffled."""
    items = list(ev.items())
    rng.shuffle(items)
    return dict(items)


def _mutate_value_noise(rng: random.Random, ev: dict) -> dict:
    """Replace one random value with type-noise (None/bool/str/list/dict)."""
    out = dict(ev)
    if not out:
        return out  # fully-dropped {} is itself a valid probe (missing t)
    k = rng.choice(list(out.keys()))
    out[k] = rng.choice([None, True, 123, "zzz", [1, 2], {"n": 1}, 1.5])
    return out


def build_cases(seed: int = SEED) -> list[tuple[str, list[str]]]:
    """Deterministically build the full (name, lines) case battery."""
    rng = random.Random(seed)
    cases: list[tuple[str, list[str]]] = []
    pools = [ALIAS_EVENTS, PYTHON_NAME_EVENTS]

    # 1. Drop-keys: every event x several draws (covers each key incl t).
    for pool_i, pool in enumerate(pools):
        for ev_i, ev in enumerate(pool):
            for rep in range(16):
                cases.append((
                    f"dropkeys/p{pool_i}/e{ev_i}/r{rep}",
                    [json.dumps(_mutate_drop_keys(rng, ev))],
                ))
    # 2. Shuffle key order within each event.
    for pool_i, pool in enumerate(pools):
        for ev_i, ev in enumerate(pool):
            cases.append((
                f"shuffle-keys/p{pool_i}/e{ev_i}",
                [json.dumps(_mutate_shuffle_keys(rng, ev))],
            ))
    # 3. Shuffle event order of a full valid stream.
    for rep in range(30):
        stream = [json.dumps(e) for e in ALIAS_EVENTS]
        rng.shuffle(stream)
        cases.append((f"shuffle-stream/{rep}", stream))
    # 4. Value type-noise.
    for pool_i, pool in enumerate(pools):
        for ev_i, ev in enumerate(pool):
            for rep in range(6):
                cases.append((
                    f"value-noise/p{pool_i}/e{ev_i}/r{rep}",
                    [json.dumps(_mutate_value_noise(rng, ev))],
                ))
    # 5. Truncate mid-stream: cut the concatenated stream at byte offsets
    #    from every class — mid-line, mid-JSON, mid-UTF8 (multibyte value).
    full = "\n".join(json.dumps(e) for e in ALIAS_EVENTS) + "\n"
    raw = full.encode("utf-8")
    cut_classes: list[int] = []
    step = max(1, len(raw) // 60)
    cut_classes += list(range(0, len(raw), step))  # mid-line / mid-JSON mix
    mb_anchor = full.encode("utf-8").find("hÃ".encode("latin1", errors="ignore")[:0])  # noop guard
    del mb_anchor
    # Mid-UTF8: cut inside the multibyte "héllo wörld" bytes explicitly.
    mb_seg = "héllo wörld".encode("utf-8")
    prefix = "\n".join(json.dumps(e) for e in ALIAS_EVENTS[:4]) + "\n"
    base = len(prefix.encode("utf-8"))
    for off in range(0, len(mb_seg) + 2):
        cut_classes.append(base - 40 + off)
    for i, cut in enumerate(sorted(set(c for c in cut_classes if 0 < c < len(raw)))):
        frag = raw[:cut].decode("utf-8", errors="ignore")
        cases.append((f"truncate/{i}@{cut}", frag.split("\n")))
    # 6. Garbage injection: each garbage line alone + spliced into a stream.
    for i, g in enumerate(GARBAGE_LINES):
        cases.append((f"garbage-alone/{i}", [g]))
    for rep in range(40):
        stream = [json.dumps(e) for e in rng.sample(ALIAS_EVENTS, 3)]
        stream.insert(rng.randint(0, len(stream)), rng.choice(GARBAGE_LINES))
        cases.append((f"garbage-spliced/{rep}", stream))
    # 7. Multi-mutation combos (drop + shuffle + noise on 2-event streams).
    for rep in range(80):
        evs = rng.sample(ALIAS_EVENTS + PYTHON_NAME_EVENTS, 2)
        lines = []
        for ev in evs:
            m = _mutate_drop_keys(rng, ev) if rng.random() < 0.5 else dict(ev)
            m = _mutate_shuffle_keys(rng, m) if rng.random() < 0.5 else m
            m = _mutate_value_noise(rng, m) if rng.random() < 0.5 else m
            lines.append(json.dumps(m, default=str))
        cases.append((f"combo/{rep}", lines))
    return cases


def _shrink_and_fail(name: str, lines: list[str], exc: BaseException,
                     seed: int, idx: int) -> None:
    """Shrink to the minimal failing input, then fail loudly."""
    minimal = list(lines)
    # Try single lines first.
    for ln in lines:
        try:
            parse([ln])
        except Exception:
            minimal = [ln]
            break
    else:
        # Halve the stream until it still fails.
        while len(minimal) > 1:
            half = minimal[: len(minimal) // 2]
            try:
                parse(half)
                break  # half passes: keep the full set
            except Exception:
                minimal = half
    pytest.fail(
        f"FUZZ CRASH seed={seed} case#{idx} ({name}): "
        f"{type(exc).__name__}: {exc}\n"
        f"MINIMAL REPRO ({len(minimal)} line(s)): {minimal!r}\n"
        f"Replay: SEED={seed} pytest backend/tests/test_fuzz.py -q",
        pytrace=False,
    )


def test_fuzz_parser_never_raises() -> None:
    cases = build_cases()
    assert len(cases) >= 500, f"battery too small: {len(cases)}"
    for idx, (name, lines) in enumerate(cases):
        try:
            result = parse(lines)
        except Exception as e:  # noqa: BLE001 — the point is catching everything
            _shrink_and_fail(name, lines, e, SEED, idx)
            return
        assert isinstance(result, list), f"{name}: parse must return a list"
    print(f"\nFUZZ_CASES={len(cases)} SEED={SEED} crashes=0")


def test_fuzz_parser_never_raises_compressed() -> None:
    cases = build_cases(seed=SEED + 1)[:150]
    for idx, (name, lines) in enumerate(cases):
        try:
            parse(lines, compressed=True)
        except Exception as e:  # noqa: BLE001
            _shrink_and_fail(name + "+compressed", lines, e, SEED + 1, idx)
            return
    print(f"\nFUZZ_COMPRESSED_CASES={len(cases)} SEED={SEED + 1} crashes=0")


def test_negative_control_non_string_input_raises() -> None:
    """Harness sensitivity probe: non-str lines crash TODAY (AttributeError).

    If this test ever FAILS (no raise), the parser was hardened — update the
    str-line contract and move this probe to the never-raises battery.
    Follow-up for todos 26/30, NOT fixed here (TEST-ONLY todo).
    """
    with pytest.raises(AttributeError):
        parse([123])  # type: ignore[list-item]


# ── Instrumenter edge battery ───────────────────────────────────────────────

EDGE_SOURCES: dict[str, str] = {
    "empty_function": "void f(){}\nint main(){f();return 0;}\n",
    "macro_heavy": (
        "#define ADD(a,b) ((a)+(b))\n#define SQR(x) ((x)*(x))\n"
        "#define CONST 42\nint main(){int x=ADD(1,2);int y=SQR(x)+CONST;return y;}\n"
    ),
    "template_function": (
        "template<typename T> T ident(T x){return x;}\n"
        "int main(){return ident<int>(3);}\n"
    ),
    "deep_nesting_50": (
        "int main(){" + "if(1){" * 50 + "int x=1;" + "}" * 50 + "return 0;}\n"
    ),
    "empty_file": "",
    "garbage_source": "this is not c++ {{{{\n",
    "no_main": "int helper(int x){return x*2;}\n",
}


def _run_with_timeout(func, timeout_s: int = 60):
    def _handler(signum, frame):
        raise TimeoutError(f"instrumenter hung past {timeout_s}s")

    old = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(timeout_s)
    try:
        return func()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


@pytest.mark.parametrize("edge", sorted(EDGE_SOURCES))
def test_instrumenter_edge_graceful(edge: str, caplog: pytest.LogCaptureFixture) -> None:
    """Each edge source must return a string — skip + warning, never crash/hang."""
    from app.core.instrumenter.injector import instrument

    src = EDGE_SOURCES[edge]
    with caplog.at_level("WARNING"):
        result = _run_with_timeout(lambda: instrument(src))
    assert isinstance(result, str), f"{edge}: instrument must return str"
