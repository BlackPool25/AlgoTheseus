// singly_linked_list.cpp — singly-linked list with heap-allocated nodes.
#include <iostream>

struct ListNode {
    int val;
    ListNode* next;
};

ListNode* push_front(ListNode* head, int val) {
    ListNode* node = new ListNode{val, head};
    return node;
}

int list_sum(ListNode* head) {
    int total = 0;
    ListNode* cur = head;
    while (cur != nullptr) {
        total = total + cur->val;
        cur = cur->next;
    }
    return total;
}

int main() {
    ListNode* head = nullptr;
    head = push_front(head, 3);
    head = push_front(head, 2);
    head = push_front(head, 1);
    int total = list_sum(head);
    std::cout << total << std::endl;
    return 0;
}
