/**
 * components/Scrubber/TraceScrubber.tsx — Step slider + prev/next buttons.
 *
 * Keyboard navigation is handled by useTraceNavigation hook.
 * Shows: "Step 3 / 16 — bsearch() line 8"
 * Shows a truncation warning if the trace was cut.
 *
 * Compressed-step groups (consecutive STATE events with identical vars) are
 * displayed as "Steps X-Y / Z (×N identical)".  Click the ⇕ button to expand
 * or collapse the group.  When collapsed, prev/next skip the entire group.
 */

import { useMemo, useRef } from "react";
import { useTraceNavigation } from "../../hooks/useTraceNavigation";
import { useUIStore } from "../../store/uiStore";
import { useTraceStore } from "../../store/traceStore";
import type { CompressedStep } from "../../store/traceStore";

/** Find the (collapsed) compressed group that contains `step`, or null. */
function groupAtStep(
  groups: CompressedStep[],
  expanded: number[],
  step: number,
): CompressedStep | null {
  for (const g of groups) {
    if (step >= g.startStep && step <= g.endStep && !expanded.includes(g.startStep)) {
      return g;
    }
  }
  return null;
}

export function TraceScrubber() {
  const { totalSteps, currentStep, label: rawLabel, setStep, next, prev, canGoNext, canGoPrev } =
    useTraceNavigation();
  const truncated = useUIStore((s) => s.truncated);
  const compressedSteps = useTraceStore((s) => s.compressedSteps);
  const expandedGroups = useTraceStore((s) => s.expandedGroups);
  const toggleExpand = useTraceStore((s) => s.toggleExpand);

  const sliderRef = useRef<HTMLInputElement>(null);

  // Find the compressed group the user is currently inside (if any, and if collapsed)
  const activeGroup = groupAtStep(compressedSteps, expandedGroups, currentStep);

  // Build the display label — override when inside a compressed group
  const displayLabel = useMemo(() => {
    if (!activeGroup) return rawLabel;
    const prefix =
      activeGroup.startStep === activeGroup.endStep
        ? `Step ${activeGroup.startStep + 1}`
        : `Steps ${activeGroup.startStep + 1}–${activeGroup.endStep + 1}`;
    return `${prefix} / ${totalSteps} (×${activeGroup.count} identical) — ${rawLabel.split("—")[1]?.trim() ?? ""}`;
  }, [activeGroup, rawLabel, totalSteps]);

  // Build a "track map" — fraction of total steps each compressed group occupies
  const trackMap = useMemo(() => {
    if (totalSteps === 0) return [];
    return compressedSteps
      .filter((g) => !expandedGroups.includes(g.startStep))
      .map((g) => ({
        left: g.startStep / totalSteps,
        width: (g.endStep - g.startStep + 1) / totalSteps,
        startStep: g.startStep,
      }));
  }, [compressedSteps, expandedGroups, totalSteps]);

  if (totalSteps === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-4 py-2 bg-zinc-900 border-t border-zinc-800">
      {/* Label row — shows step info + expand/collapse toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400 font-mono">{displayLabel}</span>
        <div className="flex items-center gap-2">
          {activeGroup && (
            <button
              onClick={() => toggleExpand(activeGroup.startStep)}
              className="text-[10px] text-violet-400 hover:text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded border border-violet-500/30 transition-colors"
              title="Expand to see individual steps"
              aria-label="Expand compressed step group"
            >
              ⇕
            </button>
          )}
          {truncated && (
            <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/30">
              ⚠ trace truncated at {totalSteps} steps
            </span>
          )}
        </div>
      </div>

      {/* Slider row */}
      <div className="flex items-center gap-3">
        <button
          onClick={prev}
          disabled={!canGoPrev}
          className="text-zinc-400 hover:text-white disabled:opacity-30 transition-colors text-lg leading-none"
          aria-label="Previous step"
        >
          ‹
        </button>

        <div className="flex-1 relative">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={totalSteps - 1}
            value={currentStep}
            onChange={(e) => setStep(Number(e.target.value))}
            className="w-full accent-amber-400 h-1"
            aria-label="Trace step"
          />
          {/* Compressed-group indicators on the slider track */}
          {trackMap.length > 0 && (
            <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 pointer-events-none">
              {trackMap.map((seg) => (
                <div
                  key={seg.startStep}
                  className="absolute h-2 w-0.5 bg-violet-500/60 rounded-full"
                  style={{
                    left: `${seg.left * 100}%`,
                    width: `${Math.max(seg.width * 100, 0.2)}%`,
                  }}
                  title={`Steps ${seg.startStep + 1}–${seg.startStep + Math.round(seg.width * totalSteps) - 1} linked`}
                />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={next}
          disabled={!canGoNext}
          className="text-zinc-400 hover:text-white disabled:opacity-30 transition-colors text-lg leading-none"
          aria-label="Next step"
        >
          ›
        </button>
      </div>
    </div>
  );
}
