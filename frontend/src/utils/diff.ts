/**
 * utils/diff.ts — Simple line-based diff (LCS).
 *
 * Splits text into lines and computes a minimal edit sequence
 * so the DiffViewer can render side-by-side additions / deletions.
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  /** One of "equal", "add", "remove" */
  op: DiffOp;
  /** Line from the left (expected) side — null for additions */
  left: string | null;
  /** Line from the right (actual) side — null for removals */
  right: string | null;
  /** Line numbers for gutter display (1-based) */
  leftNum: number | null;
  rightNum: number | null;
}

/**
 * Compute a line-level diff between two strings.
 * Uses a longest-common-subsequence approach so the alignment
 * is readable in a side-by-side view.
 */
export function computeLineDiff(expected: string, actual: string): DiffLine[] {
  const leftLines = expected === "" ? [] : expected.split("\n");
  const rightLines = actual === "" ? [] : actual.split("\n");

  const m = leftLines.length;
  const n = rightLines.length;

  // ── LCS table ──────────────────────────────────────────────
  // dp[i][j] = length of LCS of leftLines[0..i) and rightLines[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // ── Backtrack → edit sequence ──────────────────────────────
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      stack.push({
        op: "equal",
        left: leftLines[i - 1],
        right: rightLines[j - 1],
        leftNum: i,
        rightNum: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        op: "add",
        left: null,
        right: rightLines[j - 1],
        leftNum: null,
        rightNum: j,
      });
      j--;
    } else if (i > 0) {
      stack.push({
        op: "remove",
        left: leftLines[i - 1],
        right: null,
        leftNum: i,
        rightNum: null,
      });
      i--;
    }
  }

  // Reverse to restore original order
  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  return result;
}

/**
 * Count how many lines are different in a diff result.
 * Useful for showing "X lines changed" summary.
 */
export function countChanges(diff: DiffLine[]): { adds: number; removals: number } {
  let adds = 0;
  let removals = 0;
  for (const line of diff) {
    if (line.op === "add") adds++;
    if (line.op === "remove") removals++;
  }
  return { adds, removals };
}
