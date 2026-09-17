from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest

from app.api.routes.execute import _resolve, reset_cache
from app.core.trace.parser import _event_adapter, parse
from app.models.request import ExecuteRequest


CASES = {
    "singly-linked-list": (r'''
#include <iostream>
struct Node { int value; Node* next; };
int main() {
    Node* head = new Node{1, new Node{2, new Node{3, nullptr}}};
    for (Node* p = head; p; p = p->next) std::cout << p->value << ' ';
    std::cout << '\n';
    while (head) { Node* next = head->next; delete head; head = next; }
    return 0;
}
''', "1 2 3 \n"),
    "linked-list-cycle-floyd": (r'''
#include <iostream>
struct Node { int value; Node* next; };
bool cycle(Node* head) {
    Node* slow = head; Node* fast = head;
    while (fast && fast->next) {
        slow = slow->next; fast = fast->next->next;
        if (slow == fast) return true;
    }
    return false;
}
int main() {
    Node* a = new Node{1, nullptr}; Node* b = new Node{2, nullptr};
    Node* c = new Node{3, nullptr}; a->next = b; b->next = c; c->next = b;
    std::cout << cycle(a) << '\n';
    c->next = nullptr; std::cout << cycle(a) << '\n';
    delete c; delete b; delete a;
    return 0;
}
''', "1\n0\n"),
    "doubly-linked-list": (r'''
#include <iostream>
struct Node { int value; Node* prev; Node* next; };
int main() {
    Node* a = new Node{1, nullptr, nullptr};
    Node* b = new Node{2, a, nullptr}; Node* c = new Node{3, b, nullptr};
    a->next = b; b->next = c;
    for (Node* p = a; p; p = p->next) std::cout << p->value << ' ';
    std::cout << '\n';
    for (Node* p = c; p; p = p->prev) std::cout << p->value << ' ';
    std::cout << '\n'; delete c; delete b; delete a;
    return 0;
}
''', "1 2 3 \n3 2 1 \n"),
    "binary-tree-inorder": (r'''
#include <iostream>
struct Node { int value; Node* left; Node* right; };
void inorder(Node* p) {
    if (!p) return;
    inorder(p->left); std::cout << p->value << ' '; inorder(p->right);
}
void destroy(Node* p) {
    if (!p) return;
    destroy(p->left); destroy(p->right); delete p;
}
int main() {
    Node* root = new Node{2, new Node{1, nullptr, nullptr}, new Node{3, nullptr, nullptr}};
    inorder(root); std::cout << '\n'; destroy(root);
    return 0;
}
''', "1 2 3 \n"),
    "bst-insert-search": (r'''
#include <iostream>
struct Node { int key; Node* left; Node* right; };
Node* insert(Node* p, int key) {
    if (!p) return new Node{key, nullptr, nullptr};
    if (key < p->key) p->left = insert(p->left, key);
    else if (key > p->key) p->right = insert(p->right, key);
    return p;
}
bool search(Node* p, int key) {
    if (!p) return false;
    if (key == p->key) return true;
    return search(key < p->key ? p->left : p->right, key);
}
void destroy(Node* p) {
    if (!p) return;
    destroy(p->left); destroy(p->right); delete p;
}
int main() {
    Node* root = nullptr;
    for (int key : {5, 3, 7, 2, 4, 6, 8}) root = insert(root, key);
    std::cout << search(root, 4) << ' ' << search(root, 9) << '\n';
    destroy(root); return 0;
}
''', "1 0\n"),
    "graph-bfs": (r'''
#include <iostream>
#include <vector>
#include <queue>
int main() {
    std::vector<std::vector<int>> g = {{1, 2}, {0, 3}, {0, 3}, {1, 2}};
    std::vector<int> seen(4, 0); std::queue<int> q;
    q.push(0); seen[0] = 1;
    while (!q.empty()) {
        int u = q.front(); q.pop(); std::cout << u << ' ';
        for (int v : g[u]) if (!seen[v]) { seen[v] = 1; q.push(v); }
    }
    std::cout << '\n'; return 0;
}
''', "0 1 2 3 \n"),
    "graph-dfs-iterative": (r'''
#include <iostream>
#include <vector>
#include <stack>
int main() {
    std::vector<std::vector<int>> g = {{1, 2}, {3}, {3}, {0}};
    std::vector<int> seen(4, 0); std::stack<int> todo; todo.push(0);
    while (!todo.empty()) {
        int u = todo.top(); todo.pop(); if (seen[u]) continue;
        seen[u] = 1; std::cout << u << ' ';
        for (int i = int(g[u].size()) - 1; i >= 0; --i) todo.push(g[u][i]);
    }
    std::cout << '\n'; return 0;
}
''', "0 1 3 2 \n"),
    "graph-dfs-recursive": (r'''
#include <iostream>
#include <vector>
void dfs(int u, const std::vector<std::vector<int>>& g, std::vector<int>& seen) {
    if (seen[u]) return;
    seen[u] = 1; std::cout << u << ' ';
    for (int v : g[u]) dfs(v, g, seen);
}
int main() {
    std::vector<std::vector<int>> g = {{1, 2}, {3}, {3}, {0}};
    std::vector<int> seen(4, 0); dfs(0, g, seen);
    std::cout << '\n'; return 0;
}
''', "0 1 3 2 \n"),
    "dijkstra-priority-queue": (r'''#include <vector>
#include <queue>
#include <iostream>

const long long INF = 1e9;

std::vector<long long> dijkstra(const std::vector<std::vector<std::pair<int, int>>>& g, int src) {
    std::vector<long long> dist(g.size(), INF);
    using P = std::pair<long long, int>;
    std::priority_queue<P, std::vector<P>, std::greater<P>> pq;
    dist[src] = 0;
    pq.emplace(0, src);
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d > dist[u]) continue;
        for (auto [v, w] : g[u]) {
            if (dist[v] > d + w) {
                dist[v] = d + w;
                pq.emplace(dist[v], v);
            }
        }
    }
    return dist;
}

int main() {
    int n = 4;
    std::vector<std::vector<std::pair<int, int>>> g(n);
    g[0].push_back({1, 4});
    g[0].push_back({2, 1});
    g[2].push_back({1, 2});
    g[1].push_back({3, 1});
    g[2].push_back({3, 5});

    auto dist = dijkstra(g, 0);
    std::cout << "Shortest distance to 3: " << dist[3] << std::endl;
    return 0;
}
''', "Shortest distance to 3: 4\n"),
    "dsu-kruskal": (r'''#include <vector>
#include <iostream>
#include <algorithm>

struct Edge {
    int u;
    int v;
    int w;
};

struct DSU {
    std::vector<int> p;
    std::vector<int> r;
    DSU(int n) : p(n), r(n, 0) {
        for (int i = 0; i < n; ++i) p[i] = i;
    }
    int find(int x) {
        if (p[x] == x) return x;
        p[x] = find(p[x]);
        return p[x];
    }
    bool unite(int a, int b) {
        a = find(a);
        b = find(b);
        if (a == b) return false;
        if (r[a] < r[b]) p[a] = b;
        else if (r[a] > r[b]) p[b] = a;
        else { p[b] = a; r[a]++; }
        return true;
    }
};

bool edgeLess(const Edge& a, const Edge& b) {
    return a.w < b.w;
}

int main() {
    int n = 4;
    std::vector<Edge> edges;
    edges.push_back({0, 1, 10});
    edges.push_back({0, 2, 6});
    edges.push_back({0, 3, 5});
    edges.push_back({1, 3, 15});
    edges.push_back({2, 3, 4});
    std::sort(edges.begin(), edges.end(), edgeLess);
    DSU dsu(n);
    int mst = 0;
    for (size_t i = 0; i < edges.size(); ++i) {
        if (dsu.unite(edges[i].u, edges[i].v)) mst += edges[i].w;
    }
    std::cout << "MST weight: " << mst << std::endl;
    return 0;
}
''', "MST weight: 19\n"),
    "trie-insert-search": (r'''
#include <iostream>
#include <string>
struct Node { Node* child[26] = {}; bool end = false; };
void insert(Node* root, const std::string& word) {
    Node* p = root;
    for (char c : word) {
        int i = c - 'a'; if (!p->child[i]) p->child[i] = new Node{};
        p = p->child[i];
    }
    p->end = true;
}
bool search(Node* root, const std::string& word) {
    Node* p = root;
    for (char c : word) {
        int i = c - 'a'; if (!p->child[i]) return false; p = p->child[i];
    }
    return p->end;
}
void destroy(Node* p) {
    if (!p) return;
    for (int i = 0; i < 26; ++i) destroy(p->child[i]);
    delete p;
}
int main() {
    Node* root = new Node{}; insert(root, "cat"); insert(root, "car");
    std::cout << search(root, "cat") << ' ' << search(root, "ca") << ' '
              << search(root, "dog") << ' ' << search(root, "car") << '\n';
    destroy(root); return 0;
}
''', "1 0 0 1\n"),
    "recursive-fibonacci": (r'''
#include <iostream>
int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
int main() { std::cout << fib(10) << '\n'; return 0; }
''', "55\n"),
    "knapsack-2d-dp": (r'''
#include <iostream>
#include <algorithm>
int main() {
    int weight[3] = {1, 2, 3}; int value[3] = {6, 10, 12}; int dp[4][6] = {};
    for (int i = 1; i <= 3; ++i) {
        for (int w = 0; w <= 5; ++w) {
            dp[i][w] = dp[i - 1][w];
            if (weight[i - 1] <= w)
                dp[i][w] = std::max(dp[i][w], dp[i - 1][w - weight[i - 1]] + value[i - 1]);
        }
    }
    std::cout << dp[3][5] << '\n'; return 0;
}
''', "22\n"),
    "grid-flood-fill-count": (r'''
#include <iostream>
#include <vector>
void fill(std::vector<std::vector<int>>& grid, int r, int c) {
    if (r < 0 || r >= 3 || c < 0 || c >= 4 || grid[r][c] == 0) return;
    grid[r][c] = 0;
    fill(grid, r - 1, c); fill(grid, r + 1, c);
    fill(grid, r, c - 1); fill(grid, r, c + 1);
}
int main() {
    std::vector<std::vector<int>> grid = {{1, 1, 0, 0}, {0, 1, 0, 1}, {1, 0, 0, 1}};
    int count = 0;
    for (int r = 0; r < 3; ++r) for (int c = 0; c < 4; ++c) {
        if (grid[r][c]) { ++count; fill(grid, r, c); }
    }
    std::cout << count << '\n'; return 0;
}
''', "3\n"),
    "vector-matrix-ops": (r'''
#include <iostream>
#include <vector>
int main() {
    std::vector<std::vector<int>> a = {{1, 2}, {3, 4}};
    std::vector<std::vector<int>> b = {{5, 6}, {7, 8}};
    std::vector<std::vector<int>> product(2, std::vector<int>(2, 0));
    for (int i = 0; i < 2; ++i) for (int j = 0; j < 2; ++j)
        for (int k = 0; k < 2; ++k) product[i][j] += a[i][k] * b[k][j];
    for (int i = 0; i < 2; ++i) {
        for (int j = 0; j < 2; ++j) std::cout << product[i][j] << ' ';
        std::cout << '\n';
    }
    return 0;
}
''', "19 22 \n43 50 \n"),
}


