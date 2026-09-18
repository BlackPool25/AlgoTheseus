/**
 * components/ContainerVisuals/registryComponents.tsx — Non-registry components
 * used by the visual registry (kept separate so registry.tsx exports only
 * data, satisfying react-refresh/only-export-components).
 */

import React from "react";
import { StructGraphVisual } from "./StructGraphVisual";
import { MultiStructureSyncView } from "./MultiStructureSyncView";
import type {
  StructureDef,
  ConnectionDef,
} from "./MultiStructureSyncView";
import { renderCellValue } from "../../utils/format";

// ── Adapter: multi_structure value → MultiStructureSyncView props ────────────
//
// MultiStructureSyncView expects `{ structures, connections, name }` but the
// registry call-site passes `{ value, name }`.  This adapter unpacks the
// container value which serialises as `{ structures: […], connections: […] }`.

export const MultiStructureAdapter: React.FC<{
  value: unknown;
  name?: string;
}> = React.memo(({ value, name }) => {
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

// ── Adapter: tree value → StructGraphVisual props ───────────────────────────
// Registry call-sites pass `{ value, name }`; StructGraphVisual expects
// `{ value, renderAs, labelField, leftField, rightField }`. The label field
// is sniffed the same way the useContainerType tree predicate requires it:
// first scalar field outside left/right, ignoring $ wire keys, preferring
// common payload names (val/value/data/key/label/name).
const TREE_LABEL_CANDIDATES = [
  "val",
  "value",
  "data",
  "key",
  "label",
  "name",
];

export function detectTreeLabelField(value: unknown): string {
  const obj = (value ?? {}) as Record<string, unknown>;
  const isScalar = (v: unknown) =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  for (const k of TREE_LABEL_CANDIDATES) {
    if (k in obj && isScalar(obj[k])) return k;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "left" && k !== "right" && !k.startsWith("$") && isScalar(v)) {
      return k;
    }
  }
  return "val";
}

export const TreeAdapter: React.FC<{
  value: unknown;
  name?: string;
}> = React.memo(({ value }) => {
  const obj = (value ?? {}) as Record<string, unknown>;
  return (
    <StructGraphVisual
      value={obj}
      renderAs="tree"
      labelField={detectTreeLabelField(value)}
      leftField="left"
      rightField="right"
    />
  );
});
TreeAdapter.displayName = "TreeAdapter";

// ── Primitive fallback ──────────────────────────────────────────────────────
//
// Renders any value as a plain text string using renderCellValue.
// Used for "struct" (when no schema is available), "primitive", and "unknown".

export function PrimitiveFallback({
  value,
}: {
  value: unknown;
}): React.ReactElement {
  return (
    <span data-testid="primitive-fallback" className="break-all">
      {renderCellValue(value)}
    </span>
  );
}
