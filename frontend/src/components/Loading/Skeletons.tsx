/**
 * components/Loading/Skeletons.tsx — Skeleton loading screens.
 *
 * Used as Suspense fallbacks for the lazily-split panes and during trace
 * loading. Shimmer is pure CSS via the viz theme tokens (no new deps).
 * Layout-shift guards live here too: each skeleton reserves the same
 * min-height box as its real pane so late data never pushes layout (CLS).
 */

function ShimmerLine({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`at-skeleton-line ${className}`} />;
}

export function EditorSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading editor"
      className="at-reserve-editor flex h-full flex-col gap-2 p-3"
    >
      <ShimmerLine className="h-3 w-2/5" />
      <ShimmerLine className="h-3 w-11/12" />
      <ShimmerLine className="h-3 w-3/5" />
      <ShimmerLine className="h-3 w-4/5" />
      <ShimmerLine className="h-3 w-1/2" />
      <ShimmerLine className="h-3 w-3/4" />
      <span className="sr-only">Loading editor…</span>
    </div>
  );
}

export function CfgSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading control flow graph"
      className="at-reserve-cfg flex h-full flex-col items-stretch justify-center gap-3 p-6"
    >
      <div className="mx-auto flex flex-col items-center gap-2">
        <div aria-hidden="true" className="at-skeleton-block h-12 w-40" />
        <div aria-hidden="true" className="at-skeleton-stem" />
        <div aria-hidden="true" className="flex gap-6">
          <div className="at-skeleton-block h-10 w-28" />
          <div className="at-skeleton-block h-10 w-28" />
        </div>
        <div aria-hidden="true" className="at-skeleton-stem" />
        <div aria-hidden="true" className="at-skeleton-block h-12 w-40" />
      </div>
      <span className="sr-only">Loading control flow graph…</span>
    </div>
  );
}

export function StatePanelSkeleton() {
  return (
    <div role="status" aria-label="Loading variable state" className="flex h-full flex-col">
      <div className="border-b border-viz-line px-3 py-2">
        <ShimmerLine className="h-3 w-24" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <ShimmerLine className="h-4 w-full" />
        <ShimmerLine className="h-4 w-5/6" />
        <ShimmerLine className="h-4 w-4/6" />
        <ShimmerLine className="h-4 w-full" />
        <ShimmerLine className="h-4 w-3/6" />
      </div>
      <span className="sr-only">Loading variable state…</span>
    </div>
  );
}

export function VisualPanelSkeleton() {
  return (
    <div role="status" aria-label="Loading visualization" className="flex flex-col gap-2 p-3">
      <ShimmerLine className="h-3 w-32" />
      <div aria-hidden="true" className="at-skeleton-block h-24 w-full" />
      <ShimmerLine className="h-3 w-4/6" />
      <span className="sr-only">Loading visualization…</span>
    </div>
  );
}

export function ScrubberSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading trace scrubber"
      className="at-reserve-scrubber px-4 py-2"
    >
      <ShimmerLine className="h-3 w-48" />
      <div aria-hidden="true" className="at-skeleton-line mt-2 h-1 w-full" />
      <span className="sr-only">Loading trace scrubber…</span>
    </div>
  );
}
