/**
 * Programmatic SEO content for /visualize/:slug pages.
 * Fixed slug contract — the sibling track builds the sitemap from ALGORITHM_SLUGS.
 * Keep in sync: adding/removing slugs breaks the sitemap.
 */

export interface AlgorithmEntry {
  slug: string;
  name: string;
  /** 40–60 word answer capsule, rendered first for AI-citation extraction. */
  answerCapsule: string;
  /** 4–7 ordered explanation steps, rendered as a real <ol>. */
  steps: string[];
  /** Sample C++ snippet, rendered in <pre>. */
  cppSnippet: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
}

export const ALGORITHM_SLUGS = [
  "binary-search",
  "quick-sort",
  "merge-sort",
  "breadth-first-search",
  "depth-first-search",
  "dijkstra",
  "stack",
  "queue",
  "linear-search",
  "bubble-sort",
  "insertion-sort",
  "selection-sort",
  "heap-sort",
  "counting-sort",
  "union-find",
  "topological-sort",
  "kruskal",
  "prim",
  "bellman-ford",
  "floyd-warshall",
  "cycle-detection",
  "knapsack-01",
  "longest-common-subsequence",
  "longest-increasing-subsequence",
  "coin-change",
  "edit-distance",
  "climbing-stairs",
  "kmp-string-matching",
  "sieve-of-eratosthenes",
  "singly-linked-list",
  "binary-search-tree",
  "trie",
  "heap-priority-queue",
  "hashmap",
  "sliding-window-maximum",
  "two-pointers",
] as const;

export type AlgorithmSlug = (typeof ALGORITHM_SLUGS)[number];