@pytest.mark.parametrize("name", CASES)
async def test_structure_matches_plain_gpp(
    name: str, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    code, expected = CASES[name]
    monkeypatch.setenv("SANDBOX_MODE", "subprocess")
    monkeypatch.setenv("CACHE_DIR", "/tmp/at-sweep-b")
    reset_cache()
    with tempfile.TemporaryDirectory(prefix="at-sweep-plain-") as directory:
        binary = str(Path(directory) / "plain")
        compiled = subprocess.run(
            ["g++", "-std=c++17", "-O0", "-x", "c++", "-", "-o", binary],
            input=code, capture_output=True, text=True, timeout=60, check=False,
        )
        assert compiled.returncode == 0, f"plain_gpp_compile_error: {compiled.stderr}"
        plain = subprocess.run(
            [binary], capture_output=True, text=True, timeout=10, check=False,
        )
        assert plain.returncode == 0, f"plain_gpp_exit={plain.returncode}: {plain.stderr}"
        assert plain.stdout == expected, f"plain_gpp_stdout={plain.stdout!r}; expected={expected!r}"
    print(f"BASELINE {name}: {plain.stdout!r}", flush=True)
    resolved = await _resolve(
        ExecuteRequest(code=code, raw_stdin="", compressed=False), kind=f"sweep-{uuid4()}"
    )
    assert resolved.input_error is None, f"input_error: {resolved.input_error}"
    assert resolved.instrumentation_error is None, (
        f"instrumentation_error: {resolved.instrumentation_error}"
    )
    assert resolved.sandbox_error is None, f"sandbox_error: {resolved.sandbox_error}"
    run = resolved.run_result
    assert run is not None, "missing_run_result"
    assert run.compile_error is None, f"compile_error: {run.compile_error}"
    assert not resolved.cache_hit, "cached_execution_not_real_run"
    assert not run.timed_out, "execution_timed_out"
    assert run.exit_code == 0, f"exit_code={run.exit_code}; stderr={run.stderr_clean}"
    assert run.stdout == plain.stdout, f"stdout={run.stdout!r}; expected={plain.stdout!r}"
    assert not run.truncated, "trace_truncated"
    assert run.trace_raw, "empty_trace"
    for raw in run.trace_raw:
        _event_adapter.validate_python(json.loads(raw))
    caplog.clear()
    events = parse(run.trace_raw, compressed=False)
    assert len(events) == len(run.trace_raw), "parse_dropped_events"
    assert not caplog.records, f"parse_logs: {caplog.text}"
    print(f"PASS {name}: exit=0 stdout={run.stdout!r} traces={len(events)} parse=clean", flush=True)
