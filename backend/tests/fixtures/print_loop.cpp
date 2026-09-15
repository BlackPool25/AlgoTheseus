// print_loop.cpp — T7 stdout fixture: interleaved cout/printf in a loop.
//
// Ground-truth output (stdout, byte-exact):
//   cout:0\nprintf:0\n...cout:4\nprintf:4\ndone\n
// Both iostream and stdio paths must land in the per-event "o" deltas in
// execution order. Used by test_stdout_incremental.py (byte-exact diff of
// last-event cumulative stdout vs this file's real stdout).
#include <cstdio>
#include <iostream>

int main() {
    for (int i = 0; i < 5; ++i) {
        std::cout << "cout:" << i << "\n";
        printf("printf:%d\n", i);
    }
    std::cout << "done" << std::endl;
    return 0;
}
