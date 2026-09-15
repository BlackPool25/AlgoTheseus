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
};

export function getAlgorithm(slug: string): AlgorithmEntry | undefined {
  return (ALGORITHMS as Record<string, AlgorithmEntry>)[slug];
}
