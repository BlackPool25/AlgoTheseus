/**
 * components/StatePanel/VariableRow.tsx — One variable with its value.
 *
 * Highlights changed values in amber.
 * Dispatches to the appropriate container visual based on value shape.
 * Falls back to plain text for primitives.
 */

import { useContainerType } from "../../hooks/useContainerType";
import { DPTableVisual } from "../ContainerVisuals/DPTableVisual";
import { GraphAlgorithmVisual } from "../ContainerVisuals/GraphAlgorithmVisual";
import { GridVisual } from "../ContainerVisuals/GridVisual";
import { HeapVisual } from "../ContainerVisuals/HeapVisual";
import { MapVisual } from "../ContainerVisuals/MapVisual";
import { QueueVisual } from "../ContainerVisuals/QueueVisual";
import { LinkedListVisual } from "../ContainerVisuals/LinkedListVisual";
import { StackVisual } from "../ContainerVisuals/StackVisual";
import { VectorVisual } from "../ContainerVisuals/VectorVisual";
import { SetVisual } from "../ContainerVisuals/SetVisual";
import {
  MultiStructureSyncView,
  type StructureDef,
  type ConnectionDef,
} from "../ContainerVisuals/MultiStructureSyncView";
import { TrieVisual } from "../ContainerVisuals/TrieVisual";


interface Props {
  name: string;
  value: unknown;
  changed: boolean;
  /** Index to highlight in array-type visuals (e.g. mid in binary search). */
  highlightIndex?: number;
}

export function VariableRow({ name, value, changed, highlightIndex }: Props) {
  const containerKind = useContainerType(value);

  return (
    <div
      className={`flex flex-col gap-1 px-3 py-1.5 border-b border-zinc-800/50 ${
        changed ? "bg-amber-400/5" : ""
      }`}
    >
      {/* Name + changed badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-zinc-400 min-w-[80px] shrink-0">
          {name}
        </span>
        {changed && (
          <span className="text-xs text-amber-500 shrink-0 ml-auto">changed</span>
        )}
      </div>

      {/* Value visual */}
      <div className={`text-xs font-mono ${changed ? "text-amber-300" : "text-zinc-200"}`}>
        <ValueVisual name={name} value={value} kind={containerKind} highlightIndex={highlightIndex} />
      </div>
    </div>
  );
}

interface ValueVisualProps {
  name: string;
  value: unknown;
  kind: ReturnType<typeof useContainerType>;
  highlightIndex?: number;
}

function ValueVisual({ name, value, kind, highlightIndex }: ValueVisualProps) {
  switch (kind) {
    case "vector":
      return <VectorVisual value={value as unknown[]} name={name} highlightIndex={highlightIndex} />;

    case "linked_list":
      return <LinkedListVisual value={value} name={name} />;

    case "stack": {
      const d = value as { top: unknown; items: unknown[] };
      return <StackVisual value={d} name={name} />;
    }

    case "queue": {
      const d = value as { front: unknown; items: unknown[] };
      return <QueueVisual value={d} />;
    }

    case "priority_queue": {
      const d = value as { top: unknown; items: unknown[] };
      return <HeapVisual value={d} />;
    }

    case "set":
      return <SetVisual value={value as unknown[]} />;

    case "map":
      return <MapVisual value={value as Record<string, unknown>} name={name} />;

    case "dp_table":
      return <DPTableVisual value={value as never} name={name} />;

    case "grid":
      return <GridVisual value={value as number[][]} name={name} />;

    case "graph":
      return <GraphAlgorithmVisual value={value} name={name} />;

    case "trie":
      return <TrieVisual value={value as Record<string, unknown>} name={name} />;

    case "multi_structure": {
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
    }

    case "struct":
      // No struct schemas available (analyze flow removed) — show as JSON
      return <span className="break-all">{renderPrimitive(value)}</span>;

    default:
      return <span className="break-all">{renderPrimitive(value)}</span>;
  }
}

function renderPrimitive(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) {
    if (value.length > 8) return `[${value.slice(0, 8).join(", ")}, …(${value.length})]`;
    return `[${value.join(", ")}]`;
  }
  return JSON.stringify(value, null, 0);
}
