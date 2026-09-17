/**
 * utils/graphParse.ts — adjacency-list parsing shared by graph visuals.
 *
 * Wire format (see backend/app/core/instrumenter/tracer.h
 * __ser(vector<vector<T>>) + __ser(pair<T1,T2>)): a
 * vector<vector<pair<int,int>>> arrives as
 * {"_type":"graph","adj":[[[v,w],...],...]} — each neighbor is a [v,w]
 * tuple. Plain vector<vector<int>> arrives as [[v,...],...]. Object
 * neighbors ({first,second} / {v,w}) are accepted for robustness.
 */

export type AdjEntry =
  | number
  | readonly [number, number]
  | { first: number; second: number }
  | { v: number; w: number };

export interface NormalizedEdge {
  v: number;
  weight: number | undefined;
}

export interface GraphData {
  adj: AdjEntry[][];
  state?: number[];
  distances?: (number | null)[];
  times?: { disc: number; fin?: number }[];
  parent?: (number | null)[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Narrow one adjacency entry to {v, weight?}; null when unusable. */
export function normalizeEdge(entry: unknown): NormalizedEdge | null {
  if (typeof entry === "number") {
    const v = toFiniteInt(entry);
    return v === null ? null : { v, weight: undefined };
  }

  if (Array.isArray(entry) && entry.length >= 2) {
    const v = toFiniteInt(entry[0]);
    if (v === null) return null;
    const w = entry[1];
    return {
      v,
      weight: typeof w === "number" && Number.isFinite(w) ? w : undefined,
    };
  }

  if (isRecord(entry)) {
    if ("first" in entry && "second" in entry) {
      const v = toFiniteInt(entry.first);
      if (v === null) return null;
      const w = entry.second;
      return {
        v,
        weight: typeof w === "number" && Number.isFinite(w) ? w : undefined,
      };
    }
    if ("v" in entry) {
      const v = toFiniteInt(entry.v);
      if (v === null) return null;
      const w = entry.w;
      return {
        v,
        weight: typeof w === "number" && Number.isFinite(w) ? w : undefined,
      };
    }
  }

  return null;
}

function isAdjRow(value: unknown): value is AdjEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "number" ||
        Array.isArray(entry) ||
        isRecord(entry),
    )
  );
}

function toGraphData(adj: unknown): GraphData | null {
  if (!Array.isArray(adj) || !adj.every(isAdjRow)) return null;
  return { adj: adj as AdjEntry[][] };
}

/** Parse a trace value into GraphData; null when the shape is unknown. */
export function parseGraphValue(value: unknown): GraphData | null {
  if (!value) return null;

  // 2D array → plain adjacency list (plain or weighted entries)
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => Array.isArray(item))
  ) {
    return toGraphData(value);
  }

  // Enriched object with _type discriminator
  if (isRecord(value)) {
    if (
      (value._type === "graph" || value.adj !== undefined) &&
      Array.isArray(value.adj)
    ) {
      const data = toGraphData(value.adj);
      if (!data) return null;
      if (Array.isArray(value.state)) data.state = value.state as number[];
      if (Array.isArray(value.dist)) {
        data.distances = value.dist as (number | null)[];
      }
      if (Array.isArray(value.times)) {
        data.times = value.times as { disc: number; fin?: number }[];
      }
      if (Array.isArray(value.parent)) {
        data.parent = value.parent as (number | null)[];
      }
      return data;
    }
  }

  return null;
}
