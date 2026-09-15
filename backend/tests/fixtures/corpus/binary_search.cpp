// binary_search.cpp — binary search with mid in the loop.
#include <iostream>
#include <vector>

int bsearch(std::vector<int>& arr, int target) {
    int lo = 0;
    int hi = (int)arr.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

int main() {
    std::vector<int> arr = {1, 3, 5, 7, 9};
    int result = bsearch(arr, 7);
    std::cout << result << std::endl;
    return 0;
}
