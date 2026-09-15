/**
 * tracer.h — Injected C++ runtime trace logger.
 *
 * This header is prepended to every instrumented user program. It writes
 * compact JSON events to stderr with the prefix "TRACE:" so the backend
 * can split trace output from the program's real stderr.
 *
 * Output format (one JSON object per line):
 *   TRACE:{"t":"enter","l":12,"f":"solve","d":1,"p":{"n":5}}
 *   TRACE:{"t":"state","l":14,"f":"solve","d":1,"v":{"i":0}}
 *   TRACE:{"t":"branch","l":16,"f":"solve","d":1,"c":"i < n","tk":true}
 *   TRACE:{"t":"iter","l":16,"f":"solve","d":1,"it":1}
 *   TRACE:{"t":"exit","l":20,"f":"solve","d":1,"r":15}
 *
 * Key design rules:
 * - Uses fprintf(stderr, ...) — never std::cout — to avoid mixing with user stdout.
 * - Re-entrancy guard: __trace_active prevents trace calls from tracing themselves.
 * - Cycle detection: pointer serializers carry a visited set to handle circular structures.
 * - Depth cap: pointer traversal stops at depth 50 to handle pathological inputs.
 * - Priority queue: always drained on a copy, never the original.
 */

#pragma once
#include <cstdio>
#include <string>
#include <sstream>
#include <vector>
#include <stack>
#include <queue>
#include <deque>
#include <map>
#include <unordered_map>
#include <set>
#include <unordered_set>
#include <set>
#include <functional>
#include <type_traits>
#include <tuple>
#include <array>
#include <iostream>
#include <unistd.h>
#include <fcntl.h>

// ── Incremental stdout capture (T7, engine-agnostic "o" protocol) ───────────
// fd 1 is redirected to a temp file at program start so BOTH std::cout and
// printf land there in execution order (one shared file description, flushed
// before every read). Each __TRACE_* macro reads the bytes written since the
// previous event and emits them as "o" (delta, JSON string). The backend
// parser accumulates deltas into cumulative per-event stdout; a later WASM
// shim can fill "o" identically (delta bytes as JSON string) — the parser
// carries no Docker specifics. Compat: a destructor replays the full capture
// back to the real stdout so terminal/container stdout is unchanged.

static int __trace_stdout_saved = -1;
static int __trace_cap_fd = -1;
static long __trace_cap_readpos = 0;
static char __trace_cap_path[64] = "";

// JSON-escape raw bytes (UTF-8 passthrough; C0 controls escaped).
inline std::string __trace_json_escape(const char* s, size_t n) {
    std::string out;
    out.reserve(n + 8);
    const char* hex = "0123456789abcdef";
    for (size_t i = 0; i < n; ++i) {
        unsigned char c = (unsigned char)s[i];
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\t': out += "\\t"; break;
            case '\r': out += "\\r"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) {
                    out += "\\u00";
                    out += hex[c >> 4];
                    out += hex[c & 15];
                } else {
                    out += (char)c;
                }
        }
    }
    return out;
}

inline std::string __trace_stdout_delta() {
    if (__trace_cap_fd < 0) return std::string();
    fflush(stdout);
    std::cout.flush();
    off_t end = lseek(__trace_cap_fd, 0, SEEK_END);
    if (end < 0 || end <= __trace_cap_readpos) return std::string();
    size_t n = (size_t)(end - __trace_cap_readpos);
    std::string raw(n, '\0');
    ssize_t got = pread(__trace_cap_fd, raw.data(), n, __trace_cap_readpos);
    if (got <= 0) return std::string();
    raw.resize((size_t)got);
    __trace_cap_readpos += got;
    return __trace_json_escape(raw.data(), raw.size());
}

