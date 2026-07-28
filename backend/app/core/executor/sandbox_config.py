"""
sandbox_config.py — Docker container resource limits and security options.

These settings are applied to every execution container. They are intentionally
conservative: DSA programs are small and fast; anything that needs more resources
is either wrong or malicious.

Gotcha: `read_only=True` prevents writing anywhere except tmpfs mounts.
The binary is compiled to /tmp/prog which lives on the tmpfs, so this works.
"""

# Container resource limits passed directly to docker.containers.run()
SANDBOX_CONFIG: dict = {
    "mem_limit": "128m",
    "cpu_period": 100_000,
    "cpu_quota": 50_000,       # 50% of one CPU core
    "network_disabled": True,
    "read_only": True,          # filesystem read-only except tmpfs mounts
    "tmpfs": {"/tmp": "size=64m,exec"},  # exec needed to run the compiled binary
    "pids_limit": 64,
    "cap_drop": ["ALL"],
    "security_opt": ["no-new-privileges"],
    # Note: we don't set "user" here because the mounted temp dir is owned
    # by the host user. The container runs as root but is sandboxed by
    # cap_drop=ALL and no-new-privileges. For production, use a proper
    # user namespace mapping instead.
}

# Hard limits enforced by docker_runner.py
EXECUTION_TIMEOUT_SECONDS: int = 10
MAX_TRACE_LINES: int = 100_000   # truncate trace output beyond this
SANDBOX_IMAGE: str = "dsa-sandbox:latest"
