/**
 * content/presets.ts — Interactive algorithm presets ready to execute.
 */

export interface CodePreset {
  id: string;
  name: string;
  category: "Searching & Sorting" | "Dynamic Programming" | "Graphs" | "Data Structures";
  description: string;
  code: string;
  stdin?: string;
}

export const CODE_PRESETS: CodePreset[] = [
  {
    id: "bsearch",
    name: "Binary Search",
    category: "Searching & Sorting",
    description: "Finds element in sorted array with O(log n) time complexity.",
    code: `#include <vector>
#include <iostream>

int bsearch(std::vector<int>& arr, int target) {
    int lo = 0, hi = (int)arr.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main() {
    std::vector<int> arr = {1, 3, 5, 7, 9, 11, 13};
    int target = 7;
    int result = bsearch(arr, target);
    std::cout << "Found at index: " << result << std::endl;
    return 0;
}
`,
  },
  {
    id: "palindrome-dp",
    name: "Palindrome DP Table",
    category: "Dynamic Programming",
    description: "Builds 2D boolean palindrome DP table and computes max non-overlapping palindromes.",
    code: `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

using namespace std;

class Solution {
public:
    int maxPalindromes(string s, int k) {
        int n = s.size();
        // pal[i][j] = true if s[i..j] is a palindrome
        vector<vector<bool>> pal(n, vector<bool>(n, false));

        // Build palindrome table
        for (int i = n - 1; i >= 0; --i) {
            for (int j = i; j < n; ++j) {
                if (s[i] == s[j] && (j - i < 2 || pal[i + 1][j - 1])) {
                    pal[i][j] = true;
                }
            }
        }

        vector<int> dp(n + 1, 0);
        for (int i = n - 1; i >= 0; --i) {
            dp[i] = dp[i + 1];
            for (int j = i + k - 1; j < n; ++j) {
                if (pal[i][j]) {
                    dp[i] = max(dp[i], 1 + dp[j + 1]);
                }
            }
        }
        return dp[0];
    }
};

int main() {
    Solution sol;
    string s1 = "abaccdbbd";
    int k1 = 3;
    cout << "Max palindromes: " << sol.maxPalindromes(s1, k1) << endl;
    return 0;
}
`,
  },
  {
    id: "quicksort",
    name: "Quick Sort",
    category: "Searching & Sorting",
    description: "In-place divide-and-conquer partition sorting algorithm.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

int partition(std::vector<int>& a, int lo, int hi) {
    int pivot = a[hi], i = lo;
    for (int j = lo; j < hi; ++j) {
        if (a[j] < pivot) {
            std::swap(a[i], a[j]);
            i++;
        }
    }
    std::swap(a[i], a[hi]);
    return i;
}

void quickSort(std::vector<int>& a, int lo, int hi) {
    if (lo < hi) {
        int p = partition(a, lo, hi);
        quickSort(a, lo, p - 1);
        quickSort(a, p + 1, hi);
    }
}

int main() {
    std::vector<int> a = {9, 3, 7, 5, 6, 4, 8, 2};
    quickSort(a, 0, (int)a.size() - 1);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "bfs",
    name: "Breadth-First Search (BFS)",
    category: "Graphs",
    description: "Level-order shortest path graph exploration using a queue.",
    code: `#include <vector>
#include <queue>
#include <iostream>

std::vector<int> bfs(const std::vector<std::vector<int>>& g, int start) {
    std::vector<int> dist(g.size(), -1);
    std::queue<int> q;
    dist[start] = 0;
    q.push(start);
    while (!q.empty()) {
        int u = q.front(); q.pop();
        for (int v : g[u]) {
            if (dist[v] == -1) {
                dist[v] = dist[u] + 1;
                q.push(v);
            }
        }
    }
    return dist;
}

int main() {
    std::vector<std::vector<int>> g = {
        {1, 2},    // 0 -> 1, 2
        {0, 3, 4}, // 1 -> 0, 3, 4
        {0, 4},    // 2 -> 0, 4
        {1, 5},    // 3 -> 1, 5
        {1, 2, 5}, // 4 -> 1, 2, 5
        {3, 4}     // 5 -> 3, 4
    };
    auto dists = bfs(g, 0);
    std::cout << "Shortest distances from node 0:" << std::endl;
    for (size_t i = 0; i < dists.size(); ++i) {
        std::cout << "Node " << i << ": " << dists[i] << std::endl;
    }
    return 0;
}
`,
  },
  {
    id: "dijkstra",
    name: "Dijkstra Shortest Path",
    category: "Graphs",
    description: "Weighted graph shortest path with priority queue min-heap.",
    code: `#include <vector>
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
`,
  },
];