__attribute__((constructor)) static void __trace_stdout_init() {
    fflush(stdout);
    char tmpl[] = "/tmp/__trace_stdout_XXXXXX";
    int fd = mkstemp(tmpl);
    if (fd < 0) return;
    __trace_stdout_saved = dup(1);
    if (__trace_stdout_saved < 0) { close(fd); unlink(tmpl); return; }
    if (dup2(fd, 1) < 0) {
        close(fd); close(__trace_stdout_saved);
        __trace_stdout_saved = -1; unlink(tmpl); return;
    }
    __trace_cap_fd = fd;  // shares the file description with fd 1
    __trace_cap_readpos = 0;
    size_t k = 0;
    while (tmpl[k] && k < sizeof(__trace_cap_path) - 1) {
        __trace_cap_path[k] = tmpl[k];
        ++k;
    }
    __trace_cap_path[k] = '\0';
}

__attribute__((destructor)) static void __trace_stdout_fini() {
    if (__trace_cap_fd < 0 || __trace_stdout_saved < 0) return;
    fflush(stdout);
    // Restore fd 1 first so the replay and any late flushes hit the terminal.
    dup2(__trace_stdout_saved, 1);
    lseek(__trace_cap_fd, 0, SEEK_SET);
    char buf[65536];
    ssize_t r;
    while ((r = read(__trace_cap_fd, buf, sizeof(buf))) > 0) {
        size_t off = 0;
        while (off < (size_t)r) {
            ssize_t w = write(__trace_stdout_saved, buf + off, (size_t)r - off);
            if (w <= 0) break;
            off += (size_t)w;
        }
    }
    close(__trace_stdout_saved);
    __trace_stdout_saved = -1;
    close(__trace_cap_fd);
    __trace_cap_fd = -1;
    if (__trace_cap_path[0]) unlink(__trace_cap_path);
}

// ── Re-entrancy guard ────────────────────────────────────────────────────────
// Prevents trace macros from firing while we are already inside a trace call.
static thread_local bool __trace_active = false;

struct __TraceGuard {
    __TraceGuard()  { __trace_active = true;  }
    ~__TraceGuard() { __trace_active = false; }
};

// ── Primitive serializers ────────────────────────────────────────────────────

inline std::string __ser(int v)                { return std::to_string(v); }
inline std::string __ser(long v)               { return std::to_string(v); }
inline std::string __ser(long long v)          { return std::to_string(v); }
inline std::string __ser(unsigned v)           { return std::to_string(v); }
inline std::string __ser(unsigned long v)      { return std::to_string(v); }
inline std::string __ser(unsigned long long v) { return std::to_string(v); }
inline std::string __ser(float v)              { std::ostringstream o; o << v; return o.str(); }
inline std::string __ser(double v)             { std::ostringstream o; o << v; return o.str(); }
inline std::string __ser(bool v)               { return v ? "true" : "false"; }
inline std::string __ser(char v) {
    // Escape special chars
    if (v == '"')  return "\"\\\"\"";
    if (v == '\\') return "\"\\\\\"";
    if (v == '\n') return "\"\\n\"";
    if (v == '\t') return "\"\\t\"";
    std::string s = "\"_\""; s[1] = v; return s;
}
inline std::string __ser(const std::string& v) {
    std::string out = "\"";
    for (char c : v) {
        if (c == '"')  { out += "\\\""; }
        else if (c == '\\') { out += "\\\\"; }
        else if (c == '\n') { out += "\\n"; }
        else if (c == '\t') { out += "\\t"; }
        else { out += c; }
    }
    out += "\"";
    return out;
}
inline std::string __ser(const char* v) {
    if (!v) return "null";
    return __ser(std::string(v));
}

// ── STL container serializers ────────────────────────────────────────────────

template<typename T>
std::string __ser(const std::vector<T>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ",";
        out += __ser(v[i]);
    }
    return out + "]";
}

// vector<bool> is bit-packed: v[i] returns a proxy, not bool&.
// The generic template resolves it via operator bool(), but spell it out
// so proxy quirks on other toolchains can't pick the wrong overload.
inline std::string __ser(const std::vector<bool>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ",";
        out += __ser(static_cast<bool>(v[i]));
    }
    return out + "]";
}

template<typename T>
std::string __ser(const std::vector<std::vector<T>>& v) {
    bool jagged = !v.empty() && [&]{
        size_t firstLen = v[0].size();
        for (size_t i = 1; i < v.size(); ++i)
            if (v[i].size() != firstLen) return true;
        return false;
    }();

    if (jagged) {
        std::string out = "{\"_type\":\"graph\",\"adj\":[";
        for (size_t i = 0; i < v.size(); ++i) {
            if (i) out += ",";
            out += __ser(v[i]);
        }
        return out + "]}";
    }
    std::string out = "{\"_type\":\"dp_table\",\"data\":[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ",";
        out += __ser(v[i]);
    }
    return out + "]}";
}

