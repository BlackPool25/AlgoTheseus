/**
 * components/DiffViewer/DiffViewer.tsx — Side-by-side diff viewer for
 * expected vs actual output comparison after batch execution.
 *
 * Features:
 * - Side-by-side line-level diff with colour highlighting
 * - Pass / fail / no-expected badges per test case
 * - Test case name, status, and execution time
 * - Keyboard navigation (←/→) between test cases
 * - Empty-state messaging
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DiffLine,
  computeLineDiff,
  countChanges,
} from "../../utils/diff";

/* ── Types ─────────────────────────────────────────────────────── */

export interface DiffTestCase {
  testId: string;
  actual: string;
  expected: string;
  passed: boolean;
  runtime?: number;
}

interface DiffViewerProps {
  results: DiffTestCase[];
}

/* ── Status badge helper ───────────────────────────────────────── */

type BadgeKind = "pass" | "fail" | "no-expected";

function badgeKind(test: DiffTestCase): BadgeKind {
  if (test.expected === "") return "no-expected";
  return test.passed ? "pass" : "fail";
}

const BADGE_STYLES: Record<BadgeKind, string> = {
  pass:        "bg-green-500/15 text-green-400 border-green-500/30",
  fail:        "bg-red-500/15 text-red-400 border-red-500/30",
  "no-expected": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const BADGE_LABEL: Record<BadgeKind, string> = {
  pass:        "PASS",
  fail:        "FAIL",
  "no-expected": "NO EXPECTED",
};

/* ── Diff row colours ──────────────────────────────────────────── */

const ROW_COLORS: Record<
  DiffLine["op"],
  { left: string; right: string }
> = {
  equal:  { left: "", right: "" },
  add:    { left: "", right: "bg-emerald-500/10" },
  remove: { left: "bg-red-500/10", right: "" },
};

/* ── Component ─────────────────────────────────────────────────── */

export function DiffViewer({ results }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [expanded, setExpanded] = useState(true);

  // Clamp active index when results change
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIdx]);

  const active = results[activeIdx];

  // ── Keyboard navigation ────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (results.length === 0) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveIdx((p) => (p - 1 + results.length) % results.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setActiveIdx((p) => (p + 1) % results.length);
      }
    },
    [results.length],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    // Make the container focusable for keyboard events
    if (el.tabIndex < 0) el.tabIndex = 0;
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── Empty state ────────────────────────────────────────────
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-500 text-sm gap-2">
        <span className="text-zinc-600 text-lg">∅</span>
        <span>No test results to display</span>
      </div>
    );
  }

  const passCount = results.filter((r) => r.passed).length;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 select-none outline-none"
      tabIndex={0}
      role="group"
      aria-label="Diff viewer — use arrow keys to navigate test cases"
    >
      {/* ── Summary bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Test Results
        </span>
        <span className="text-xs font-mono">
          <span className="text-green-400">{passCount}</span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-400">{results.length}</span>
          <span className="text-zinc-600 ml-1">passed</span>
        </span>
      </div>

      {/* ── Active test case header ─────────────────────────── */}
      <div className="flex items-center justify-between gap-2 bg-zinc-900 rounded px-3 py-2 border border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          {/* Test case ID */}
          <span className="text-xs font-mono text-zinc-300 truncate" title={active.testId}>
            {active.testId}
          </span>

          {/* Badge */}
          <span
            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${BADGE_STYLES[badgeKind(active)]}`}
          >
            {BADGE_LABEL[badgeKind(active)]}
          </span>

          {/* Runtime */}
          {active.runtime !== undefined && (
            <span className="text-[11px] text-zinc-500 font-mono">
              {active.runtime}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Expand / collapse */}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={expanded ? "Collapse diff" : "Expand diff"}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600 font-mono">
              {activeIdx + 1}/{results.length}
            </span>
            <button
              onClick={() =>
                setActiveIdx((p) => (p - 1 + results.length) % results.length)
              }
              className="text-zinc-400 hover:text-zinc-200 transition-colors text-sm leading-none"
              aria-label="Previous test case"
            >
              ◀
            </button>
            <button
              onClick={() =>
                setActiveIdx((p) => (p + 1) % results.length)
              }
              className="text-zinc-400 hover:text-zinc-200 transition-colors text-sm leading-none"
              aria-label="Next test case"
            >
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* ── Diff content ────────────────────────────────────── */}
      {expanded && <DiffContent test={active} />}
    </div>
  );
}

/* ── Side-by-side diff body ────────────────────────────────────── */

function DiffContent({ test }: { test: DiffTestCase }) {
  const diff = useMemo(
    () => computeLineDiff(test.expected, test.actual),
    [test.expected, test.actual],
  );

  const changes = useMemo(() => countChanges(diff), [diff]);

  const hasNoExpected = test.expected === "";
  const noDiff = changes.adds === 0 && changes.removals === 0;

  // ── No expected output banner ─────────────────────────────
  if (hasNoExpected) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-center text-xs text-zinc-500">
        No expected output provided for this test case.
      </div>
    );
  }

  // ── Perfect match banner ──────────────────────────────────
  if (noDiff) {
    return (
      <div className="rounded border border-green-800/30 bg-green-900/10 p-4 text-center text-xs text-green-400">
        Output matches expected — no differences.
      </div>
    );
  }

  // ── Summary: X lines changed ──────────────────────────────
  const changeParts: string[] = [];
  if (changes.removals > 0) changeParts.push(`${changes.removals} removed`);
  if (changes.adds > 0) changeParts.push(`${changes.adds} added`);

  return (
    <div className="rounded border border-zinc-800 overflow-hidden">
      {/* Changes summary */}
      <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-3 text-[11px] font-mono">
        <span className="text-zinc-500">{diff.length} lines</span>
        {changeParts.length > 0 && (
          <span className="text-zinc-600">·</span>
        )}
        {changes.removals > 0 && (
          <span className="text-red-400">−{changes.removals}</span>
        )}
        {changes.adds > 0 && (
          <span className="text-green-400">+{changes.adds}</span>
        )}
      </div>

      {/* Column headers */}
      <div className="flex border-b border-zinc-800 text-[11px] font-medium text-zinc-500 bg-zinc-900/50">
        <div className="flex-1 px-3 py-1.5 border-r border-zinc-800">
          Expected
        </div>
        <div className="flex-1 px-3 py-1.5">Actual</div>
      </div>

      {/* Diff lines */}
      <div className="flex flex-col">
        {diff.map((line, idx) => (
          <DiffRow key={idx} line={line} />
        ))}
      </div>
    </div>
  );
}

/* ── Single diff row (side-by-side) ───────────────────────────── */

function DiffRow({ line }: { line: DiffLine }) {
  const colors = ROW_COLORS[line.op];

  const leftContent =
    line.op === "add" ? (
      <span className="text-zinc-600 italic">—</span>
    ) : (
      <span className="whitespace-pre">{line.left}</span>
    );

  const rightContent =
    line.op === "remove" ? (
      <span className="text-zinc-600 italic">—</span>
    ) : (
      <span className="whitespace-pre">{line.right}</span>
    );

  const opMark =
    line.op === "add" ? (
      <span className="text-green-500 mr-1 shrink-0">+</span>
    ) : line.op === "remove" ? (
      <span className="text-red-500 mr-1 shrink-0">−</span>
    ) : null;

  return (
    <div className="flex text-xs font-mono leading-5 border-b border-zinc-800/30 last:border-b-0">
      {/* Left (expected) */}
      <div
        className={`flex-1 flex items-start px-3 py-0.5 border-r border-zinc-800/30 ${colors.left}`}
      >
        <span className="text-zinc-600 w-6 shrink-0 text-right mr-2 select-none">
          {line.leftNum ?? ""}
        </span>
        <span className="min-w-0 break-all">{leftContent}</span>
      </div>

      {/* Right (actual) */}
      <div
        className={`flex-1 flex items-start px-3 py-0.5 ${colors.right}`}
      >
        <span className="text-zinc-600 w-6 shrink-0 text-right mr-2 select-none">
          {line.rightNum ?? ""}
        </span>
        {opMark}
        <span className="min-w-0 break-all">{rightContent}</span>
      </div>
    </div>
  );
}
