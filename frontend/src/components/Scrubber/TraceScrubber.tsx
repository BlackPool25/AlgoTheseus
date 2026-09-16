/**
 * components/Scrubber/TraceScrubber.tsx — Step slider + playback controls.
 *
 * Keyboard navigation is handled by useTraceNavigation hook.
 * Shows: "Step 3 / 16 — bsearch() line 8"
 * Supports Play / Pause auto-stepping, speed toggle, and touch optimization.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Gauge,
} from "lucide-react";
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

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1); // 0.5x, 1x, 2x

  const sliderRef = useRef<HTMLInputElement>(null);

  // Auto-play timer
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.round(450 / speed);
    const timer = setInterval(() => {
      const state = useTraceStore.getState();
      if (state.currentStep >= state.totalSteps - 1) {
        setIsPlaying(false);
      } else {
        state.setStep(state.currentStep + 1);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, speed]);

  const handleSliderChange = (value: number): void => {
    setStep(value);
  };

  const cycleSpeed = () => {
    setSpeed((s) => (s === 0.5 ? 1 : s === 1 ? 2 : 0.5));
  };

  // Find the compressed group the user is currently inside (if any, and if collapsed)
  const activeGroup = groupAtStep(compressedSteps, expandedGroups, currentStep);

  // Build the display label — override when inside a compressed group
  const displayLabel = useMemo(() => {
    if (!activeGroup) return rawLabel;
    const prefix =
      activeGroup.startStep === activeGroup.endStep
        ? `Step ${activeGroup.startStep + 1}`
        : `Steps ${activeGroup.startStep + 1}–${activeGroup.endStep + 1}`;
    return `${prefix} / ${totalSteps} (${activeGroup.count} identical steps) — ${rawLabel.split("—")[1]?.trim() ?? ""}`;
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
    <div className="flex flex-col gap-1.5 px-3 md:px-5 py-2.5 bg-viz-body border-t border-viz-line select-none z-30">
      {/* Label row — shows step info + expand/collapse toggle + speed badge */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-viz-ink/80 truncate">
            {displayLabel}
          </span>
          {activeGroup && (
            <button
              onClick={() => toggleExpand(activeGroup.startStep)}
              className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 transition-colors shrink-0 font-mono"
              title="Expand to see individual steps"
              aria-label="Expand compressed step group"
            >
              ⇕ expand group
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {truncated && (
            <span className="text-[10px] text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/30">
              ⚠ trace truncated at {totalSteps} steps
            </span>
          )}
          <button
            onClick={cycleSpeed}
            className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-viz-panel border border-viz-line text-viz-ink/70 hover:text-amber-400 transition-colors"
            title="Playback speed"
          >
            <Gauge className="w-3 h-3" />
            <span>{speed}x</span>
          </button>
        </div>
      </div>

      {/* Control buttons & Timeline scrubber row */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Step to Start */}
        <button
          onClick={() => setStep(0)}
          disabled={!canGoPrev}
          className="p-1.5 rounded text-viz-ink/60 hover:text-viz-ink hover:bg-viz-panel disabled:opacity-20 transition-colors cursor-pointer"
          title="Jump to first step (Home)"
          aria-label="First step"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        {/* Previous Step */}
        <button
          onClick={prev}
          disabled={!canGoPrev}
          className="p-1.5 rounded text-viz-ink/80 hover:text-viz-ink hover:bg-viz-panel disabled:opacity-20 transition-colors cursor-pointer"
          aria-label="Previous step"
          title="Step back (Left Arrow)"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Play / Pause Toggle */}
        <button
          onClick={() => {
            if (currentStep >= totalSteps - 1) {
              setStep(0);
            }
            setIsPlaying((p) => !p);
          }}
          className={`p-1.5 md:p-2 rounded-full transition-all duration-150 cursor-pointer shadow-xs ${
            isPlaying
              ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
              : "bg-viz-panel hover:bg-viz-line text-amber-400 border border-viz-line"
          }`}
          title={isPlaying ? "Pause auto-trace" : "Auto-play trace"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Next Step */}
        <button
          onClick={next}
          disabled={!canGoNext}
          className="p-1.5 rounded text-viz-ink/80 hover:text-viz-ink hover:bg-viz-panel disabled:opacity-20 transition-colors cursor-pointer"
          aria-label="Next step"
          title="Step forward (Right Arrow)"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Step to End */}
        <button
          onClick={() => setStep(totalSteps - 1)}
          disabled={!canGoNext}
          className="p-1.5 rounded text-viz-ink/60 hover:text-viz-ink hover:bg-viz-panel disabled:opacity-20 transition-colors cursor-pointer"
          title="Jump to last step (End)"
          aria-label="Last step"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        {/* Scrubber slider track */}
        <div className="flex-1 relative flex items-center py-2">
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={totalSteps - 1}
            value={currentStep}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-viz-panel rounded-lg appearance-none cursor-pointer focus:outline-none"
            aria-label="Trace step"
          />
          {/* Compressed-group indicators on the slider track */}
          {trackMap.length > 0 && (
            <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 pointer-events-none">
              {trackMap.map((seg) => (
                <div
                  key={seg.startStep}
                  className="absolute h-2.5 w-0.5 bg-violet-400/70 rounded-full"
                  style={{
                    left: `${seg.left * 100}%`,
                    width: `${Math.max(seg.width * 100, 0.25)}%`,
                  }}
                  title={`Steps ${seg.startStep + 1}–${seg.startStep + Math.round(seg.width * totalSteps) - 1} linked`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step Counter Badge */}
        <div className="hidden sm:flex items-center text-xs font-mono text-viz-ink/70 px-2 py-1 rounded bg-viz-panel border border-viz-line shrink-0">
          <span className="text-amber-400 font-semibold">{currentStep + 1}</span>
          <span className="text-viz-ink/40 mx-1">/</span>
          <span>{totalSteps}</span>
        </div>
      </div>
    </div>
  );
}