// Rectangular bool tables use the dp_table shape; rows reuse the
// vector<bool> overload above. (Jagged bool tables render as plain
// arrays via that overload — no separate graph-shape special case.)
inline std::string __ser(const std::vector<std::vector<bool>>& v) {
    std::string out = "{\"_type\":\"dp_table\",\"data\":[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ",";
        out += __ser(v[i]);
    }
    return out + "]}";
}

template<typename T>
std::string __ser(const std::deque<T>& v) {
    std::string out = "[";
    bool first = true;
    for (const auto& x : v) { if (!first) out += ","; out += __ser(x); first = false; }
    return out + "]";
}

template<typename T>
std::string __ser(std::stack<T> v) {
    // Drain into vector (copy, not original)
    std::vector<T> items;
    while (!v.empty()) { items.push_back(v.top()); v.pop(); }
    std::string out = "{\"top\":";
    out += items.empty() ? "null" : __ser(items.front());
    out += ",\"items\":[";
    for (size_t i = 0; i < items.size(); ++i) {
        if (i) out += ",";
        out += __ser(items[i]);
    }
    return out + "]}";
}

template<typename T>
std::string __ser(std::queue<T> v) {
    std::string out = "{\"front\":";
    out += v.empty() ? "null" : __ser(v.front());
    out += ",\"items\":[";
    bool first = true;
    while (!v.empty()) {
        if (!first) out += ",";
        out += __ser(v.front());
        v.pop();
        first = false;
    }
    return out + "]}";
}

template<typename T, typename Container = std::vector<T>, typename Compare = std::less<T>>
std::string __ser(std::priority_queue<T, Container, Compare> v) {
    // Drain a copy — never touch the original
    std::vector<T> items;
    while (!v.empty()) { items.push_back(v.top()); v.pop(); }
    std::string out = "{\"_type\":\"pq\",\"top\":";
    out += items.empty() ? "null" : __ser(items[0]);
    out += ",\"items\":[";
    for (size_t i = 0; i < items.size(); ++i) {
        if (i) out += ",";
        out += __ser(items[i]);
    }
    return out + "]}";
}

template<typename K, typename V>
std::string __ser(const std::map<K,V>& m) {
    std::string out = "{";
    bool first = true;
    for (const auto& [k, v] : m) {
        if (!first) out += ",";
        // Keys must be strings in JSON
        out += "\"" + std::to_string(k) + "\":" + __ser(v);
        first = false;
    }
    return out + "}";
}

// Specialisation for string keys
template<typename V>
std::string __ser(const std::map<std::string,V>& m) {
    std::string out = "{";
    bool first = true;
    for (const auto& [k, v] : m) {
        if (!first) out += ",";
        out += __ser(k) + ":" + __ser(v);
        first = false;
    }
    return out + "}";
}

template<typename K, typename V>
std::string __ser(const std::unordered_map<K,V>& m) {
    std::string out = "{";
    bool first = true;
    for (const auto& [k, v] : m) {
        if (!first) out += ",";
        out += "\"" + std::to_string(k) + "\":" + __ser(v);
        first = false;
    }
    return out + "}";
}

// Specialisation for string keys in unordered_map
template<typename V>
std::string __ser(const std::unordered_map<std::string,V>& m) {
    std::string out = "{";
    bool first = true;
    for (const auto& [k, v] : m) {
        if (!first) out += ",";
        out += __ser(k) + ":" + __ser(v);
        first = false;
    }
    return out + "}";
}

template<typename T>
std::string __ser(const std::set<T>& s) {
    std::string out = "{\"_type\":\"set\",\"values\":[";
    bool first = true;
    for (const auto& x : s) { if (!first) out += ","; out += __ser(x); first = false; }
    return out + "]}";
}

