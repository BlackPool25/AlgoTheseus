/**
 * test_instrumented.cpp — Hand-crafted instrumented version of a simple DSA program.
 *
 * This is what the injector will eventually produce automatically.
 * It demonstrates all five trace event types:
 *   enter, exit, state, branch, iter
 *
 * Original program (binary search):
 *   int bsearch(vector<int>& arr, int target) {
 *       int lo = 0, hi = arr.size() - 1;
 *       while (lo <= hi) {
 *           int mid = lo + (hi - lo) / 2;
 *           if (arr[mid] == target) return mid;
 *           else if (arr[mid] < target) lo = mid + 1;
 *           else hi = mid - 1;
 *       }
 *       return -1;
 *   }
 *
 * Compile and run:
 *   g++ -O0 -std=c++17 -o /tmp/test_trace test_instrumented.cpp
 *   echo "" | /tmp/test_trace 2>/tmp/trace.log
 *   grep "^TRACE:" /tmp/trace.log
 */

#include "tracer.h"
#include <vector>
#include <iostream>

// ── Instrumented bsearch ─────────────────────────────────────────────────────

int bsearch(std::vector<int>& arr, int target) {
    // INJECTED: func_enter
    __TRACE_FUNC_ENTER("bsearch", 1, "arr", arr, "target", target);

    int lo = 0, hi = (int)arr.size() - 1;
    __TRACE_STATE(5, "bsearch", 1, "lo", lo, "hi", hi);

    int __loop_iter_0 = 0;  // INJECTED: loop counter declared at function start

    while (lo <= hi) {
        // INJECTED: loop_iter at top of loop body
        __TRACE_LOOP_ITER(7, "bsearch", 1, __loop_iter_0++);

        int mid = lo + (hi - lo) / 2;
        __TRACE_STATE(8, "bsearch", 1, "lo", lo, "hi", hi, "mid", mid);

        // INJECTED: branch before if
        __TRACE_BRANCH(9, "bsearch", 1, "arr[mid] == target", arr[mid] == target);
        if (arr[mid] == target) {
            __TRACE_FUNC_EXIT(10, "bsearch", 1, mid);
            return mid;
        }

        __TRACE_BRANCH(11, "bsearch", 1, "arr[mid] < target", arr[mid] < target);
        if (arr[mid] < target) {
            lo = mid + 1;
            __TRACE_STATE(12, "bsearch", 1, "lo", lo, "hi", hi);
        } else {
            hi = mid - 1;
            __TRACE_STATE(14, "bsearch", 1, "lo", lo, "hi", hi);
        }
    }

    __TRACE_FUNC_EXIT(17, "bsearch", 1, -1);
    return -1;
}

// ── main ─────────────────────────────────────────────────────────────────────

int main() {
    __TRACE_FUNC_ENTER("main", 0);

    std::vector<int> arr = {1, 3, 5, 7, 9, 11, 13};
    int target = 7;
    __TRACE_STATE(22, "main", 0, "arr", arr, "target", target);

    int result = bsearch(arr, target);
    __TRACE_STATE(24, "main", 0, "result", result);

    std::cout << "Found at index: " << result << std::endl;

    __TRACE_FUNC_EXIT(27, "main", 0, 0);
    return 0;
}
