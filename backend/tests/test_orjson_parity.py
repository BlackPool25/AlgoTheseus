"""Wave1 2.2 — ORJSONResponse parity (RED first, GREEN after swap).

Contract:
- app default_response_class is ORJSONResponse
- /execute single + compile-error paths build ORJSONResponse
- ORJSON-rendered body is json.loads-equal to stdlib json.dumps(jsonable_encoder(..., by_alias=False))
- benchmark print (informational only, no timing assertion)
"""

import json
import time

from fastapi.encoders import jsonable_encoder
from fastapi.responses import ORJSONResponse

from app.main import app
from app.models.response import ExecuteResponse


def _golden() -> ExecuteResponse:
    return ExecuteResponse(
        stdout='héllo wörld ✓ \n\t"quoted"',
        compile_error=None,
        runtime_error=None,
        timed_out=False,
        truncated=False,
        trace=[],
        cfg_nodes=[],
        cfg_edges=[],
        total_steps=0,
    )


def test_default_response_class_is_orjson():
    assert app.router.default_response_class is ORJSONResponse


def test_orjson_parity_with_stdlib():
    golden = _golden()
    stdlib_body = json.dumps(jsonable_encoder(golden, by_alias=False))
    resp = ORJSONResponse(content=jsonable_encoder(golden, by_alias=False))
    orjson_body = resp.body.decode("utf-8")
    assert json.loads(orjson_body) == json.loads(stdlib_body)


def test_orjson_unicode_trace_parity():
    golden = ExecuteResponse(
        stdout="unicode ✓ \U0001f600 \u2028",
        compile_error='err: ünicode "x"',
        total_steps=0,
    )
    stdlib_body = json.dumps(jsonable_encoder(golden, by_alias=False))
    resp = ORJSONResponse(content=jsonable_encoder(golden, by_alias=False))
    assert json.loads(resp.body.decode("utf-8")) == json.loads(stdlib_body)


def test_orjson_benchmark_print(capsys):
    golden = _golden()
    payload = jsonable_encoder(golden, by_alias=False)
    t0 = time.perf_counter()
    for _ in range(200):
        json.dumps(payload)
    stdlib_ms = (time.perf_counter() - t0) * 1000
    import orjson

    t0 = time.perf_counter()
    for _ in range(200):
        orjson.dumps(payload)
    orjson_ms = (time.perf_counter() - t0) * 1000
    print(f"\n[orjson-parity] stdlib={stdlib_ms:.1f}ms orjson={orjson_ms:.1f}ms n=200")
    assert json.loads(orjson.dumps(payload).decode()) == json.loads(json.dumps(payload))