template<typename T>
std::string __ser(const std::unordered_set<T>& s) {
    std::string out = "{\"_type\":\"set\",\"values\":[";
    bool first = true;
    for (const auto& x : s) { if (!first) out += ","; out += __ser(x); first = false; }
    return out + "]}";
}

template<typename T>
std::string __ser(const std::multiset<T>& s) {
    std::string out = "{\"_type\":\"set\",\"values\":[";
    bool first = true;
    for (const auto& x : s) { if (!first) out += ","; out += __ser(x); first = false; }
    return out + "]}";
}

// ── std::pair serializer ──────────────────────────────────────────────────────

template<typename T1, typename T2>
std::string __ser(const std::pair<T1,T2>& p) {
    return "[" + __ser(p.first) + "," + __ser(p.second) + "]";
}

// ── std::tuple serializer (C++17 fold over index_sequence) ────────────────────

template<typename Tuple, std::size_t... I>
std::string __ser_tuple_impl(const Tuple& t, std::index_sequence<I...>) {
    std::string out = "[";
    ((out += (I == 0 ? "" : ",") + __ser(std::get<I>(t))), ...);
    return out + "]";
}

template<typename... Ts>
std::string __ser(const std::tuple<Ts...>& t) {
    return __ser_tuple_impl(t, std::index_sequence_for<Ts...>{});
}

// ── std::array serializer ─────────────────────────────────────────────────────

template<typename T, std::size_t N>
std::string __ser(const std::array<T,N>& a) {
    std::string out = "[";
    for (std::size_t i = 0; i < N; ++i) {
        if (i) out += ",";
        out += __ser(a[i]);
    }
    return out + "]";
}

// ── Raw C array serializer (reference overload to defeat pointer decay) ──────

template<typename T, std::size_t N>
std::string __ser(T (&arr)[N]) {
    std::string out = "[";
    for (std::size_t i = 0; i < N; ++i) {
        if (i) out += ",";
        out += __ser(arr[i]);
    }
    return out + "]";
}

// ── Pointer serializer (forward declaration for cycle detection) ─────────────
// User-defined struct serializers are appended after this header by serializer_gen.py.
// They all follow the signature:
//   std::string __serialize_TypeName(TypeName* p, std::set<void*>& visited, int depth)
//
// The generic pointer fallback below handles unknown pointer types gracefully.

#include <set>

template<typename T>
std::string __ser_ptr(T* p, std::set<void*>& visited, int depth) {
    if (!p) return "null";
    if (depth > 50) return "{\"$depth_limit\":true}";
    if (visited.count((void*)p)) return "{\"$cycle\":true}";
    // For unknown pointer types, just show the address
    std::ostringstream o;
    o << "{\"$addr\":\"" << (void*)p << "\"}";
    return o.str();
}

// Convenience wrapper for when no visited set is available at call site
template<typename T>
std::string __ser(T* p) {
    if (!p) return "null";
    std::set<void*> visited;
    return __ser_ptr(p, visited, 0);
}

// ── Catch-all for types without a specific serializer ───────────────────────
// Returns a placeholder so compilation never fails on unknown types.
template<typename T>
std::string __ser(const T&) { return "\"<opaque>\""; }

// ── Var-list builder helpers ─────────────────────────────────────────────────
// Used by the injected macros to build {"name":value,...} JSON objects.

inline std::string __vars_build() { return ""; }

template<typename V, typename... Rest>
std::string __vars_build(const char* name, const V& val, Rest&&... rest) {
    std::string out = "\"";
    out += name;
    out += "\":";
    out += __ser(val);
    std::string tail = __vars_build(std::forward<Rest>(rest)...);
    if (!tail.empty()) out += "," + tail;
    return out;
}

// ── Branch operand builders (T8 ops) ─────────────────────────────────────────
// Each operand is emitted as one JSON string "name=value" inside the "op"
// array. Values are capped at 256 chars each (never unbounded stringify);
// unserializable pointers fall back to the $addr placeholder via __ser.
inline std::string __ops_item(const char* name, const std::string& val) {
    std::string v = val.size() > 256 ? val.substr(0, 256) + "...<trunc>" : val;
    std::string out = "\"";
    out += name;
    out += "=";
    for (char c : v) {
        if (c == '"')       out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\t') out += "\\t";
        else                out += c;
    }
    return out + "\"";
}

