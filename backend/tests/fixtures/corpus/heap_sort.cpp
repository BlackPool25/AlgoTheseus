// heap_sort.cpp — heap-sort over a vector named `heap`.
#include <iostream>
#include <vector>

void sift_down(std::vector<int>& heap, int n, int i) {
    int largest = i;
    int left = 2 * i + 1;
    int right = 2 * i + 2;
    if (left < n && heap[left] > heap[largest]) {
        largest = left;
    }
    if (right < n && heap[right] > heap[largest]) {
        largest = right;
    }
    if (largest != i) {
        int tmp = heap[i];
        heap[i] = heap[largest];
        heap[largest] = tmp;
        sift_down(heap, n, largest);
    }
}

void heap_sort(std::vector<int>& heap) {
    int n = (int)heap.size();
    for (int i = n / 2 - 1; i >= 0; i--) {
        sift_down(heap, n, i);
    }
    for (int end = n - 1; end > 0; end--) {
        int tmp = heap[0];
        heap[0] = heap[end];
        heap[end] = tmp;
        sift_down(heap, end, 0);
    }
}

int main() {
    std::vector<int> heap = {5, 1, 4, 2, 3};
    heap_sort(heap);
    for (size_t i = 0; i < heap.size(); i++) {
        std::cout << heap[i] << " ";
    }
    std::cout << std::endl;
    return 0;
}