export const ALGORITHMS: Record<AlgorithmSlug, AlgorithmEntry> = {
  "binary-search": {
    slug: "binary-search",
    name: "Binary Search",
    answerCapsule:
      "Binary search finds a target value in a sorted array by repeatedly halving the search interval. Compare the middle element, discard the half that cannot contain the target, and repeat until found or exhausted. It runs in O(log n) time with O(1) space, making it ideal for fast lookups in sorted data.",
    steps: [
      "Require a sorted array; set low to the first index and high to the last index.",
      "While low is less than or equal to high, compute mid as low plus half the distance to high to avoid overflow.",
      "Compare the middle element with the target: equal means return mid as the answer.",
      "If the middle element is smaller than the target, move low to mid plus one; otherwise move high to mid minus one.",
      "If the loop ends without a match, return -1 to signal the target is absent.",
    ],
    cppSnippet: `int binarySearch(const vector<int>& a, int target) {
  int lo = 0, hi = (int)a.size() - 1;
  while (lo <= hi) {
    int mid = lo + (hi - lo) / 2;
    if (a[mid] == target) return mid;
    if (a[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}`,
    primaryKeyword: "binary search visualization",
    secondaryKeywords: [
      "binary search C++ example",
      "binary search time complexity",
    ],
  },
  "quick-sort": {
    slug: "quick-sort",
    name: "Quick Sort",
    answerCapsule:
      "Quick sort is a divide-and-conquer sorting algorithm that picks a pivot, partitions elements into smaller and larger groups, then recursively sorts each side. It averages O(n log n) time with O(log n) stack space, sorting in place with excellent cache behavior. Worst-case O(n squared) time occurs with consistently poor pivot choices on already ordered input.",
    steps: [
      "Choose a pivot element from the range, commonly the last element or a median-of-three.",
      "Partition the range so elements below the pivot come first and elements above it come last, then place the pivot at its final index.",
      "Recursively sort the left partition containing the smaller elements.",
      "Recursively sort the right partition containing the larger elements.",
      "Stop recursion on ranges of zero or one element, which are already sorted by definition.",
    ],
    cppSnippet: `int partition(vector<int>& a, int lo, int hi) {
  int pivot = a[hi], i = lo;
  for (int j = lo; j < hi; ++j)
    if (a[j] < pivot) swap(a[i++], a[j]);
  swap(a[i], a[hi]);
  return i;
}
void quickSort(vector<int>& a, int lo, int hi) {
  if (lo < hi) {
    int p = partition(a, lo, hi);
    quickSort(a, lo, p - 1);
    quickSort(a, p + 1, hi);
  }
}`,
    primaryKeyword: "quick sort visualization",
    secondaryKeywords: ["quick sort C++ example", "quick sort time complexity"],
  },
  "merge-sort": {
    slug: "merge-sort",
    name: "Merge Sort",
    answerCapsule:
      "Merge sort is a stable divide-and-conquer sorting algorithm that splits an array into halves, recursively sorts each half, then merges the sorted halves back together. It guarantees O(n log n) time in all cases at the cost of O(n) auxiliary space. Its predictable performance and stability make it ideal for linked lists and external sorting.",
    steps: [
      "Split the current range in half at its midpoint.",
      "Recursively sort the left half until it reaches a single element.",
      "Recursively sort the right half the same way.",
      "Merge the two sorted halves by repeatedly taking the smaller front element into a temporary buffer.",
      "Copy the merged buffer back over the original range.",
    ],
    cppSnippet: `void mergeSort(vector<int>& a, int lo, int hi, vector<int>& tmp) {
  if (hi - lo <= 1) return;
  int mid = lo + (hi - lo) / 2;
  mergeSort(a, lo, mid, tmp);
  mergeSort(a, mid, hi, tmp);
  int i = lo, j = mid, k = lo;
  while (i < mid && j < hi)
    tmp[k++] = (a[i] <= a[j]) ? a[i++] : a[j++];
  while (i < mid) tmp[k++] = a[i++];
  while (j < hi) tmp[k++] = a[j++];
  for (int t = lo; t < hi; ++t) a[t] = tmp[t];
}`,
    primaryKeyword: "merge sort visualization",
    secondaryKeywords: ["merge sort C++ example", "merge sort time complexity"],
  },
  "breadth-first-search": {
    slug: "breadth-first-search",
    name: "Breadth-First Search",
    answerCapsule:
      "Breadth-first search explores a graph level by level using a queue, visiting all neighbors of the start node before moving deeper. It guarantees the shortest path in unweighted graphs, running in O(V plus E) time with O(V) space. BFS powers shortest-path routing, connected-component labeling, and level-order tree traversal across many practical applications.",
    steps: [
      "Push the start node into a queue and mark it visited.",
      "While the queue is non-empty, pop the front node and process it.",
      "For each unvisited neighbor of the current node, mark it visited, record its parent for path reconstruction, and push it to the queue.",
      "Because nodes leave the queue in arrival order, every node is first reached via the shortest possible path.",
      "Stop early when the target is dequeued, or exhaust the queue to traverse the whole component.",
    ],
    cppSnippet: `vector<int> bfs(const vector<vector<int>>& g, int start) {
  vector<int> dist(g.size(), -1);
  queue<int> q;
  dist[start] = 0;
  q.push(start);
  while (!q.empty()) {
    int u = q.front(); q.pop();
    for (int v : g[u])
      if (dist[v] == -1) {
        dist[v] = dist[u] + 1;
        q.push(v);
      }
  }
  return dist;
}`,
    primaryKeyword: "breadth-first search visualization",
    secondaryKeywords: ["BFS C++ example", "BFS shortest path unweighted graph"],
  },
  "depth-first-search": {
    slug: "depth-first-search",
    name: "Depth-First Search",
    answerCapsule:
      "Depth-first search explores a graph by diving down each path to its end before backtracking, using a stack or recursion. It runs in O(V plus E) time with O(V) space and naturally produces topological orderings, connected components, and cycle detection. DFS underpins maze solving, dependency resolution, and exhaustive search strategies like backtracking.",
    steps: [
      "Start from the source node and mark it visited.",
      "Pick an unvisited neighbor and recurse into it immediately, going as deep as possible.",
      "When a node has no unvisited neighbors, backtrack to its parent and try the next neighbor.",
      "Track entry and exit times to classify edges and detect back edges, which reveal cycles.",
      "Repeat from any unvisited node to cover disconnected graphs.",
    ],
    cppSnippet: `void dfs(int u, const vector<vector<int>>& g, vector<char>& seen) {
  seen[u] = 1;
  for (int v : g[u])
    if (!seen[v]) dfs(v, g, seen);
}`,
    primaryKeyword: "depth-first search visualization",
    secondaryKeywords: ["DFS C++ example", "DFS vs BFS"],
  },
  dijkstra: {
    slug: "dijkstra",
    name: "Dijkstra's Algorithm",
    answerCapsule:
      "Dijkstra's algorithm finds the shortest paths from a source node to all others in a graph with non-negative edge weights. It repeatedly extracts the closest unsettled node from a min-priority queue and relaxes its outgoing edges, running in O(E log V) time with a binary heap. It drives GPS routing, network latency optimization, and cost-aware pathfinding systems.",
    steps: [
      "Initialize every distance to infinity except the source, which gets distance zero, and push the source into a min-heap.",
      "Pop the node with the smallest tentative distance; skip it if a better distance was already recorded.",
      "For each outgoing edge, compute the candidate distance through the current node.",
      "If the candidate improves the neighbor's distance, update it and push the neighbor into the heap.",
      "Repeat until the heap is empty; each popped node then holds its final shortest distance.",
    ],
    cppSnippet: `vector<long long> dijkstra(const vector<vector<pair<int,int>>>& g, int src) {
  const long long INF = 4e18;
  vector<long long> dist(g.size(), INF);
  using P = pair<long long,int>;
  priority_queue<P, vector<P>, greater<P>> pq;
  dist[src] = 0;
  pq.emplace(0, src);
  while (!pq.empty()) {
    auto [d, u] = pq.top(); pq.pop();
    if (d != dist[u]) continue;
    for (auto [v, w] : g[u])
      if (dist[v] > d + w) {
        dist[v] = d + w;
        pq.emplace(dist[v], v);
      }
  }
  return dist;
}`,
    primaryKeyword: "dijkstra algorithm visualization",
    secondaryKeywords: [
      "dijkstra C++ priority queue example",
      "dijkstra time complexity",
    ],
  },
  stack: {
    slug: "stack",
    name: "Stack",
    answerCapsule:
      "A stack is a last-in-first-out data structure where push adds an element to the top and pop removes the most recently added one. Both operations run in O(1) time, with peek inspecting the top without removal. Stacks implement function call frames, undo history, expression evaluation, bracket matching, and depth-first traversal across countless programs.",
    steps: [
      "Push adds a new element to the top of the stack in O(1) time.",
      "Pop removes and returns the top element, erroring on an empty stack instead of underflowing.",
      "Peek or top reads the most recent element without removing it.",
      "Check emptiness and size before popping to guard against underflow bugs.",
      "Use the call-stack mental model: each nested call pushes a frame, each return pops it.",
    ],
    cppSnippet: `#include <stack>
#include <stdexcept>

std::stack<int> st;
st.push(10);
st.push(20);
int top = st.top(); // 20, no removal
st.pop();           // removes 20
if (st.empty()) throw std::logic_error("underflow");
int next = st.top(); // 10`,
    primaryKeyword: "stack data structure visualization",
    secondaryKeywords: ["stack C++ STL example", "stack push pop complexity"],
  },
  queue: {
    slug: "queue",
    name: "Queue",
    answerCapsule:
      "A queue is a first-in-first-out data structure where enqueue adds elements at the back and dequeue removes them from the front. Both operations run in O(1) time, preserving arrival order exactly like a checkout line. Queues drive breadth-first search, task scheduling, buffering, and any producer-consumer pipeline that must process work fairly in order.",
    steps: [
      "Enqueue appends a new element to the back of the queue in O(1) time.",
      "Dequeue removes and returns the front element, the longest-waiting item.",
      "Front reads the next element to be served without removing it.",
      "Guard every dequeue with an emptiness check to avoid underflow.",
      "For double-ended needs, prefer a deque, which supports O(1) push and pop on both ends.",
    ],
    cppSnippet: `#include <queue>
#include <stdexcept>

std::queue<int> q;
q.push(10);
q.push(20);
int front = q.front(); // 10, no removal
q.pop();               // removes 10
if (q.empty()) throw std::logic_error("underflow");
int next = q.front(); // 20`,
    primaryKeyword: "queue data structure visualization",
    secondaryKeywords: ["queue C++ STL example", "queue vs stack"],
  },
  "linear-search": {
    slug: "linear-search",
    name: "Linear Search",
    answerCapsule:
      "Linear search scans an array element by element from first to last, comparing each value with the target until a match is found or the end is reached. It needs no sorted input and runs in O(n) time with O(1) space. Its simplicity makes it ideal for small or unsorted collections where setup-free lookup matters most.",
    steps: [
      "Start at the first index and compare the current element with the target.",
      "If the element matches, return its index immediately as the answer.",
      "Otherwise advance to the next index and repeat the comparison.",
      "Continue until the end of the array is reached without a match.",
      "Return -1 to signal the target is absent from the array.",
    ],
    cppSnippet: `int linearSearch(const vector<int>& a, int target) {
  for (int i = 0; i < (int)a.size(); ++i)
    if (a[i] == target) return i;
  return -1;
}`,
    primaryKeyword: "linear search visualization",
    secondaryKeywords: [
      "linear search C++ example",
      "linear search time complexity",
    ],
  },
  "bubble-sort": {
    slug: "bubble-sort",
    name: "Bubble Sort",
    answerCapsule:
      "Bubble sort repeatedly steps through an array, comparing adjacent pairs and swapping them when out of order, so the largest unsorted value bubbles to the end each pass. It runs in O(n squared) time with O(1) space, dropping to O(n) on nearly sorted input with early exit. Its simplicity suits teaching sorting fundamentals and tiny datasets.",
    steps: [
      "Loop over the array for as many passes as there are elements minus one.",
      "In each pass, compare every adjacent pair up to the unsorted boundary.",
      "Swap the pair whenever the left element is greater than the right one.",
      "After each pass the largest remaining value settles at the boundary, so shrink it by one.",
      "Stop early with a swapped flag: if a full pass makes no swaps, the array is sorted.",
    ],
    cppSnippet: `void bubbleSort(vector<int>& a) {
  int n = (int)a.size();
  for (int i = 0; i < n - 1; ++i) {
    bool swapped = false;
    for (int j = 0; j < n - 1 - i; ++j)
      if (a[j] > a[j + 1]) {
        swap(a[j], a[j + 1]);
        swapped = true;
      }
    if (!swapped) break;
  }
}`,
    primaryKeyword: "bubble sort visualization",
    secondaryKeywords: ["bubble sort C++ example", "bubble sort time complexity"],
  },
  "insertion-sort": {
    slug: "insertion-sort",
    name: "Insertion Sort",
    answerCapsule:
      "Insertion sort builds a sorted prefix one element at a time, taking each new value and shifting larger predecessors right until its slot opens. It runs in O(n squared) time with O(1) space, yet reaches O(n) on nearly sorted input. Its stability, simplicity, and online nature suit small arrays and incremental streaming data well.",
    steps: [
      "Treat the first element as a sorted prefix of length one.",
      "Take the next unsorted element and store it as the key.",
      "Shift every larger element of the sorted prefix one slot to the right.",
      "Insert the key into the gap left by the shifting.",
      "Repeat for each remaining element until the whole array is sorted.",
    ],
    cppSnippet: `void insertionSort(vector<int>& a) {
  int n = (int)a.size();
  for (int i = 1; i < n; ++i) {
    int key = a[i], j = i - 1;
    while (j >= 0 && a[j] > key) {
      a[j + 1] = a[j];
      --j;
    }
    a[j + 1] = key;
  }
}`,
    primaryKeyword: "insertion sort visualization",
    secondaryKeywords: [
      "insertion sort C++ example",
      "insertion sort time complexity",
    ],
  },
  "selection-sort": {
    slug: "selection-sort",
    name: "Selection Sort",
    answerCapsule:
      "Selection sort repeatedly finds the minimum of the unsorted suffix and swaps it into place, growing a sorted prefix from left to right. It always runs in O(n squared) time with O(1) space and minimal swaps, needing no extra memory. Its predictable behavior suits tiny arrays and systems where write operations cost far more than comparisons.",
    steps: [
      "Divide the array into a sorted prefix on the left and an unsorted suffix on the right.",
      "Scan the unsorted suffix to find the index of its minimum element.",
      "Swap that minimum with the first element of the unsorted suffix.",
      "Extend the sorted prefix by one and repeat on the remaining suffix.",
      "Stop when the suffix has one element left, which must already be the maximum.",
    ],
    cppSnippet: `void selectionSort(vector<int>& a) {
  int n = (int)a.size();
  for (int i = 0; i < n - 1; ++i) {
    int best = i;
    for (int j = i + 1; j < n; ++j)
      if (a[j] < a[best]) best = j;
    if (best != i) swap(a[i], a[best]);
  }
}`,
    primaryKeyword: "selection sort visualization",
    secondaryKeywords: [
      "selection sort C++ example",
      "selection sort time complexity",
    ],
  },
  "heap-sort": {
    slug: "heap-sort",
    name: "Heap Sort",
    answerCapsule:
      "Heap sort turns an array into a max-heap, then repeatedly extracts the largest element to the end and restores the heap property. It guarantees O(n log n) time in all cases with O(1) space, sorting in place without extra buffers. Its worst-case reliability suits memory-tight systems, though cache behavior lags behind quick sort.",
    steps: [
      "Build a max-heap from the array, starting from the last parent and sifting each node down.",
      "Swap the heap root, the current maximum, with the last element of the unsorted region.",
      "Shrink the heap boundary by one so the placed maximum stays fixed.",
      "Sift the new root down to restore the max-heap property.",
      "Repeat extraction and sifting until the heap holds a single element.",
    ],
    cppSnippet: `void siftDown(vector<int>& a, int n, int i) {
  while (true) {
    int big = i, l = 2 * i + 1, r = 2 * i + 2;
    if (l < n && a[l] > a[big]) big = l;
    if (r < n && a[r] > a[big]) big = r;
    if (big == i) break;
    swap(a[i], a[big]);
    i = big;
  }
}
void heapSort(vector<int>& a) {
  int n = (int)a.size();
  for (int i = n / 2 - 1; i >= 0; --i) siftDown(a, n, i);
  for (int end = n - 1; end > 0; --end) {
    swap(a[0], a[end]);
    siftDown(a, end, 0);
  }
}`,
    primaryKeyword: "heap sort visualization",
    secondaryKeywords: ["heap sort C++ example", "heap sort time complexity"],
  },
  "counting-sort": {
    slug: "counting-sort",
    name: "Counting Sort",
    answerCapsule:
      "Counting sort tallies how often each value occurs, builds prefix sums over those counts, then writes elements into sorted positions without any comparisons. It runs in O(n plus k) time with O(k) space for range size k. Its linear speed suits small integer ranges like ages, grades, or byte values.",
    steps: [
      "Find the minimum and maximum values to determine the counting range.",
      "Count occurrences of each value into a frequency array offset by the minimum.",
      "Convert frequencies into prefix sums so each slot knows its end position.",
      "Walk the input from back to front, placing each element into an output buffer and decrementing its count for stability.",
      "Copy the output buffer back over the original array.",
    ],
    cppSnippet: `void countingSort(vector<int>& a) {
  if (a.empty()) return;
  int lo = a[0], hi = a[0];
  for (int x : a) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  vector<int> cnt(hi - lo + 1, 0);
  for (int x : a) ++cnt[x - lo];
  int k = 0;
  for (int v = lo; v <= hi; ++v)
    while (cnt[v - lo]-- > 0) a[k++] = v;
}`,
    primaryKeyword: "counting sort visualization",
    secondaryKeywords: [
      "counting sort C++ example",
      "counting sort time complexity",
    ],
  },
  "union-find": {
    slug: "union-find",
    name: "Union-Find (Disjoint Set Union)",
    answerCapsule:
      "Union-Find tracks disjoint sets with near-constant amortized operations using path compression and union by rank. Each union merges two sets by attaching the shorter tree under the taller one, while find flattens paths to the root. It runs in O(alpha(V)) per operation and powers Kruskal's algorithm, connected components, and dynamic connectivity queries.",
    steps: [
      "Initialize every element as its own parent with rank zero.",
      "Find returns the set root, compressing the path so every visited node points directly at it.",
      "Union finds both roots and returns early when they already match.",
      "Attach the lower-rank root under the higher-rank one, incrementing rank on ties.",
      "Repeat find and union to answer connectivity queries or build a minimum spanning forest.",
    ],
    cppSnippet: `struct DSU {
  vector<int> p, r;
  DSU(int n) : p(n), r(n, 0) {
    for (int i = 0; i < n; ++i) p[i] = i;
  }
  int find(int x) {
    if (p[x] == x) return x;
    return p[x] = find(p[x]);
  }
  bool unite(int a, int b) {
    a = find(a); b = find(b);
    if (a == b) return false;
    if (r[a] < r[b]) swap(a, b);
    p[b] = a;
    if (r[a] == r[b]) ++r[a];
    return true;
  }
};`,
    primaryKeyword: "union find visualization",
    secondaryKeywords: ["DSU C++ example", "union find time complexity"],
  },
  "topological-sort": {
    slug: "topological-sort",
    name: "Topological Sort",
    answerCapsule:
      "Topological sort orders the vertices of a directed acyclic graph so every edge points forward from earlier to later. Kahn's algorithm repeatedly removes zero-indegree nodes using a queue, while DFS emits nodes in reverse finish order. It runs in O(V plus E) time and underpins build systems, task scheduling, and dependency resolution.",
    steps: [
      "Compute the indegree of every vertex from the adjacency list.",
      "Push all zero-indegree vertices into a queue as ready to emit.",
      "Pop a vertex, append it to the order, and decrement each neighbor's indegree.",
      "Push any neighbor whose indegree drops to zero into the queue.",
      "If the order holds every vertex the graph is acyclic; a shorter order proves a cycle exists.",
    ],
    cppSnippet: `vector<int> topoSort(const vector<vector<int>>& g) {
  int n = (int)g.size();
  vector<int> indeg(n, 0);
  for (int u = 0; u < n; ++u)
    for (int v : g[u]) ++indeg[v];
  queue<int> q;
  for (int i = 0; i < n; ++i)
    if (indeg[i] == 0) q.push(i);
  vector<int> order;
  while (!q.empty()) {
    int u = q.front(); q.pop();
    order.push_back(u);
    for (int v : g[u])
      if (--indeg[v] == 0) q.push(v);
  }
  return order;
}`,
    primaryKeyword: "topological sort visualization",
    secondaryKeywords: ["topological sort C++ example", "Kahn algorithm indegree queue"],
  },
  kruskal: {
    slug: "kruskal",
    name: "Kruskal's Algorithm",
    answerCapsule:
      "Kruskal's algorithm builds a minimum spanning tree by sorting all edges by weight and greedily adding the cheapest edge that connects two different components. A union-find structure tracks components in near-constant time per check. It runs in O(E log E) time dominated by sorting and suits sparse graphs, network design, and clustering tasks.",
    steps: [
      "Collect every edge as a weight plus endpoint pair and sort ascending by weight.",
      "Create a union-find structure with one set per vertex.",
      "Scan edges cheapest first and skip any edge whose endpoints already share a set.",
      "Add each connecting edge to the tree and union the two endpoint sets.",
      "Stop after V minus one edges; fewer means the graph is disconnected.",
    ],
    cppSnippet: `struct Edge { int u, v, w; };
int kruskal(int n, vector<Edge> edges, DSU& dsu) {
  sort(edges.begin(), edges.end(),
    [](const Edge& a, const Edge& b) { return a.w < b.w; });
  int total = 0;
  for (size_t i = 0; i < edges.size(); ++i) {
    int u = edges[i].u, v = edges[i].v, w = edges[i].w;
    if (dsu.unite(u, v)) total += w;
  }
  return total;
}`,
    primaryKeyword: "kruskal algorithm visualization",
    secondaryKeywords: ["kruskal C++ example", "minimum spanning tree time complexity"],
  },
  prim: {
    slug: "prim",
    name: "Prim's Algorithm",
    answerCapsule:
      "Prim's algorithm grows a minimum spanning tree from a start vertex by repeatedly attaching the cheapest edge crossing the cut between tree and non-tree vertices. A min-priority queue supplies the next closest vertex in O(E log V) time with a binary heap. It excels on dense graphs and powers wiring, road-network, and clustering layouts.",
    steps: [
      "Set the start vertex key to zero and all others to infinity, then push the start into a min-heap.",
      "Pop the vertex with the smallest key and mark it as part of the tree.",
      "For each adjacent edge, relax the neighbor key when the edge weight is smaller.",
      "Push improved neighbors into the heap with their new keys.",
      "Repeat until the heap empties; the parent pointers then describe the minimum spanning tree.",
    ],
    cppSnippet: `int prim(const vector<vector<pair<int,int>>>& g, int src) {
  const int INF = 2000000000;
  int n = (int)g.size();
  vector<int> key(n, INF);
  vector<char> inTree(n, 0);
  using P = pair<int,int>;
  priority_queue<P, vector<P>, greater<P>> pq;
  key[src] = 0;
  pq.emplace(0, src);
  int total = 0;
  while (!pq.empty()) {
    auto top = pq.top(); pq.pop();
    int u = top.second;
    if (inTree[u]) continue;
    inTree[u] = 1;
    total += top.first;
    for (size_t i = 0; i < g[u].size(); ++i) {
      int v = g[u][i].first, w = g[u][i].second;
      if (!inTree[v] && w < key[v]) {
        key[v] = w;
        pq.emplace(w, v);
      }
    }
  }
  return total;
}`,
    primaryKeyword: "prim algorithm visualization",
    secondaryKeywords: ["prim C++ priority queue example", "minimum spanning tree prim vs kruskal"],
  },
  "bellman-ford": {
    slug: "bellman-ford",
    name: "Bellman-Ford Algorithm",
    answerCapsule:
      "Bellman-Ford finds shortest paths from a source even when edges have negative weights, relaxing every edge V minus one times to propagate improvements. A final extra pass detects negative-weight cycles reachable from the source. It runs in O(V times E) time with O(V) space, making it the safe choice for graphs with possible negative costs.",
    steps: [
      "Set the source distance to zero and every other distance to infinity.",
      "Relax all edges V minus one times, improving any neighbor reachable through a shorter path.",
      "Stop early when a full pass makes no improvement.",
      "Run one more pass: any further improvement proves a reachable negative-weight cycle.",
      "Read final distances as shortest paths, or report the negative cycle when detected.",
    ],
    cppSnippet: `struct Edge { int u, v, w; };
vector<long long> bellmanFord(int n, const vector<Edge>& edges, int src) {
  const long long INF = 4e18;
  vector<long long> dist(n, INF);
  dist[src] = 0;
  for (int i = 0; i < n - 1; ++i) {
    bool changed = false;
    for (size_t e = 0; e < edges.size(); ++e) {
      int u = edges[e].u, v = edges[e].v, w = edges[e].w;
      if (dist[u] != INF && dist[v] > dist[u] + w) {
        dist[v] = dist[u] + w;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return dist;
}`,
    primaryKeyword: "bellman ford visualization",
    secondaryKeywords: ["bellman ford C++ example", "bellman ford negative cycle detection"],
  },
  "floyd-warshall": {
    slug: "floyd-warshall",
    name: "Floyd-Warshall Algorithm",
    answerCapsule:
      "Floyd-Warshall computes shortest paths between all pairs of vertices by progressively allowing each vertex as an intermediate stop. Triple nested loops relax every pair through vertex k, handling negative edges while flagging negative cycles on the diagonal. It runs in O(V cubed) time with O(V squared) space, ideal for dense graphs and small all-pairs routing tables.",
    steps: [
      "Build a distance matrix with zero on the diagonal, edge weights elsewhere, and infinity for missing edges.",
      "Loop k over every vertex as the allowed intermediate.",
      "For each pair i and j, relax dist[i][j] through dist[i][k] plus dist[k][j].",
      "Guard additions against infinity so unreachable paths stay infinite.",
      "After all passes, a negative diagonal entry marks a negative-weight cycle.",
    ],
    cppSnippet: `void floydWarshall(vector<vector<long long>>& d) {
  const long long INF = 4e18;
  int n = (int)d.size();
  for (int k = 0; k < n; ++k)
    for (int i = 0; i < n; ++i) {
      if (d[i][k] == INF) continue;
      for (int j = 0; j < n; ++j) {
        if (d[k][j] == INF) continue;
        if (d[i][j] > d[i][k] + d[k][j])
          d[i][j] = d[i][k] + d[k][j];
      }
    }
}`,
    primaryKeyword: "floyd warshall visualization",
    secondaryKeywords: ["floyd warshall C++ example", "all pairs shortest path complexity"],
  },
  "cycle-detection": {
    slug: "cycle-detection",
    name: "Cycle Detection (Directed Graph)",
    answerCapsule:
      "Directed cycle detection uses depth-first search with a three-color scheme: unvisited, on the current recursion stack, or fully explored. Reaching a node already on the stack reveals a back edge and therefore a cycle. It runs in O(V plus E) time with O(V) space and guards topological sorting, dependency graphs, and deadlock detection.",
    steps: [
      "Color every vertex white to mark it unvisited.",
      "Start DFS from each white vertex, coloring entry gray to flag the active recursion stack.",
      "For each neighbor, return true immediately when the neighbor is gray, since a back edge closes a cycle.",
      "Recurse into white neighbors and propagate any cycle found deeper.",
      "Color the vertex black on exit and continue; no gray hit across all starts means acyclic.",
    ],
    cppSnippet: `bool dfsCycle(int u, const vector<vector<int>>& g, vector<int>& color) {
  color[u] = 1;
  for (size_t i = 0; i < g[u].size(); ++i) {
    int v = g[u][i];
    if (color[v] == 1) return true;
    if (color[v] == 0 && dfsCycle(v, g, color)) return true;
  }
  color[u] = 2;
  return false;
}`,
    primaryKeyword: "cycle detection directed graph visualization",
    secondaryKeywords: ["directed cycle detection DFS C++", "detect cycle in graph colors"],
  },
  "knapsack-01": {
    slug: "knapsack-01",
    name: "0/1 Knapsack",
    answerCapsule:
      "The 0/1 knapsack problem picks a subset of items with given weights and values that maximizes total value without exceeding a capacity limit. An iterative dynamic programming table stores the best value for each item prefix and capacity, running in O(n times W) time with O(n times W) space. It models cargo loading, budgeting, and resource allocation decisions.",
    steps: [
      "Create a table dp with n plus one rows and capacity plus one columns, initialized to zero.",
      "For each item i from 1 to n, read its weight wt and value val.",
      "For each capacity w from 0 to W, copy dp[i-1][w] as the skip-item option.",
      "If wt fits within w, take the maximum of skipping and dp[i-1][w-wt] plus val.",
      "Return dp[n][W] as the maximum achievable value.",
    ],
    cppSnippet: `int knapsack01(const vector<int>& wt, const vector<int>& val, int W) {
  int n = (int)wt.size();
  vector<vector<int>> dp(n + 1, vector<int>(W + 1, 0));
  for (int i = 1; i <= n; ++i) {
    for (int w = 0; w <= W; ++w) {
      dp[i][w] = dp[i - 1][w];
      if (wt[i - 1] <= w) {
        int take = dp[i - 1][w - wt[i - 1]] + val[i - 1];
        if (take > dp[i][w]) dp[i][w] = take;
      }
    }
  }
  return dp[n][W];
}`,
    primaryKeyword: "0/1 knapsack visualization",
    secondaryKeywords: [
      "0/1 knapsack C++ example",
      "0/1 knapsack time complexity",
    ],
  },
  "longest-common-subsequence": {
    slug: "longest-common-subsequence",
    name: "Longest Common Subsequence",
    answerCapsule:
      "The longest common subsequence finds the longest sequence appearing as a subsequence in both strings, preserving order but not contiguity. An iterative table compares every prefix pair, extending matches diagonally and carrying forward the best of the top and left cells otherwise. It runs in O(m times n) time and space, powering diff tools and DNA alignment.",
    steps: [
      "Create a table dp with m plus one rows and n plus one columns, initialized to zero.",
      "For each i from 1 to m and each j from 1 to n, compare characters a[i-1] and b[j-1].",
      "On a match, set dp[i][j] to dp[i-1][j-1] plus one.",
      "On a mismatch, set dp[i][j] to the larger of dp[i-1][j] and dp[i][j-1].",
      "Return dp[m][n] as the LCS length, backtracking diagonally on matches to recover it.",
    ],
    cppSnippet: `int lcsLength(const string& a, const string& b) {
  int m = (int)a.size(), n = (int)b.size();
  vector<vector<int>> dp(m + 1, vector<int>(n + 1, 0));
  for (int i = 1; i <= m; ++i) {
    for (int j = 1; j <= n; ++j) {
      if (a[i - 1] == b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}`,
    primaryKeyword: "longest common subsequence visualization",
    secondaryKeywords: [
      "longest common subsequence C++ example",
      "longest common subsequence time complexity",
    ],
  },
  "longest-increasing-subsequence": {
    slug: "longest-increasing-subsequence",
    name: "Longest Increasing Subsequence",
    answerCapsule:
      "The longest increasing subsequence is the longest strictly increasing sequence obtainable by deleting elements without reordering. An iterative O(n squared) table extends every earlier smaller element, while the patience-sorting variant uses binary search over pile tops for O(n log n) time. It underpins scheduling, envelope nesting, and patience sorting analysis.",
    steps: [
      "Initialize dp[i] to 1 for every index, meaning each element alone forms length one.",
      "For each i from 0 to n minus one, scan every j before i.",
      "If a[j] is smaller than a[i], extend with dp[j] plus one and keep the maximum.",
      "Track the running maximum over all dp[i] as the answer length.",
      "Optionally store parent pointers to reconstruct one longest subsequence backwards.",
    ],
    cppSnippet: `int lisLength(const vector<int>& a) {
  int n = (int)a.size();
  if (n == 0) return 0;
  vector<vector<int>> dp(n, vector<int>(n, 0));
  vector<int> best(n, 1);
  for (int i = 0; i < n; ++i) {
    best[i] = 1;
    for (int j = 0; j < i; ++j) {
      if (a[j] < a[i] && best[j] + 1 > best[i]) best[i] = best[j] + 1;
    }
    dp[i][0] = best[i];
  }
  int ans = 0;
  for (int i = 0; i < n; ++i)
    if (best[i] > ans) ans = best[i];
  return ans;
}`,
    primaryKeyword: "longest increasing subsequence visualization",
    secondaryKeywords: [
      "longest increasing subsequence C++ example",
      "longest increasing subsequence time complexity",
    ],
  },
  "coin-change": {
    slug: "coin-change",
    name: "Coin Change",
    answerCapsule:
      "Coin change counts the combinations that make an amount, or finds the minimum coins needed, given unlimited denominations. An iterative table builds every amount from smaller ones coin by coin, running in O(coins times amount) time with O(amount) space. It teaches unbounded knapsack structure and models vending, change-making, and currency systems.",
    steps: [
      "Create dp with amount plus one entries, setting dp[0] to zero ways base and the rest to zero.",
      "For each coin denomination, iterate amounts from coin up to the target.",
      "Add dp[amt minus coin] into dp[amt] to count combinations without permuting coin order.",
      "For the minimum-coins variant, store large sentinels and relax dp[amt] with dp[amt minus coin] plus one.",
      "Return dp[amount], or -1 in the min-coins variant when the sentinel survives.",
    ],
    cppSnippet: `int coinChangeWays(const vector<int>& coins, int amount) {
  vector<vector<int>> dp(coins.size() + 1, vector<int>(amount + 1, 0));
  for (int i = 0; i <= (int)coins.size(); ++i) dp[i][0] = 1;
  for (int i = 1; i <= (int)coins.size(); ++i) {
    for (int amt = 0; amt <= amount; ++amt) {
      dp[i][amt] = dp[i - 1][amt];
      if (amt >= coins[i - 1]) dp[i][amt] += dp[i][amt - coins[i - 1]];
    }
  }
  return dp[coins.size()][amount];
}`,
    primaryKeyword: "coin change visualization",
    secondaryKeywords: [
      "coin change C++ example",
      "coin change dynamic programming complexity",
    ],
  },
  "edit-distance": {
    slug: "edit-distance",
    name: "Edit Distance",
    answerCapsule:
      "Edit distance, or Levenshtein distance, counts the minimum insertions, deletions, and substitutions needed to convert one string into another. An iterative table aligns every prefix pair, charging a substitution cost only on mismatch plus one-step insert and delete options. It runs in O(m times n) time and space, driving spellcheck and fuzzy matching.",
    steps: [
      "Create a table dp with m plus one rows and n plus one columns.",
      "Set dp[i][0] to i for deletions and dp[0][j] to j for insertions.",
      "For each i and j, compute the substitution cost: zero on match, one on mismatch.",
      "Set dp[i][j] to the minimum of deletion, insertion, and substitution candidates.",
      "Return dp[m][n] as the minimum edit count between the full strings.",
    ],
    cppSnippet: `int editDistance(const string& a, const string& b) {
  int m = (int)a.size(), n = (int)b.size();
  vector<vector<int>> dp(m + 1, vector<int>(n + 1, 0));
  for (int i = 0; i <= m; ++i) dp[i][0] = i;
  for (int j = 0; j <= n; ++j) dp[0][j] = j;
  for (int i = 1; i <= m; ++i) {
    for (int j = 1; j <= n; ++j) {
      int cost = (a[i - 1] == b[j - 1]) ? 0 : 1;
      dp[i][j] = min({dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost});
    }
  }
  return dp[m][n];
}`,
    primaryKeyword: "edit distance visualization",
    secondaryKeywords: [
      "edit distance C++ example",
      "edit distance time complexity",
    ],
  },
  "climbing-stairs": {
    slug: "climbing-stairs",
    name: "Climbing Stairs",
    answerCapsule:
      "Climbing stairs counts the distinct ways to reach step n when each move climbs one or two steps. The count follows the Fibonacci recurrence: ways[n] equals ways[n-1] plus ways[n-2], computed iteratively in O(n) time with O(1) space. It is the canonical first dynamic programming problem, modeling tiling, hopping, and composition counting.",
    steps: [
      "Define dp where dp[i] counts ways to reach step i, with dp[0] and dp[1] both one.",
      "For each step i from 2 to n, set dp[i] to dp[i-1] plus dp[i-2].",
      "Keep only two rolling variables to reduce space to O(1).",
      "Return the value at step n as the total number of distinct climbs.",
      "Recognize the Fibonacci structure to generalize to variable step sizes.",
    ],
    cppSnippet: `int climbStairs(int n) {
  if (n <= 1) return 1;
  vector<vector<int>> dp(2, vector<int>(n + 1, 0));
  dp[0][0] = 1;
  dp[0][1] = 1;
  for (int i = 2; i <= n; ++i) {
    dp[1][i] = dp[0][i - 1] + dp[0][i - 2];
    dp[0][i] = dp[1][i];
  }
  return dp[0][n];
}`,
    primaryKeyword: "climbing stairs visualization",
    secondaryKeywords: [
      "climbing stairs C++ example",
      "climbing stairs dynamic programming complexity",
    ],
  },
  "kmp-string-matching": {
    slug: "kmp-string-matching",
    name: "KMP String Matching",
    answerCapsule:
      "Knuth-Morris-Pratt search finds all occurrences of a pattern in text in linear time by never re-scanning matched characters. A prefix-function table records the longest proper prefix that is also a suffix for each position, so mismatches fall back cheaply. It runs in O(n plus m) time with O(m) space, ideal for plagiarism detection and log scanning.",
    steps: [
      "Build the lps prefix table for the pattern, tracking the longest prefix-suffix at each index.",
      "Align the pattern at text index i and pattern index j, both starting at zero.",
      "On a character match, advance both i and j together.",
      "On a mismatch with j nonzero, fall back with j set to lps[j-1] without moving i.",
      "When j reaches the pattern length, record a match and fall back via lps to continue.",
    ],
    cppSnippet: `vector<int> buildLps(const string& pat) {
  int m = (int)pat.size();
  vector<int> lps(m, 0);
  for (int i = 1, len = 0; i < m;) {
    if (pat[i] == pat[len]) lps[i++] = ++len;
    else if (len > 0) len = lps[len - 1];
    else lps[i++] = 0;
  }
  return lps;
}
vector<int> kmpSearch(const string& text, const string& pat) {
  vector<int> hits;
  vector<int> lps = buildLps(pat);
  for (int i = 0, j = 0; i < (int)text.size();) {
    if (text[i] == pat[j]) { ++i; ++j; }
    if (j == (int)pat.size()) {
      hits.push_back(i - j);
      j = lps[j - 1];
    } else if (i < (int)text.size() && text[i] != pat[j]) {
      if (j > 0) j = lps[j - 1];
      else ++i;
    }
  }
  return hits;
}`,
    primaryKeyword: "KMP string matching visualization",
    secondaryKeywords: [
      "KMP C++ example",
      "KMP time complexity",
    ],
  },
  "sieve-of-eratosthenes": {
    slug: "sieve-of-eratosthenes",
    name: "Sieve of Eratosthenes",
    answerCapsule:
      "The Sieve of Eratosthenes lists all primes up to n by iteratively marking multiples of each prime starting from two. Each unmarked number found is prime and crosses out its own multiples, running in O(n log log n) time with O(n) space. It is the fastest classical way to generate prime tables for factoring and cryptography setup.",
    steps: [
      "Create a boolean table isPrime of size n plus one, initially true except 0 and 1.",
      "For each p from 2 while p times p is at most n, skip already-marked composites.",
      "Mark multiples of p starting from p times p, stepping by p.",
      "Starting at p squared is safe because smaller multiples were crossed out earlier.",
      "Collect every index still marked true as a prime at the end.",
    ],
    cppSnippet: `vector<int> sieve(int n) {
  vector<char> isPrime(n + 1, 1);
  if (n >= 0) isPrime[0] = 0;
  if (n >= 1) isPrime[1] = 0;
  for (int p = 2; p * p <= n; ++p) {
    if (!isPrime[p]) continue;
    for (int m = p * p; m <= n; m += p) isPrime[m] = 0;
  }
  vector<int> primes;
  for (int i = 2; i <= n; ++i)
    if (isPrime[i]) primes.push_back(i);
  return primes;
}`,
    primaryKeyword: "sieve of Eratosthenes visualization",
    secondaryKeywords: [
      "sieve of Eratosthenes C++ example",
      "sieve of Eratosthenes time complexity",
    ],
  },
  "singly-linked-list": {
    slug: "singly-linked-list",
    name: "Singly Linked List",
    answerCapsule:
      "A singly linked list chains nodes where each node holds a value and a pointer to the next node. Traversal walks from head to null in O(n) time, while insertion at the head runs in O(1). Null checks on every pointer step guard against dereferencing freed or missing nodes.",
    steps: [
      "Define a ListNode struct with an integer value and a next pointer defaulting to null.",
      "Start traversal at head and advance node by node until the pointer is null.",
      "To insert at the head, point the new node at the current head and update head.",
      "To insert after a node, link the new node to its successor, then link the node forward.",
      "Always check pointers for null before dereferencing or advancing.",
    ],
    cppSnippet: `struct ListNode {
  int val;
  ListNode* next;
  ListNode(int x) : val(x), next(nullptr) {}
};
void traverse(ListNode* head) {
  for (ListNode* cur = head; cur != nullptr; cur = cur->next) {
    int v = cur->val;
    (void)v;
  }
}
void pushFront(ListNode*& head, int x) {
  ListNode* node = new ListNode(x);
  node->next = head;
  head = node;
}`,
    primaryKeyword: "singly linked list visualization",
    secondaryKeywords: ["linked list C++ example", "linked list insertion traversal"],
  },
  "binary-search-tree": {
    slug: "binary-search-tree",
    name: "Binary Search Tree",
    answerCapsule:
      "A binary search tree keeps smaller values in the left subtree and larger values in the right subtree, so insert and search walk down one path. Average operations cost O(log n) on balanced trees and degrade to O(n) when skewed. Recursive insert and search compare, then descend left or right until a null slot or match.",
    steps: [
      "Define a TreeNode struct with a value plus left and right pointers defaulting to null.",
      "To insert, compare with the current node and descend left for smaller or right otherwise.",
      "Attach the new node where a null child pointer is found.",
      "To search, compare the target and walk left or right until a match or null.",
      "Return the found node pointer, or null when the value is absent.",
    ],
    cppSnippet: `struct TreeNode {
  int val;
  TreeNode* left;
  TreeNode* right;
  TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
};
TreeNode* insertBST(TreeNode* root, int x) {
  if (root == nullptr) return new TreeNode(x);
  if (x < root->val) root->left = insertBST(root->left, x);
  else if (x > root->val) root->right = insertBST(root->right, x);
  return root;
}
TreeNode* searchBST(TreeNode* root, int x) {
  while (root != nullptr && root->val != x)
    root = (x < root->val) ? root->left : root->right;
  return root;
}`,
    primaryKeyword: "binary search tree visualization",
    secondaryKeywords: ["BST insert search C++ example", "binary search tree time complexity"],
  },
  trie: {
    slug: "trie",
    name: "Trie (Prefix Tree)",
    answerCapsule:
      "A trie stores strings as paths through nodes keyed by character, so shared prefixes share nodes. Insert and search each walk one node per character in O(L) time for word length L. Each node holds child links for the alphabet plus an end-of-word flag marking complete entries.",
    steps: [
      "Define a TrieNode with child links for each letter and an end-of-word flag.",
      "To insert, walk or create one child node per character of the word.",
      "Mark the final node as the end of a word.",
      "To search, walk one child per character and fail fast on a missing link.",
      "Return true only when every character exists and the final node is marked terminal.",
    ],
    cppSnippet: `struct TrieNode {
  TrieNode* child[26];
  bool isEnd;
  TrieNode() : isEnd(false) {
    for (int i = 0; i < 26; ++i) child[i] = nullptr;
  }
};
void trieInsert(TrieNode* root, const string& word) {
  TrieNode* cur = root;
  for (char ch : word) {
    int c = ch - 'a';
    if (cur->child[c] == nullptr) cur->child[c] = new TrieNode();
    cur = cur->child[c];
  }
  cur->isEnd = true;
}
bool trieSearch(TrieNode* root, const string& word) {
  TrieNode* cur = root;
  for (char ch : word) {
    int c = ch - 'a';
    if (cur->child[c] == nullptr) return false;
    cur = cur->child[c];
  }
  return cur->isEnd;
}`,
    primaryKeyword: "trie visualization",
    secondaryKeywords: ["trie prefix tree C++ example", "trie insert search complexity"],
  },
  "heap-priority-queue": {
    slug: "heap-priority-queue",
    name: "Heap (Priority Queue)",
    answerCapsule:
      "A binary heap serves the extreme element first, with push and pop each costing O(log n) and peek costing O(1). A max-heap returns the largest item while a min-heap returns the smallest. Priority queues built on heaps drive scheduling, Dijkstra's algorithm, and top-k selection efficiently.",
    steps: [
      "Use a max-heap by default, or pass greater for a min-heap.",
      "Push adds an element and sifts it up to restore the heap order.",
      "Top reads the extreme element without removing it.",
      "Pop removes the top and sifts the replacement down into place.",
      "Guard top and pop with an emptiness check before accessing.",
    ],
    cppSnippet: `int heapDemo() {
  priority_queue<int> pq;
  pq.push(5);
  pq.push(9);
  pq.push(3);
  int top = pq.top();
  pq.pop();
  int next = pq.top();
  return top + next;
}`,
    primaryKeyword: "heap priority queue visualization",
    secondaryKeywords: ["priority queue C++ example", "heap push pop complexity"],
  },
  hashmap: {
    slug: "hashmap",
    name: "HashMap (Unordered Map)",
    answerCapsule:
      "A hash map stores key-value pairs by hashing each key to a bucket, giving average O(1) insert, lookup, and erase. Frequency counting inserts or increments one entry per element in O(n) total time. Collisions resolve internally via chaining or open addressing without extra caller logic.",
    steps: [
      "Create an unordered map from key to integer count.",
      "Scan each element of the input exactly once.",
      "Look up the element in the map and increment its stored count, inserting zero first when absent.",
      "Read any key in average O(1) time through the hash lookup.",
      "Iterate the map entries to report each distinct key and its frequency.",
    ],
    cppSnippet: `unordered_map<int,int> countFreq(const vector<int>& a) {
  unordered_map<int,int> freq;
  for (int x : a) freq[x] += 1;
  return freq;
}`,
    primaryKeyword: "hashmap visualization",
    secondaryKeywords: ["unordered_map frequency count C++", "hashmap time complexity"],
  },
  "sliding-window-maximum": {
    slug: "sliding-window-maximum",
    name: "Sliding Window Maximum",
    answerCapsule:
      "Sliding window maximum reports the largest value in every window of size k in O(n) time using a deque of candidate indices. The deque stays decreasing, drops indices outside the window, and exposes each window's maximum at its front. Each element enters and leaves the deque once for linear total work.",
    steps: [
      "Use a deque holding indices with decreasing values, front being the current maximum.",
      "For each index, drop the front while it has fallen outside the window.",
      "Pop the back while its value is less than or equal to the new value.",
      "Push the current index at the back of the deque.",
      "Once the first full window ends, record the front value as that window's maximum.",
    ],
    cppSnippet: `vector<int> slidingMax(const vector<int>& a, int k) {
  deque<int> dq;
  vector<int> out;
  for (int i = 0; i < (int)a.size(); ++i) {
    while (!dq.empty() && dq.front() <= i - k) dq.pop_front();
    while (!dq.empty() && a[dq.back()] <= a[i]) dq.pop_back();
    dq.push_back(i);
    if (i >= k - 1) out.push_back(a[dq.front()]);
  }
  return out;
}`,
    primaryKeyword: "sliding window maximum visualization",
    secondaryKeywords: ["sliding window maximum deque C++", "sliding window O(n) algorithm"],
  },
  "two-pointers": {
    slug: "two-pointers",
    name: "Two Pointers (Sorted Two-Sum)",
    answerCapsule:
      "The two-pointers technique solves sorted two-sum in O(n) time with O(1) space by squeezing from both ends. When the pair sum is too small, move the left pointer right; when too large, move the right pointer left. The pointers meet at the answer or cross to prove no pair exists.",
    steps: [
      "Require a sorted array; place left at the first index and right at the last.",
      "While left is below right, compute the sum of both pointed values.",
      "If the sum equals the target, return the two indices.",
      "If the sum is smaller than the target, advance left to grow the sum.",
      "If the sum is larger than the target, retreat right to shrink it.",
    ],
    cppSnippet: `pair<int,int> twoSumSorted(const vector<int>& a, int target) {
  int lo = 0, hi = (int)a.size() - 1;
  while (lo < hi) {
    int s = a[lo] + a[hi];
    if (s == target) return {lo, hi};
    if (s < target) ++lo;
    else --hi;
  }
  return {-1, -1};
}`,
    primaryKeyword: "two pointers visualization",
    secondaryKeywords: ["two sum sorted C++ example", "two pointers technique complexity"],
  },
};

export function getAlgorithm(slug: string): AlgorithmEntry | undefined {
  return (ALGORITHMS as Record<string, AlgorithmEntry>)[slug];
}
