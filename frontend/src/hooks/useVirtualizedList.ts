/**
 * hooks/useVirtualizedList.ts — Shared hook wrapping @tanstack/react-virtual's
 * useVirtualizer for long-item virtualisation.
 *
 * Components call this hook and then conditionally render either the
 * virtualizer's items (when count > THRESHOLD) or a normal .map().
 */

import { useRef } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";

interface UseVirtualizedListOptions {
  /** The item array whose length drives the virtualizer count. */
  count: number;
  /** Estimated / fixed item size in px (default 28). */
  itemSize?: number;
  /** Overscan items rendered off-screen (default 5). */
  overscan?: number;
  /** True for a horizontal virtualizer (default false = vertical). */
  horizontal?: boolean;
}

interface UseVirtualizedListReturn {
  /** Ref to attach to the scrollable container element. */
  parentRef: React.RefObject<HTMLDivElement | null>;
  /** The Virtualizer instance — call .getVirtualItems() in render. */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}

/** Virtualize only when item count exceeds this threshold. */
export const VIRTUALIZE_THRESHOLD = 100;

export function useVirtualizedList({
  count,
  itemSize = 28,
  overscan = 5,
  horizontal = false,
}: UseVirtualizedListOptions): UseVirtualizedListReturn {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize,
    overscan,
    horizontal,
  });

  return { parentRef, virtualizer };
}
