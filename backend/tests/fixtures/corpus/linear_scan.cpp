// linear_scan.cpp — linear search over a small vector.
#include <iostream>
#include <vector>

int linear_search(std::vector<int>& arr, int target) {
    int found = -1;
    for (size_t i = 0; i < arr.size(); i++) {
        if (arr[i] == target) {
            found = (int)i;
            break;
        }
    }
    return found;
}

int main() {
    std::vector<int> arr = {4, 2, 7, 1, 9};
    int target = 7;
    int found = linear_search(arr, target);
    std::cout << found << std::endl;
    return 0;
}
