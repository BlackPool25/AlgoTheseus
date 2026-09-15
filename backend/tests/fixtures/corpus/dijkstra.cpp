// dijkstra.cpp — Dijkstra shortest paths with dist table.
#include <iostream>
#include <vector>

void dijkstra(int src, std::vector<std::vector<int>>& graph, std::vector<int>& dist) {
    int n = (int)graph.size();
    std::vector<int> done(n, 0);
    for (int i = 0; i < n; i++) {
        dist[i] = 1000000;
    }
    dist[src] = 0;
    for (int count = 0; count < n; count++) {
        int u = -1;
        int best = 1000000;
        for (int i = 0; i < n; i++) {
            if (done[i] == 0 && dist[i] < best) {
                best = dist[i];
                u = i;
            }
        }
        if (u == -1) {
            break;
        }
        done[u] = 1;
        for (int v = 0; v < n; v++) {
            if (graph[u][v] > 0 && done[v] == 0) {
                int alt = dist[u] + graph[u][v];
                if (alt < dist[v]) {
                    dist[v] = alt;
                }
            }
        }
    }
}

int main() {
    std::vector<std::vector<int>> graph = {{0, 4, 0, 0}, {4, 0, 2, 5}, {0, 2, 0, 1}, {0, 5, 1, 0}};
    std::vector<int> dist(4, 0);
    dijkstra(0, graph, dist);
    for (size_t i = 0; i < dist.size(); i++) {
        std::cout << dist[i] << " ";
    }
    std::cout << std::endl;
    return 0;
}
