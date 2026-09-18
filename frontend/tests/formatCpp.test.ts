/**
 * tests/formatCpp.test.ts — formatCpp tidy locks.
 *
 * Run (no new deps — repo has no vitest; esbuild ships with vite):
 *   ../node_modules/.bin/esbuild tests/formatCpp.test.ts --bundle \
 *     --platform=node --format=esm \
 *     --outfile=/tmp/formatCpp.test.mjs --log-level=error \
 *   && node --test /tmp/formatCpp.test.mjs
 *
 * Contract: whitespace-only normalization to repo preset style (1TBS, 4-space
 * indent); string/comment contents untouched; idempotent.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCpp } from "../src/utils/formatCpp";

const BST_MESSY = `#include <iostream>
using namespace std;
struct TreeNode {
int val;
TreeNode* left;
TreeNode* right;
TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};
TreeNode* insert(TreeNode* root,int v)
{
if(root==nullptr)return new TreeNode(v);
if(v<root->val)root->left=insert(root->left,v);
else if(v>root->val)root->right=insert(root->right,v);
return root;
}


int main() {
TreeNode* root=nullptr;
cout<<"hi  there"<<endl;   // trailing spaces ok
return 0;
}
`;

describe("formatCpp", () => {
  it("normalizes BST sample to preset style", () => {
    const out = formatCpp(BST_MESSY);
    assert.match(out, /TreeNode\* insert\(TreeNode\* root, int v\) \{/);
    assert.match(out, /^ {4}if \(root == nullptr\) return new TreeNode\(v\);$/m);
    assert.match(out, /^ {4}if \(v<root->val\) root->left = insert\(root->left, v\);$/m);
    assert.match(out, /^ {4}else if \(v>root->val\) root->right = insert\(root->right, v\);$/m);
    assert.match(out, /^ {4}TreeNode\* root = nullptr;$/m);
    assert.match(out, /^ {4}cout << "hi {2}there" << endl; \/\/ trailing spaces ok$/m);
    assert.ok(!out.includes("root==nullptr"), "operators spaced");
    assert.ok(!out.includes("\n\n\n"), "blank runs collapsed");
    assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"), "single trailing newline");
  });

  it("leaves already-clean preset code byte-identical (stable)", () => {
    const clean = `#include <iostream>

using namespace std;

struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};

int main() {
    TreeNode* root = nullptr;
    return 0;
}
`;
    assert.equal(formatCpp(clean), clean);
  });

  it("is idempotent on messy input", () => {
    const once = formatCpp(BST_MESSY);
    assert.equal(formatCpp(once), once);
  });
});
