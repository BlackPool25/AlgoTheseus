// knapsack.cpp — 0/1 knapsack DP with dp table.
#include <iostream>
#include <vector>

int knapsack(std::vector<int>& wt, std::vector<int>& val, int cap) {
    int n = (int)wt.size();
    std::vector<std::vector<int>> dp(n + 1, std::vector<int>(cap + 1, 0));
    for (int i = 1; i <= n; i++) {
        for (int w = 0; w <= cap; w++) {
            if (wt[i - 1] <= w) {
                int take = val[i - 1] + dp[i - 1][w - wt[i - 1]];
                int skip = dp[i - 1][w];
                if (take > skip) {
                    dp[i][w] = take;
                } else {
                    dp[i][w] = skip;
                }
            } else {
                dp[i][w] = dp[i - 1][w];
            }
        }
    }
    return dp[n][cap];
}

int main() {
    std::vector<int> wt = {1, 2, 3};
    std::vector<int> val = {6, 10, 12};
    int best = knapsack(wt, val, 5);
    std::cout << best << std::endl;
    return 0;
}
