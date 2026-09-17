/**
 * content/presets.ts — Interactive algorithm presets ready to execute.
 */

import type { AlgorithmEntry } from "./algorithms";

export interface CodePreset {
  id: string;
  name: string;
  category: "Searching & Sorting" | "Dynamic Programming" | "Graphs" | "Data Structures" | "Strings" | "Math & Misc";
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
  {
    id: "knapsack-01",
    name: "0/1 Knapsack",
    category: "Dynamic Programming",
    description: "Iterative 2D DP table maximizing value under weight capacity.",
    code: `#include <iostream>
#include <vector>
#include <algorithm>

using namespace std;

int knapsack(vector<int>& wt, vector<int>& val, int W) {
    int n = wt.size();
    vector<vector<int>> dp(n + 1, vector<int>(W + 1, 0));
    for (int i = 1; i <= n; ++i) {
        for (int w = 0; w <= W; ++w) {
            dp[i][w] = dp[i - 1][w];
            if (wt[i - 1] <= w) {
                dp[i][w] = max(dp[i][w], dp[i - 1][w - wt[i - 1]] + val[i - 1]);
            }
        }
    }
    return dp[n][W];
}

int main() {
    vector<int> wt = {1, 3, 4, 5};
    vector<int> val = {1, 4, 5, 7};
    int W = 7;
    cout << "Max knapsack value: " << knapsack(wt, val, W) << endl;
    return 0;
}
`,
  },
  {
    id: "lcs",
    name: "Longest Common Subsequence",
    category: "Dynamic Programming",
    description: "Iterative DP table computing LCS length of two strings.",
    code: `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

using namespace std;

int lcs(string a, string b) {
    int n = a.size(), m = b.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));
    for (int i = 1; i <= n; ++i) {
        for (int j = 1; j <= m; ++j) {
            if (a[i - 1] == b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
            else dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[n][m];
}

int main() {
    string a = "ABCBDAB";
    string b = "BDCABA";
    cout << "LCS length: " << lcs(a, b) << endl;
    return 0;
}
`,
  },
  {
    id: "lis",
    name: "Longest Increasing Subsequence",
    category: "Dynamic Programming",
    description: "O(n^2) iterative DP for LIS length over a hardcoded array.",
    code: `#include <iostream>
#include <vector>
#include <algorithm>

using namespace std;

int lis(vector<int>& a) {
    int n = a.size();
    vector<int> dp(n, 1);
    for (int i = 1; i < n; ++i) {
        for (int j = 0; j < i; ++j) {
            if (a[j] < a[i]) dp[i] = max(dp[i], dp[j] + 1);
        }
    }
    return *max_element(dp.begin(), dp.end());
}

int main() {
    vector<int> a = {10, 9, 2, 5, 3, 7, 101, 18};
    cout << "LIS length: " << lis(a) << endl;
    return 0;
}
`,
  },
  {
    id: "coin-change",
    name: "Coin Change",
    category: "Dynamic Programming",
    description: "Iterative DP counting minimum coins for a hardcoded amount.",
    code: `#include <iostream>
#include <vector>
#include <algorithm>

using namespace std;

int coinChange(vector<int>& coins, int amount) {
    const int INF = 1e9;
    vector<int> dp(amount + 1, INF);
    dp[0] = 0;
    for (int i = 1; i <= amount; ++i) {
        for (int c : coins) {
            if (c <= i && dp[i - c] != INF) {
                dp[i] = min(dp[i], dp[i - c] + 1);
            }
        }
    }
    return dp[amount] == INF ? -1 : dp[amount];
}

int main() {
    vector<int> coins = {1, 2, 5};
    int amount = 11;
    cout << "Min coins: " << coinChange(coins, amount) << endl;
    return 0;
}
`,
  },
  {
    id: "edit-distance",
    name: "Edit Distance",
    category: "Dynamic Programming",
    description: "Iterative DP table for minimum edits between two words.",
    code: `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

using namespace std;

int editDistance(string a, string b) {
    int n = a.size(), m = b.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));
    for (int i = 0; i <= n; ++i) dp[i][0] = i;
    for (int j = 0; j <= m; ++j) dp[0][j] = j;
    for (int i = 1; i <= n; ++i) {
        for (int j = 1; j <= m; ++j) {
            if (a[i - 1] == b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + min({dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]});
        }
    }
    return dp[n][m];
}

int main() {
    string a = "horse";
    string b = "ros";
    cout << "Edit distance: " << editDistance(a, b) << endl;
    return 0;
}
`,
  },
  {
    id: "climbing-stairs",
    name: "Climbing Stairs",
    category: "Dynamic Programming",
    description: "Iterative Fibonacci-style DP counting ways to climb stairs.",
    code: `#include <iostream>
#include <vector>

using namespace std;

int climbStairs(int n) {
    if (n <= 2) return n;
    vector<int> dp(n + 1, 0);
    dp[1] = 1;
    dp[2] = 2;
    for (int i = 3; i <= n; ++i) {
        dp[i] = dp[i - 1] + dp[i - 2];
    }
    return dp[n];
}

int main() {
    int n = 5;
    cout << "Ways to climb " << n << " stairs: " << climbStairs(n) << endl;
    return 0;
}
`,
  },
  {
    id: "kmp",
    name: "KMP Pattern Search",
    category: "Strings",
    description: "Knuth-Morris-Pratt substring search with prefix function.",
    code: `#include <iostream>
#include <vector>
#include <string>

using namespace std;

vector<int> buildLPS(string pat) {
    int m = pat.size();
    vector<int> lps(m, 0);
    int len = 0;
    for (int i = 1; i < m; ++i) {
        while (len > 0 && pat[i] != pat[len]) len = lps[len - 1];
        if (pat[i] == pat[len]) ++len;
        lps[i] = len;
    }
    return lps;
}

int kmpSearch(string text, string pat) {
    vector<int> lps = buildLPS(pat);
    int j = 0;
    for (int i = 0; i < (int)text.size(); ++i) {
        while (j > 0 && text[i] != pat[j]) j = lps[j - 1];
        if (text[i] == pat[j]) ++j;
        if (j == (int)pat.size()) return i - j + 1;
    }
    return -1;
}

int main() {
    string text = "ABABDABACDABABCABAB";
    string pat = "ABABCABAB";
    cout << "Pattern found at index: " << kmpSearch(text, pat) << endl;
    return 0;
}
`,
  },
  {
    id: "singly-linked-list",
    name: "Singly Linked List",
    category: "Data Structures",
    description: "Pointer-based linked list with append and traversal demo.",
    code: `#include <iostream>

using namespace std;

struct Node {
    int val;
    Node* next;
    Node(int v) : val(v), next(nullptr) {}
};

void append(Node*& head, int v) {
    Node* node = new Node(v);
    if (head == nullptr) {
        head = node;
        return;
    }
    Node* cur = head;
    while (cur->next != nullptr) cur = cur->next;
    cur->next = node;
}

void printList(Node* head) {
    Node* cur = head;
    while (cur != nullptr) {
        cout << cur->val << " ";
        cur = cur->next;
    }
    cout << endl;
}

int main() {
    Node* head = nullptr;
    append(head, 1);
    append(head, 2);
    append(head, 3);
    cout << "Linked list: ";
    printList(head);
    return 0;
}
`,
  },
  {
    id: "binary-search-tree",
    name: "Binary Search Tree",
    category: "Data Structures",
    description: "Pointer-based BST with recursive insert and inorder traversal.",
    code: `#include <iostream>

using namespace std;

struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};

TreeNode* insert(TreeNode* root, int v) {
    if (root == nullptr) return new TreeNode(v);
    if (v < root->val) root->left = insert(root->left, v);
    else if (v > root->val) root->right = insert(root->right, v);
    return root;
}

bool search(TreeNode* root, int v) {
    if (root == nullptr) return false;
    if (root->val == v) return true;
    if (v < root->val) return search(root->left, v);
    return search(root->right, v);
}

void inorder(TreeNode* root) {
    if (root == nullptr) return;
    inorder(root->left);
    cout << root->val << " ";
    inorder(root->right);
}

int main() {
    TreeNode* root = nullptr;
    int vals[] = {4, 2, 6, 1, 3, 5, 7};
    for (int v : vals) root = insert(root, v);
    cout << "Inorder: ";
    inorder(root);
    cout << endl;
    cout << "Search 5: " << (search(root, 5) ? "found" : "not found") << endl;
    return 0;
}
`,
  },
  {
    id: "trie",
    name: "Trie",
    category: "Data Structures",
    description: "Pointer-based trie with insert and search demo.",
    code: `#include <iostream>
#include <string>

using namespace std;

struct TrieNode {
    TrieNode* child[26];
    bool isEnd;
    TrieNode() : isEnd(false) {
        for (int i = 0; i < 26; ++i) child[i] = nullptr;
    }
};

void insert(TrieNode* root, string word) {
    if (root == nullptr) return;
    TrieNode* cur = root;
    for (char ch : word) {
        int idx = ch - 'a';
        if (cur->child[idx] == nullptr) cur->child[idx] = new TrieNode();
        cur = cur->child[idx];
    }
    cur->isEnd = true;
}

bool search(TrieNode* root, string word) {
    if (root == nullptr) return false;
    TrieNode* cur = root;
    for (char ch : word) {
        int idx = ch - 'a';
        if (cur->child[idx] == nullptr) return false;
        cur = cur->child[idx];
    }
    return cur->isEnd;
}

int main() {
    TrieNode* root = new TrieNode();
    insert(root, "apple");
    insert(root, "app");
    cout << "Search apple: " << (search(root, "apple") ? "found" : "not found") << endl;
    cout << "Search app: " << (search(root, "app") ? "found" : "not found") << endl;
    cout << "Search apricot: " << (search(root, "apricot") ? "found" : "not found") << endl;
    return 0;
}
`,
  },
  {
    id: "heap-priority-queue",
    name: "Heap Priority Queue",
    category: "Data Structures",
    description: "Max-heap and min-heap demo using std::priority_queue.",
    code: `#include <iostream>
#include <queue>
#include <vector>

using namespace std;

int main() {
    priority_queue<int> maxHeap;
    priority_queue<int, vector<int>, greater<int>> minHeap;
    int vals[] = {5, 1, 8, 3, 7};
    for (int v : vals) {
        maxHeap.push(v);
        minHeap.push(v);
    }
    cout << "Max-heap top: " << maxHeap.top() << endl;
    maxHeap.pop();
    cout << "Max-heap top after pop: " << maxHeap.top() << endl;
    cout << "Min-heap top: " << minHeap.top() << endl;
    minHeap.pop();
    cout << "Min-heap top after pop: " << minHeap.top() << endl;
    return 0;
}
`,
  },
  {
    id: "stack-queue-demo",
    name: "Stack and Queue Demo",
    category: "Data Structures",
    description: "Combined demo of std::stack push/pop and std::queue push/pop.",
    code: `#include <iostream>
#include <stack>
#include <queue>

using namespace std;

int main() {
    stack<int> st;
    st.push(1);
    st.push(2);
    st.push(3);
    cout << "Stack top: " << st.top() << endl;
    st.pop();
    cout << "Stack top after pop: " << st.top() << endl;
    queue<int> q;
    q.push(1);
    q.push(2);
    q.push(3);
    cout << "Queue front: " << q.front() << endl;
    q.pop();
    cout << "Queue front after pop: " << q.front() << endl;
    return 0;
}
`,
  },
  {
    id: "dfs",
    name: "Depth-First Search (DFS)",
    category: "Graphs",
    description: "Recursive graph traversal exploring as far as possible along each branch.",
    code: `#include <vector>
#include <iostream>

void dfsVisit(const std::vector<std::vector<int>>& g, int u, std::vector<int>& visited, std::vector<int>& order) {
    visited[u] = 1;
    order.push_back(u);
    for (size_t i = 0; i < g[u].size(); ++i) {
        int v = g[u][i];
        if (!visited[v]) dfsVisit(g, v, visited, order);
    }
}

int main() {
    std::vector<std::vector<int>> g = {
        {1, 2},
        {0, 3, 4},
        {0, 4},
        {1, 5},
        {1, 2, 5},
        {3, 4}
    };
    std::vector<int> visited(g.size(), 0);
    std::vector<int> order;
    dfsVisit(g, 0, visited, order);
    std::cout << "DFS order: ";
    for (size_t i = 0; i < order.size(); ++i) std::cout << order[i] << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "topological-sort",
    name: "Topological Sort (Kahn)",
    category: "Graphs",
    description: "Kahn's BFS ordering of a DAG using indegrees and a queue.",
    code: `#include <vector>
#include <queue>
#include <iostream>

std::vector<int> topoSort(const std::vector<std::vector<int>>& g) {
    int n = (int)g.size();
    std::vector<int> indeg(n, 0);
    for (int u = 0; u < n; ++u) {
        for (size_t i = 0; i < g[u].size(); ++i) indeg[g[u][i]]++;
    }
    std::queue<int> q;
    for (int i = 0; i < n; ++i) if (indeg[i] == 0) q.push(i);
    std::vector<int> order;
    while (!q.empty()) {
        int u = q.front(); q.pop();
        order.push_back(u);
        for (size_t i = 0; i < g[u].size(); ++i) {
            int v = g[u][i];
            indeg[v]--;
            if (indeg[v] == 0) q.push(v);
        }
    }
    return order;
}

int main() {
    std::vector<std::vector<int>> g(6);
    g[5].push_back(2);
    g[5].push_back(0);
    g[4].push_back(0);
    g[4].push_back(1);
    g[2].push_back(3);
    g[3].push_back(1);
    std::vector<int> order = topoSort(g);
    std::cout << "Topological order: ";
    for (size_t i = 0; i < order.size(); ++i) std::cout << order[i] << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "kruskal",
    name: "Kruskal MST",
    category: "Graphs",
    description: "Minimum spanning tree with union-find and sorted edge list.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

struct Edge {
    int u;
    int v;
    int w;
};

struct DSU {
    std::vector<int> p;
    std::vector<int> r;
    DSU(int n) : p(n), r(n, 0) {
        for (int i = 0; i < n; ++i) p[i] = i;
    }
    int find(int x) {
        if (p[x] == x) return x;
        p[x] = find(p[x]);
        return p[x];
    }
    bool unite(int a, int b) {
        a = find(a);
        b = find(b);
        if (a == b) return false;
        if (r[a] < r[b]) p[a] = b;
        else if (r[a] > r[b]) p[b] = a;
        else { p[b] = a; r[a]++; }
        return true;
    }
};

bool edgeLess(const Edge& a, const Edge& b) {
    return a.w < b.w;
}

int main() {
    int n = 4;
    std::vector<Edge> edges;
    edges.push_back({0, 1, 10});
    edges.push_back({0, 2, 6});
    edges.push_back({0, 3, 5});
    edges.push_back({1, 3, 15});
    edges.push_back({2, 3, 4});
    std::sort(edges.begin(), edges.end(), edgeLess);
    DSU dsu(n);
    int mst = 0;
    for (size_t i = 0; i < edges.size(); ++i) {
        if (dsu.unite(edges[i].u, edges[i].v)) mst += edges[i].w;
    }
    std::cout << "MST weight: " << mst << std::endl;
    return 0;
}
`,
  },
  {
    id: "prim",
    name: "Prim MST",
    category: "Graphs",
    description: "Minimum spanning tree growing from a source with a min-heap.",
    code: `#include <vector>
#include <queue>
#include <iostream>

int prim(const std::vector<std::vector<std::pair<int, int>>>& g, int src) {
    int n = (int)g.size();
    const int INF = 1000000000;
    std::vector<int> best(n, INF);
    std::vector<int> used(n, 0);
    typedef std::pair<int, int> P;
    std::priority_queue<P, std::vector<P>, std::greater<P>> pq;
    best[src] = 0;
    pq.push(P(0, src));
    int total = 0;
    while (!pq.empty()) {
        P top = pq.top(); pq.pop();
        int u = top.second;
        if (used[u]) continue;
        used[u] = 1;
        total += top.first;
        for (size_t i = 0; i < g[u].size(); ++i) {
            int v = g[u][i].first;
            int w = g[u][i].second;
            if (!used[v] && w < best[v]) {
                best[v] = w;
                pq.push(P(w, v));
            }
        }
    }
    return total;
}

int main() {
    int n = 4;
    std::vector<std::vector<std::pair<int, int>>> g(n);
    g[0].push_back(std::make_pair(1, 10));
    g[1].push_back(std::make_pair(0, 10));
    g[0].push_back(std::make_pair(2, 6));
    g[2].push_back(std::make_pair(0, 6));
    g[0].push_back(std::make_pair(3, 5));
    g[3].push_back(std::make_pair(0, 5));
    g[1].push_back(std::make_pair(3, 15));
    g[3].push_back(std::make_pair(1, 15));
    g[2].push_back(std::make_pair(3, 4));
    g[3].push_back(std::make_pair(2, 4));
    std::cout << "MST weight: " << prim(g, 0) << std::endl;
    return 0;
}
`,
  },
  {
    id: "bellman-ford",
    name: "Bellman-Ford",
    category: "Graphs",
    description: "Single-source shortest paths handling negative edge weights.",
    code: `#include <vector>
#include <iostream>

struct Edge {
    int u;
    int v;
    int w;
};

int main() {
    int n = 5;
    std::vector<Edge> edges;
    edges.push_back({0, 1, -1});
    edges.push_back({0, 2, 4});
    edges.push_back({1, 2, 3});
    edges.push_back({1, 3, 2});
    edges.push_back({1, 4, 2});
    edges.push_back({3, 2, 5});
    edges.push_back({3, 1, 1});
    edges.push_back({4, 3, -3});
    const int INF = 1000000000;
    std::vector<int> dist(n, INF);
    dist[0] = 0;
    for (int i = 0; i < n - 1; ++i) {
        for (size_t j = 0; j < edges.size(); ++j) {
            int u = edges[j].u;
            int v = edges[j].v;
            int w = edges[j].w;
            if (dist[u] != INF && dist[v] > dist[u] + w) dist[v] = dist[u] + w;
        }
    }
    std::cout << "Distances from 0: ";
    for (int i = 0; i < n; ++i) std::cout << dist[i] << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "floyd-warshall",
    name: "Floyd-Warshall",
    category: "Graphs",
    description: "All-pairs shortest paths with triple-loop dynamic programming.",
    code: `#include <vector>
#include <iostream>

int main() {
    int n = 4;
    const int INF = 1000000000;
    std::vector<std::vector<int>> d(n, std::vector<int>(n, INF));
    for (int i = 0; i < n; ++i) d[i][i] = 0;
    d[0][1] = 5;
    d[0][3] = 10;
    d[1][2] = 3;
    d[2][3] = 1;
    d[1][3] = 7;
    for (int k = 0; k < n; ++k) {
        for (int i = 0; i < n; ++i) {
            for (int j = 0; j < n; ++j) {
                if (d[i][k] != INF && d[k][j] != INF && d[i][j] > d[i][k] + d[k][j]) {
                    d[i][j] = d[i][k] + d[k][j];
                }
            }
        }
    }
    std::cout << "All-pairs shortest paths:" << std::endl;
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) std::cout << d[i][j] << " ";
        std::cout << std::endl;
    }
    return 0;
}
`,
  },
  {
    id: "union-find",
    name: "Union-Find (DSU)",
    category: "Graphs",
    description: "Disjoint set union with path compression and union by rank.",
    code: `#include <vector>
#include <iostream>

struct DSU {
    std::vector<int> p;
    std::vector<int> r;
    DSU(int n) : p(n), r(n, 0) {
        for (int i = 0; i < n; ++i) p[i] = i;
    }
    int find(int x) {
        if (p[x] == x) return x;
        p[x] = find(p[x]);
        return p[x];
    }
    void unite(int a, int b) {
        a = find(a);
        b = find(b);
        if (a == b) return;
        if (r[a] < r[b]) p[a] = b;
        else if (r[a] > r[b]) p[b] = a;
        else { p[b] = a; r[a]++; }
    }
    bool same(int a, int b) { return find(a) == find(b); }
};

int main() {
    DSU dsu(5);
    dsu.unite(0, 1);
    dsu.unite(1, 2);
    dsu.unite(3, 4);
    std::cout << "0 and 2 connected: " << dsu.same(0, 2) << std::endl;
    std::cout << "0 and 3 connected: " << dsu.same(0, 3) << std::endl;
    return 0;
}
`,
  },
  {
    id: "cycle-detection",
    name: "Cycle Detection",
    category: "Graphs",
    description: "Detects a cycle in a directed graph with DFS color marking.",
    code: `#include <vector>
#include <iostream>

bool dfsCycle(const std::vector<std::vector<int>>& g, int u, std::vector<int>& color) {
    color[u] = 1;
    for (size_t i = 0; i < g[u].size(); ++i) {
        int v = g[u][i];
        if (color[v] == 1) return true;
        if (color[v] == 0 && dfsCycle(g, v, color)) return true;
    }
    color[u] = 2;
    return false;
}

bool hasCycle(const std::vector<std::vector<int>>& g) {
    std::vector<int> color(g.size(), 0);
    for (size_t i = 0; i < g.size(); ++i) {
        if (color[i] == 0 && dfsCycle(g, (int)i, color)) return true;
    }
    return false;
}

int main() {
    std::vector<std::vector<int>> g(4);
    g[0].push_back(1);
    g[1].push_back(2);
    g[2].push_back(0);
    g[2].push_back(3);
    std::cout << "Has cycle: " << hasCycle(g) << std::endl;
    return 0;
}
`,
  },
  {
    id: "hashmap",
    name: "Hash Map Frequency Count",
    category: "Data Structures",
    description: "Counts element frequencies with an unordered_map hash table.",
    code: `#include <unordered_map>
#include <vector>
#include <iostream>

int main() {
    std::vector<int> a = {1, 2, 2, 3, 3, 3, 4};
    std::unordered_map<int, int> freq;
    for (size_t i = 0; i < a.size(); ++i) freq[a[i]]++;
    std::cout << "Frequencies:" << std::endl;
    for (int k = 1; k <= 4; ++k) {
        std::cout << k << ": " << freq[k] << std::endl;
    }
    return 0;
}
`,
  },
  {
    id: "linear-search",
    name: "Linear Search",
    category: "Searching & Sorting",
    description: "Scans each element sequentially with O(n) time complexity.",
    code: `#include <vector>
#include <iostream>

int linearSearch(std::vector<int>& arr, int target) {
    for (int i = 0; i < (int)arr.size(); i++) {
        if (arr[i] == target) return i;
    }
    return -1;
}

int main() {
    std::vector<int> arr = {4, 2, 7, 1, 9, 5};
    int target = 7;
    int result = linearSearch(arr, target);
    std::cout << "Found at index: " << result << std::endl;
    return 0;
}
`,
  },
  {
    id: "bubble-sort",
    name: "Bubble Sort",
    category: "Searching & Sorting",
    description: "Repeatedly swaps adjacent out-of-order elements with O(n^2) time complexity.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

void bubbleSort(std::vector<int>& a) {
    int n = (int)a.size();
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                std::swap(a[j], a[j + 1]);
            }
        }
    }
}

int main() {
    std::vector<int> a = {5, 1, 4, 2, 8, 3};
    bubbleSort(a);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "insertion-sort",
    name: "Insertion Sort",
    category: "Searching & Sorting",
    description: "Builds the sorted array one element at a time with O(n^2) time complexity.",
    code: `#include <vector>
#include <iostream>

void insertionSort(std::vector<int>& a) {
    int n = (int)a.size();
    for (int i = 1; i < n; i++) {
        int key = a[i];
        int j = i - 1;
        while (j >= 0 && a[j] > key) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = key;
    }
}

int main() {
    std::vector<int> a = {9, 5, 1, 4, 3, 7};
    insertionSort(a);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "selection-sort",
    name: "Selection Sort",
    category: "Searching & Sorting",
    description: "Repeatedly selects the minimum remaining element with O(n^2) time complexity.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

void selectionSort(std::vector<int>& a) {
    int n = (int)a.size();
    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < n; j++) {
            if (a[j] < a[minIdx]) {
                minIdx = j;
            }
        }
        std::swap(a[i], a[minIdx]);
    }
}

int main() {
    std::vector<int> a = {6, 3, 8, 1, 5, 2};
    selectionSort(a);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "heap-sort",
    name: "Heap Sort",
    category: "Searching & Sorting",
    description: "Sorts via a binary max-heap with O(n log n) time complexity.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

void heapify(std::vector<int>& a, int n, int i) {
    int largest = i;
    int left = 2 * i + 1;
    int right = 2 * i + 2;
    if (left < n && a[left] > a[largest]) largest = left;
    if (right < n && a[right] > a[largest]) largest = right;
    if (largest != i) {
        std::swap(a[i], a[largest]);
        heapify(a, n, largest);
    }
}

void heapSort(std::vector<int>& a) {
    int n = (int)a.size();
    for (int i = n / 2 - 1; i >= 0; i--) {
        heapify(a, n, i);
    }
    for (int i = n - 1; i > 0; i--) {
        std::swap(a[0], a[i]);
        heapify(a, i, 0);
    }
}

int main() {
    std::vector<int> a = {4, 10, 3, 5, 1, 8};
    heapSort(a);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "counting-sort",
    name: "Counting Sort",
    category: "Searching & Sorting",
    description: "Sorts non-negative integers by counting frequencies with O(n + k) time complexity.",
    code: `#include <vector>
#include <iostream>
#include <algorithm>

void countingSort(std::vector<int>& a) {
    int n = (int)a.size();
    if (n == 0) return;
    int maxVal = a[0];
    for (int i = 1; i < n; i++) {
        if (a[i] > maxVal) maxVal = a[i];
    }
    std::vector<int> count(maxVal + 1, 0);
    for (int i = 0; i < n; i++) {
        count[a[i]]++;
    }
    int idx = 0;
    for (int v = 0; v <= maxVal; v++) {
        for (int c = 0; c < count[v]; c++) {
            a[idx] = v;
            idx++;
        }
    }
}

int main() {
    std::vector<int> a = {4, 2, 2, 8, 3, 3, 1};
    countingSort(a);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "merge-sort",
    name: "Merge Sort",
    category: "Searching & Sorting",
    description: "Stable divide-and-conquer merge sorting with O(n log n) time complexity.",
    code: `#include <vector>
#include <iostream>

void merge(std::vector<int>& a, int lo, int mid, int hi) {
    std::vector<int> tmp;
    int i = lo;
    int j = mid + 1;
    while (i <= mid && j <= hi) {
        if (a[i] <= a[j]) {
            tmp.push_back(a[i]);
            i++;
        } else {
            tmp.push_back(a[j]);
            j++;
        }
    }
    while (i <= mid) {
        tmp.push_back(a[i]);
        i++;
    }
    while (j <= hi) {
        tmp.push_back(a[j]);
        j++;
    }
    for (int k = 0; k < (int)tmp.size(); k++) {
        a[lo + k] = tmp[k];
    }
}

void mergeSort(std::vector<int>& a, int lo, int hi) {
    if (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        mergeSort(a, lo, mid);
        mergeSort(a, mid + 1, hi);
        merge(a, lo, mid, hi);
    }
}

int main() {
    std::vector<int> a = {8, 4, 2, 9, 5, 1, 6};
    mergeSort(a, 0, (int)a.size() - 1);
    std::cout << "Sorted array: ";
    for (int x : a) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "two-pointers",
    name: "Two Pointers Pair Sum",
    category: "Searching & Sorting",
    description: "Finds a target pair in a sorted array with O(n) time complexity.",
    code: `#include <vector>
#include <iostream>

int pairSum(std::vector<int>& arr, int target, int& outA, int& outB) {
    int lo = 0;
    int hi = (int)arr.size() - 1;
    while (lo < hi) {
        int s = arr[lo] + arr[hi];
        if (s == target) {
            outA = arr[lo];
            outB = arr[hi];
            return 1;
        } else if (s < target) {
            lo++;
        } else {
            hi--;
        }
    }
    return 0;
}

int main() {
    std::vector<int> arr = {1, 2, 4, 6, 8, 11};
    int target = 10;
    int a = 0;
    int b = 0;
    int found = pairSum(arr, target, a, b);
    if (found == 1) {
        std::cout << "Pair found: " << a << " + " << b << " = " << target << std::endl;
    } else {
        std::cout << "No pair found" << std::endl;
    }
    return 0;
}
`,
  },
  {
    id: "sliding-window-maximum",
    name: "Sliding Window Maximum",
    category: "Strings",
    description: "Finds the maximum of each sliding window of size k with O(n) time complexity.",
    code: `#include <vector>
#include <iostream>
#include <deque>

std::vector<int> slidingMax(std::vector<int>& a, int k) {
    std::vector<int> result;
    std::deque<int> dq;
    for (int i = 0; i < (int)a.size(); i++) {
        while (!dq.empty() && dq.front() <= i - k) {
            dq.pop_front();
        }
        while (!dq.empty() && a[dq.back()] < a[i]) {
            dq.pop_back();
        }
        dq.push_back(i);
        if (i >= k - 1) {
            result.push_back(a[dq.front()]);
        }
    }
    return result;
}

int main() {
    std::vector<int> a = {1, 3, -1, -3, 5, 3, 6, 7};
    int k = 3;
    std::vector<int> result = slidingMax(a, k);
    std::cout << "Window maximums: ";
    for (int x : result) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
  {
    id: "sieve-of-eratosthenes",
    name: "Sieve of Eratosthenes",
    category: "Math & Misc",
    description: "Finds all primes up to n by marking multiples with O(n log log n) time complexity.",
    code: `#include <vector>
#include <iostream>

std::vector<int> sieve(int n) {
    std::vector<int> isPrime(n + 1, 1);
    std::vector<int> primes;
    if (n < 2) return primes;
    isPrime[0] = 0;
    isPrime[1] = 0;
    for (int i = 2; i * i <= n; i++) {
        if (isPrime[i] == 1) {
            for (int j = i * i; j <= n; j = j + i) {
                isPrime[j] = 0;
            }
        }
    }
    for (int i = 2; i <= n; i++) {
        if (isPrime[i] == 1) {
            primes.push_back(i);
        }
    }
    return primes;
}

int main() {
    int n = 30;
    std::vector<int> primes = sieve(n);
    std::cout << "Primes up to 30: ";
    for (int x : primes) std::cout << x << " ";
    std::cout << std::endl;
    return 0;
}
`,
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Fuzzy slug<->preset match on id or name; undefined = no runnable preset. */
export function findPreset(e: AlgorithmEntry): CodePreset | undefined {
  const sn = norm(e.slug);
  const nm = norm(e.name);
  return CODE_PRESETS.find((p) => {
    const id = norm(p.id);
    const pn = norm(p.name);
    return (
      sn.includes(id) || id.includes(sn) || nm.includes(pn) || pn.includes(nm)
    );
  });
}