inline std::string __ops_build() { return ""; }

template<typename V, typename... Rest>
std::string __ops_build(const char* name, const V& val, Rest&&... rest) {
    std::string out = __ops_item(name, __ser(val));
    std::string tail = __ops_build(std::forward<Rest>(rest)...);
    if (!tail.empty()) out += "," + tail;
    return out;
}

// ── Trace macros ─────────────────────────────────────────────────────────────
// Each macro checks __trace_active to prevent re-entrant logging.

#define __TRACE_FUNC_ENTER(line, func, depth, ...)                              \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __p = __vars_build(__VA_ARGS__);                         \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"enter\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"p\":{%s},\"o\":\"%s\"}\n", \
                line, func, depth, __p.c_str(), __o.c_str());                    \
        }                                                                        \
    } while(0)

#define __TRACE_FUNC_EXIT(line, func, depth, retval)                            \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"exit\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"r\":%s,\"o\":\"%s\"}\n", \
                line, func, depth, __ser(retval).c_str(), __o.c_str());          \
        }                                                                        \
    } while(0)

#define __TRACE_FUNC_EXIT_VOID(line, func, depth)                               \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"exit\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"r\":null,\"o\":\"%s\"}\n", \
                line, func, depth, __o.c_str());                                 \
        }                                                                        \
    } while(0)

#define __TRACE_STATE(line, func, depth, ...)                                   \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __v = __vars_build(__VA_ARGS__);                         \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"state\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"v\":{%s},\"o\":\"%s\"}\n", \
                line, func, depth, __v.c_str(), __o.c_str());                    \
        }                                                                        \
    } while(0)

// ── Globals snapshot with change-dedup ───────────────────────────────────────
// __TRACE_STATE_G emits "g" only when the globals JSON differs from the
// previous STATE; otherwise the key is omitted (bound trace size).
// Zero-globals programs keep using __TRACE_STATE, so no "g" key appears.
static std::string __trace_prev_g;
static bool __trace_g_first = true;

#define __TRACE_STATE_G(line, func, depth, VJSON, GJSON)                        \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __v = (VJSON);                                            \
            std::string __g = (GJSON);                                            \
            std::string __o = __trace_stdout_delta();                            \
            if (__trace_g_first || __g != __trace_prev_g) {                       \
                __trace_g_first = false;                                         \
                __trace_prev_g = __g;                                             \
                fprintf(stderr,                                                  \
                    "TRACE:{\"t\":\"state\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"v\":{%s},\"g\":{%s},\"o\":\"%s\"}\n", \
                    line, func, depth, __v.c_str(), __g.c_str(), __o.c_str());   \
            } else {                                                             \
                fprintf(stderr,                                                  \
                    "TRACE:{\"t\":\"state\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"v\":{%s},\"o\":\"%s\"}\n", \
                    line, func, depth, __v.c_str(), __o.c_str());                \
            }                                                                    \
        }                                                                        \
    } while(0)

#define __TRACE_BRANCH(line, func, depth, cond_str, cond_val)                  \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"branch\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"c\":\"%s\",\"tk\":%s,\"o\":\"%s\"}\n", \
                line, func, depth, cond_str, (cond_val) ? "true" : "false",      \
                __o.c_str());                                                    \
        }                                                                        \
    } while(0)

#define __TRACE_BRANCH_OPS(line, func, depth, cond_str, cond_val, ...)         \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __ops = __ops_build(__VA_ARGS__);                        \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"branch\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"c\":\"%s\",\"tk\":%s,\"op\":[%s],\"o\":\"%s\"}\n", \
                line, func, depth, cond_str, (cond_val) ? "true" : "false", __ops.c_str(), \
                __o.c_str()); \
        }                                                                        \
    } while(0)

#define __TRACE_LOOP_ITER(line, func, depth, iter)                              \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __o = __trace_stdout_delta();                            \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"iter\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"it\":%d,\"o\":\"%s\"}\n", \
                line, func, depth, iter, __o.c_str());                           \
        }                                                                        \
    } while(0)
