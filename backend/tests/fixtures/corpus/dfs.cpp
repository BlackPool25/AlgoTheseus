// dfs.cpp — recursive DFS over an adjacency matrix with visited set.
#include <iostream>
#include <vector>

void dfs(int u, std::vector<std::vector<int>>& adj, std::vector<int>& visited, std::vector<int>& order) {
    visited[u] = 1;
    order.push_back(u);
    for (size_t v = 0; v < adj[u].size(); v++) {
        if (adj[u][v] == 1 && visited[v] == 0) {
            dfs((int)v, adj, visited, order);
        }
    }
}

int main() {
    std::vector<std::vector<int>> adj = {{0, 1, 1, 0}, {1, 0, 0, 1}, {1, 0, 0, 1}, {0, 1, 1, 0}};
    std::vector<int> visited = {0, 0, 0, 0};
    std::vector<int> order;
    dfs(0, adj, visited, order);
    for (size_t i = 0; i < order.size(); i++) {
        std::cout << order[i] << " ";
    }
    std::cout << std::endl;
    return 0;
}
