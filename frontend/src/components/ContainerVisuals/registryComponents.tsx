/**
 * components/ContainerVisuals/registryComponents.tsx — Non-registry components
 * used by the visual registry (kept separate so registry.tsx exports only
 * data, satisfying react-refresh/only-export-components).
 */

import React from "react";
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
