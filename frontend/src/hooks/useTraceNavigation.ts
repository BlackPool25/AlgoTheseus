/**
 * hooks/useTraceNavigation.ts — Keyboard and scrubber navigation logic.
 *
 * Extracted from TraceScrubber so it can be reused by other components.
 * Registers global keyboard listeners for ArrowLeft/ArrowRight.
 * Returns the current step info and navigation actions.
 */

import { useEffect } from "react";
import { useTraceStore } from "../store/traceStore";

export function useTraceNavigation() {
  const { totalSteps, currentStep, currentEvent, setStep, next, prev } =
    useTraceStore();

  // Global keyboard navigation — only fires when not typing in an input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); prev(); }
      if (e.key === "Home")       { e.preventDefault(); setStep(0); }
      if (e.key === "End")        { e.preventDefault(); setStep(totalSteps - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, setStep, totalSteps]);

  const label = currentEvent
    ? `Step ${currentStep + 1} / ${totalSteps} — ${currentEvent.func}() line ${currentEvent.line}`
    : `Step ${currentStep + 1} / ${totalSteps}`;

  return {
    totalSteps,
    currentStep,
    currentEvent,
    label,
    setStep,
    next,
    prev,
    canGoNext: currentStep < totalSteps - 1,
    canGoPrev: currentStep > 0,
  };
}
