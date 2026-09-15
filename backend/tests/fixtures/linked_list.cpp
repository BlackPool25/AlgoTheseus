// linked_list.cpp — fixture for struct serializer identity tests (todo 15).
// TreeNode with left/right + self-referential cycle + aliasing pair.
#include <iostream>

struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
};

struct SelfRef {
    int val;
    SelfRef* self;
};

int main() {
    TreeNode* root = new TreeNode{1, new TreeNode{2, nullptr, nullptr}, new TreeNode{3, nullptr, nullptr}};
    TreeNode* alias = root;
    SelfRef* s = new SelfRef{9, nullptr};
    s->self = s;
    std::cout << "built " << root->val << alias->val << s->val << std::endl;
    return 0;
}
