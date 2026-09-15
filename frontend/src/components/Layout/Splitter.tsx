import { useCallback, useRef, useState } from "react";

type SplitterProps = {
  /** "vertical" = drag left/right (col-resize), "horizontal" = drag up/down (row-resize) */
  direction: "vertical" | "horizontal";
  /** Called with the pointer movement in px since the last move event. */
  onDrag: (dx: number, dy: number) => void;
  label?: string;
};

/**
 * Tiny reusable drag divider. No dependencies — pointer events +
 * setPointerCapture. Parent owns sizes and clamping; this only reports deltas.
 */
export function Splitter({ direction, onDrag, label = "Resize panels" }: SplitterProps) {
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={[
        "shrink-0 bg-zinc-800 transition-colors hover:bg-zinc-600",
        dragging ? "bg-blue-600 select-none touch-none" : "select-none touch-none",
        vertical
          ? "-mx-0.5 w-1 cursor-col-resize"
          : "-my-0.5 h-1 cursor-row-resize",
      ].join(" ")}
    />
  );
}
