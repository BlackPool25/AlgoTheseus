# AlgoTheseus Keyword Map

<!-- PLACEHOLDER DOMAIN: https://www.example.com is not real. Replace with the
     real production origin everywhere in this file before launch. Same
     placeholder is used in frontend/public/sitemap.xml, frontend/public/robots.txt,
     frontend/index.html, frontend/public/_redirects, frontend/public/site.webmanifest,
     and frontend/.env.production.example (VITE_SITE_URL).
     Source of truth for slugs: frontend/src/content/algorithms.ts (ALGORITHM_SLUGS).
     Keep this file in sync if slugs are added/removed. -->

## Cluster → URL → keyword → intent → priority

| Cluster | URL | Primary keyword | Secondary keywords | Intent | Priority |
|---|---|---|---|---|---|
| Head (tool) | https://www.example.com/ | c++ algorithm visualizer | step-by-step c++ execution trace; interactive dsa visualization tool | Transactional (use the tool) | 1.0 |
| Searching | https://www.example.com/visualize/binary-search | binary search visualization | binary search C++ example; binary search time complexity | Informational | 0.8 |
| Sorting | https://www.example.com/visualize/quick-sort | quick sort visualization | quick sort C++ example; quick sort time complexity | Informational | 0.8 |
| Sorting | https://www.example.com/visualize/merge-sort | merge sort visualization | merge sort C++ example; merge sort time complexity | Informational | 0.8 |
| Graphs | https://www.example.com/visualize/breadth-first-search | breadth-first search visualization | BFS C++ example; BFS shortest path unweighted graph | Informational | 0.8 |
| Graphs | https://www.example.com/visualize/depth-first-search | depth-first search visualization | DFS C++ example; DFS vs BFS | Informational | 0.8 |
| Graphs | https://www.example.com/visualize/dijkstra | dijkstra algorithm visualization | dijkstra C++ priority queue example; dijkstra time complexity | Informational | 0.8 |
| Data structures | https://www.example.com/visualize/stack | stack data structure visualization | stack C++ STL example; stack push pop complexity | Informational | 0.8 |
| Data structures | https://www.example.com/visualize/queue | queue data structure visualization | queue C++ STL example; queue vs stack | Informational | 0.8 |
| Legal (noindex) | https://www.example.com/privacy | — (none; noindex) | — | Navigational/legal | none |
| Legal (noindex) | https://www.example.com/terms | — (none; noindex) | — | Navigational/legal | none |
| Legal (noindex) | https://www.example.com/contact | — (none; noindex) | — | Navigational/legal | none |

Notes:

- Primary/secondary keywords for the 8 `/visualize/*` rows mirror
  `primaryKeyword` / `secondaryKeywords` in `frontend/src/content/algorithms.ts`.
  Update both together.
- `/privacy`, `/terms`, `/contact` are marked noindex-priority/none: they stay
  in the sitemap for crawl completeness but target no keyword and carry
  `noindex` intent (set via route-level robots meta, not via keyword targeting).
- Internal-link rule: every `/visualize/*` page links to 3 siblings + `/`
  (see `frontend/src/routes/Visualize.tsx`); every page renders the shared
  `Footer` with Privacy / Terms / Contact + GitHub star/contribute links, so
  all 12 content URLs are one click from anywhere.

## Backlog — next 20 algorithm slugs to add

When a slug ships: add its row above, add its absolute URL to
`frontend/public/sitemap.xml`, and add its entry to `algorithms.ts`.

1. `linked-list` — linked list visualization
2. `binary-search-tree` — binary search tree visualization
3. `heap` — binary heap visualization
4. `hash-map` — hash map visualization
5. `trie` — trie visualization
6. `bubble-sort` — bubble sort visualization
7. `insertion-sort` — insertion sort visualization
8. `selection-sort` — selection sort visualization
9. `heap-sort` — heap sort visualization
10. `counting-sort` — counting sort visualization
11. `binary-tree-traversal` — binary tree traversal visualization
12. `graph-adjacency` — graph adjacency list visualization
13. `bellman-ford` — bellman-ford algorithm visualization
14. `floyd-warshall` — floyd-warshall algorithm visualization
15. `union-find` — union find visualization
16. `knapsack` — 0/1 knapsack visualization
17. `longest-common-subsequence` — longest common subsequence visualization
18. `fibonacci-dp` — fibonacci dynamic programming visualization
19. `sliding-window` — sliding window visualization
20. `two-pointers` — two pointers technique visualization
