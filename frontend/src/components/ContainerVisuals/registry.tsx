/**
 * components/ContainerVisuals/registry.ts — Single source of truth for
 * mapping ContainerKind discriminants to their visual components.
 *
 * Every visual component is expected to accept at minimum:
 *   { value: unknown, name?: string }
 * Additional kind-specific props are passed through (components ignore
 * what they don't use).
 *
 * This registry replaces the two parallel 14-case switch statements
 * that previously lived in VariableRow.tsx and MultiStructureSyncView.tsx.
 */

import { VectorVisual } from "./VectorVisual";
import { StackVisual } from "./StackVisual";
import { QueueVisual } from "./QueueVisual";
import { MapVisual } from "./MapVisual";
import { SetVisual } from "./SetVisual";
import { HeapVisual } from "./HeapVisual";
import { GraphAlgorithmVisual } from "./GraphAlgorithmVisual";
import { DPTableVisual } from "./DPTableVisual";
import { GridVisual } from "./GridVisual";
import { TrieVisual } from "./TrieVisual";
import { LinkedListVisual } from "./LinkedListVisual";
import { MultiStructureSyncView } from "./MultiStructureSyncView";
import type { StructureDef, ConnectionDef } from "./MultiStructureSyncView";
import { renderCellValue } from "../../utils/format";
import type { ContainerKind } from "../../hooks/useContainerType";

// ── Adapter: multi_structure value → MultiStructureSyncView props ────────────
//
// MultiStructureSyncView expects `{ structures, connections, name }` but the
// registry call-site passes `{ value, name }`.  This adapter unpacks the
// container value which serialises as `{ structures: […], connections: […] }`.

import React from "react";

const MultiStructureAdapter: React.FC<{ value: unknown; name?: string }> =
  React.memo(({ value, name }) => {
    const obj = value as Record<string, unknown>;
    const structures = (obj.structures ?? []) as StructureDef[];
    const connections = obj.connections as ConnectionDef[] | undefined;
    return (
      <MultiStructureSyncView
        structures={structures}
        connections={connections}
        name={name}
      />
    );
  });
MultiStructureAdapter.displayName = "MultiStructureAdapter";

// ── Primitive fallback ──────────────────────────────────────────────────────
//
// Renders any value as a plain text string using renderCellValue.
// Used for "struct" (when no schema is available), "primitive", and "unknown".

function PrimitiveFallback({ value }: { value: unknown }): React.ReactElement {
  return <span className="break-all">{renderCellValue(value)}</span>;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const VISUAL_REGISTRY: Record<ContainerKind, React.ComponentType<any>> =
  {
    vector: VectorVisual,
    stack: StackVisual,
    queue: QueueVisual,
    map: MapVisual,
    set: SetVisual,
    priority_queue: HeapVisual, // single source of truth — maps PQ to HeapVisual
    graph: GraphAlgorithmVisual,
    dp_table: DPTableVisual,
    grid: GridVisual,
    trie: TrieVisual,
    linked_list: LinkedListVisual,
    multi_structure: MultiStructureAdapter,
    struct: PrimitiveFallback,
    primitive: PrimitiveFallback,
    unknown: PrimitiveFallback,
  };
