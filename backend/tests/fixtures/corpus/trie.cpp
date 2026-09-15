// trie.cpp — binary trie insert/search with terminal is_end flag.
#include <iostream>
#include <string>

struct TrieNode {
    TrieNode* child0;
    TrieNode* child1;
    int is_end;
};

TrieNode* new_node() {
    TrieNode* node = new TrieNode();
    node->child0 = nullptr;
    node->child1 = nullptr;
    node->is_end = 0;
    return node;
}

TrieNode* step_child(TrieNode* cur, int bit) {
    TrieNode* next = nullptr;
    if (bit == 0) {
        next = cur->child0;
    } else {
        next = cur->child1;
    }
    return next;
}

void set_child(TrieNode* cur, int bit, TrieNode* val) {
    if (bit == 0) {
        cur->child0 = val;
    } else {
        cur->child1 = val;
    }
}

void trie_insert(TrieNode* root, std::string& word) {
    TrieNode* cur = root;
    for (size_t i = 0; i < word.size(); i++) {
        int bit = (int)(word[i] - 'a') % 2;
        TrieNode* next = step_child(cur, bit);
        if (next == nullptr) {
            next = new_node();
            set_child(cur, bit, next);
        }
        cur = next;
    }
    cur->is_end = 1;
}

int trie_search(TrieNode* root, std::string& word) {
    TrieNode* cur = root;
    for (size_t i = 0; i < word.size(); i++) {
        int bit = (int)(word[i] - 'a') % 2;
        TrieNode* next = step_child(cur, bit);
        if (next == nullptr) {
            return 0;
        }
        cur = next;
    }
    return cur->is_end;
}

int main() {
    TrieNode* root = new_node();
    std::string word_a = "ab";
    std::string word_b = "ba";
    trie_insert(root, word_a);
    int hit = trie_search(root, word_a);
    int miss = trie_search(root, word_b);
    std::cout << hit << miss << std::endl;
    return 0;
}
