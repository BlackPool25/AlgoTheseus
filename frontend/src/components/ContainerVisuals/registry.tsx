/**
 * components/ContainerVisuals/registry.ts — Single source of truth for
 * mapping ContainerKind discriminants to their visual components.
 *
 * Every visual component accepts `{ value: unknown; name: string }` plus
 * kind-specific optional props (components ignore what they don't use).
 * Call-sites may pass extra props (highlightIndex, changedIndices, …) via
 * the index signature.
 *
 * This registry replaces the two parallel 14-case switch statements
 * that previously lived in VariableRow.tsx and MultiStructureSyncView.tsx.
 */

import type { ComponentType } from "react";
import { VectorVisual } from "./VectorVisual";
import { DequeVisual } from "./DequeVisual";
import { StringVisual } from "./StringVisual";
import { StackVisual } from "./StackVisual";
import { QueueVisual } from "./QueueVisual";
import { MapVisual } from "./MapVisual";
import { SetVisual } from "./SetVisual";
import { HeapVisual } from "./HeapVisual";
import { GraphAlgorithmVisual } from "./GraphAlgorithmVisual";
import { DPTableVisual } from "./DPTableVisual";
import { GridVisual } from "./GridVisual";
import { TrieVisual } from "./TrieVisual";
import { DSUVisual } from "./DSUVisual";
import { LinkedListVisual } from "./LinkedListVisual";
import {
  MultiStructureAdapter,
  PrimitiveFallback,
  TreeAdapter,
} from "./registryComponents";
import type { ContainerKind } from "../../hooks/useContainerType";

// ── Registry ────────────────────────────────────────────────────────────────

/** Props contract every registered visual accepts (extras ignored). */
export interface RegistryVisualProps {
  value: unknown;
  name: string;
  highlightIndex?: number;
  [key: string]: unknown;
}

export const VISUAL_REGISTRY: Record<
  ContainerKind,
  ComponentType<RegistryVisualProps>
> = {
  vector: VectorVisual,
  deque: DequeVisual,
  string: StringVisual,
  stack: StackVisual,
  queue: QueueVisual,
  map: MapVisual,
  set: SetVisual,
  priority_queue: HeapVisual, // single source of truth — maps PQ to HeapVisual
  graph: GraphAlgorithmVisual,
  dp_table: DPTableVisual,
  grid: GridVisual,
  trie: TrieVisual,
  dsu: DSUVisual,
  linked_list: LinkedListVisual,
  tree: TreeAdapter,
  multi_structure: MultiStructureAdapter,
  struct: PrimitiveFallback,
  primitive: PrimitiveFallback,
  unknown: PrimitiveFallback,
};
