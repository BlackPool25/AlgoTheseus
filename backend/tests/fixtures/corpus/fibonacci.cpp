// fibonacci.cpp — naive recursive Fibonacci (recursion-frame coverage).
#include <iostream>

int fib(int n) {
    if (n <= 1) {
        return n;
    }
    int a = fib(n - 1);
    int b = fib(n - 2);
    int sum = a + b;
    return sum;
}

int main() {
    int result = fib(6);
    std::cout << result << std::endl;
    return 0;
}
