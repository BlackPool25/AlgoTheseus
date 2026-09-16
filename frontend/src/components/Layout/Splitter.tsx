import { useCallback, useRef, useState } from "react";

type SplitterProps = {
  /** "vertical" = drag left/right (col-resize), "horizontal" = drag up/down (row-resize) */
  direction: "vertical" | "horizontal";
  /** Called with the pointer movement in px since the last move event. */
  onDrag: (dx: number, dy: number) => void;
  label?: string;
  className?: string;
};

/**
 * Modern tactile drag divider with visible grab handle affordance.
 * Pointer events + setPointerCapture with 8px hit target and smooth active glow.
 */
export function Splitter({
  direction,
  onDrag,
  label = "Resize panels",
  className = "",
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });

  const vertical = direction === "vertical";

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      onDrag(e.clientX - start.current.x, e.clientY - start.current.y);
      start.current = { x: e.clientX, y: e.clientY };
    },
    [onDrag],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      tabIndex={0}
      title="Drag to resize panels"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={[
        "group relative shrink-0 select-none touch-none transition-colors z-20",
        vertical
          ? "-mx-1 w-2 cursor-ew-resize flex items-center justify-center"
          : "-my-1 h-2 cursor-ns-resize flex items-center justify-center",
        className,
      ].join(" ")}
    >
      {/* Visual divider line */}
      <div
        className={[
          "absolute transition-colors",
          vertical ? "w-[1px] h-full" : "h-[1px] w-full",
          dragging
            ? "bg-amber-400 dark:bg-amber-400"
            : "bg-viz-line group-hover:bg-amber-400/70",
        ].join(" ")}
      />

      {/* Tactile center grab pill */}
      <div
        className={[
          "relative z-10 rounded-full transition-all duration-150 shadow-xs",
          vertical ? "w-1 h-7 my-auto" : "h-1 w-7 mx-auto",
          dragging
            ? "bg-amber-400 scale-110 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
            : "bg-viz-line/80 group-hover:bg-amber-400/90 group-hover:scale-105",
        ].join(" ")}
      />
    </div>
  );
}
