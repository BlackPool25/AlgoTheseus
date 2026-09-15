// bfs.cpp — BFS with visited set and a vector-backed queue named `queue`.
#include <iostream>
#include <vector>

void bfs(int start, std::vector<std::vector<int>>& adj, std::vector<int>& visited) {
    std::vector<int> queue;
    int head = 0;
    queue.push_back(start);
    visited[start] = 1;
    while (head < (int)queue.size()) {
        int u = queue[head];
        head = head + 1;
        for (size_t v = 0; v < adj[u].size(); v++) {
            if (adj[u][v] == 1 && visited[v] == 0) {
                visited[v] = 1;
                queue.push_back((int)v);
            }
        }
    }
}

int main() {
    std::vector<std::vector<int>> adj = {{0, 1, 1, 0}, {1, 0, 0, 1}, {1, 0, 0, 1}, {0, 1, 1, 0}};
    std::vector<int> visited = {0, 0, 0, 0};
    bfs(0, adj, visited);
    for (size_t i = 0; i < visited.size(); i++) {
        std::cout << visited[i] << " ";
    }
    std::cout << std::endl;
    return 0;
}
