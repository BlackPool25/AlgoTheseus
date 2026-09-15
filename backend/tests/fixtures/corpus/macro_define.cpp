// macro_define.cpp — KNOWN LIMITATION probe: macro bodies are never injected.
// This corpus entry must SKIP (with warning), never fail.
#include <iostream>

#define SQUARE(x) ((x) * (x))
#define LIMIT 4

int main() {
    int total = 0;
    for (int i = 0; i < LIMIT; i++) {
        total = total + SQUARE(i);
    }
    std::cout << total << std::endl;
    return 0;
}
