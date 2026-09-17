import { renderCellValue } from "../../utils/format";

interface Props {
  value: unknown;
  name?: string;
}

function asParent(value: unknown): number[] | null {
  const p = Array.isArray(value)
    ? value
    : (value as Record<string, unknown>)?.p;
  if (!Array.isArray(p) || p.length === 0) return null;
  if (!p.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < p.length)) {
    return null;
  }
  return p as number[];
}

function groupsOf(parent: number[]): number[][] {
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  const order: number[] = [];
  const buckets = new Map<number, number[]>();
  parent.forEach((_, i) => {
    const r = find(i);
    if (!buckets.has(r)) {
      buckets.set(r, []);
      order.push(r);
    }
    buckets.get(r)?.push(i);
  });
  return order.map((r) => buckets.get(r) ?? []);
}

export function DSUVisual({ value }: Props) {
  const parent = asParent(value);
  if (!parent) {
    return (
      <span data-testid="primitive-fallback" className="break-all">
        {renderCellValue(value)}
      </span>
    );
  }
  const groups = groupsOf(parent);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {groups.map((members, gi) => (
          <div
            key={gi}
            data-testid="dsu-group"
            className="flex items-center gap-0.5 border border-viz-line bg-viz-panel rounded-sm px-1 py-0.5"
          >
            {members.map((m) => (
              <div
                key={m}
                className="flex items-center justify-center min-w-[28px] h-6 px-1.5 border border-viz-line bg-viz-panel text-viz-ink text-[10px] font-mono rounded-sm"
              >
                {m}
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="text-[9px] text-viz-ink/60">
        dsu · {groups.length} sets · {parent.length} items
      </span>
    </div>
  );
}
