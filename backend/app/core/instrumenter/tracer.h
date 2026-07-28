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

// ── Trace macros ─────────────────────────────────────────────────────────────
// Each macro checks __trace_active to prevent re-entrant logging.

#define __TRACE_FUNC_ENTER(line, func, depth, ...)                              \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __p = __vars_build(__VA_ARGS__);                         \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"enter\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"p\":{%s}}\n", \
                line, func, depth, __p.c_str());                                 \
        }                                                                        \
    } while(0)

#define __TRACE_FUNC_EXIT(line, func, depth, retval)                            \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"exit\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"r\":%s}\n", \
                line, func, depth, __ser(retval).c_str());                       \
        }                                                                        \
    } while(0)

#define __TRACE_FUNC_EXIT_VOID(line, func, depth)                               \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"exit\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"r\":null}\n", \
                line, func, depth);                                              \
        }                                                                        \
    } while(0)

#define __TRACE_STATE(line, func, depth, ...)                                   \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            std::string __v = __vars_build(__VA_ARGS__);                         \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"state\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"v\":{%s}}\n", \
                line, func, depth, __v.c_str());                                 \
        }                                                                        \
    } while(0)

#define __TRACE_BRANCH(line, func, depth, cond_str, cond_val)                  \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"branch\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"c\":\"%s\",\"tk\":%s}\n", \
                line, func, depth, cond_str, (cond_val) ? "true" : "false");    \
        }                                                                        \
    } while(0)

#define __TRACE_LOOP_ITER(line, func, depth, iter)                              \
    do {                                                                         \
        if (!__trace_active) {                                                   \
            __TraceGuard __tg;                                                   \
            fprintf(stderr,                                                      \
                "TRACE:{\"t\":\"iter\",\"l\":%d,\"f\":\"%s\",\"d\":%d,\"it\":%d}\n", \
                line, func, depth, iter);                                        \
        }                                                                        \
    } while(0)
