import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Play, Search } from "lucide-react";
import { ALGORITHMS, type AlgorithmEntry } from "../content/algorithms";
import { findPreset, type CodePreset } from "../content/presets";
import { useUIStore } from "../store/uiStore";
import { useTraceStore } from "../store/traceStore";
import { useCFGStore } from "../store/cfgStore";
import { LegalLayout } from "./LegalLayout";
import { useSeo } from "./useSeo";

const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  window.location.origin;

/** Category from preset match, else keyword heuristic over slug/name. */
function categoryOf(e: AlgorithmEntry): string {
  const p = findPreset(e);
  if (p) {
    if (p.category === "Searching & Sorting")
      return /sort/i.test(e.name) ? "Sorting" : "Searching";
    if (p.category === "Dynamic Programming") return "DP";
    if (p.category === "Graphs") return "Graphs";
    if (p.category === "Data Structures") return "Structures";
    return p.category;
  }
  const t = `${e.slug} ${e.name} ${e.primaryKeyword}`.toLowerCase();
  if (/knapsack|subsequence|coin|edit-distance|climbing/.test(t)) return "DP";
  if (/kmp|matching|trie/.test(t)) return "Strings";
  if (/stack|queue|linked|tree|heap|hashmap/.test(t)) return "Structures";
  if (
    /breadth|depth-first|dijkstra|topolog|kruskal|prim|bellman|floyd|cycle|union|graph/.test(
      t,
    )
  )
    return "Graphs";
  if (/sort/.test(t)) return "Sorting";
  if (/search|pointers|sliding/.test(t)) return "Searching";
  return "Math";
}

const CATEGORY_ORDER = [
  "Sorting",
  "Searching",
  "Graphs",
  "DP",
  "Structures",
  "Strings",
  "Math",
];

const complexityOf = (e: AlgorithmEntry) =>
  e.answerCapsule.match(/O\([^)]*\)/)?.[0] ?? "";

/**
 * /algorithms — searchable gallery over ALGORITHMS.
 * Cards link to /visualize/:slug; "Try it" loads the matching preset
 * into the tool (Header handleSelectPreset pattern) then goes to /.
 */
export function Algorithms() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const navigate = useNavigate();
  const setCode = useUIStore((s) => s.setCode);
  const setActiveSlug = useUIStore((s) => s.setActiveSlug);
  const setRawInput = useUIStore((s) => s.setRawInput);
  const resetUI = useUIStore((s) => s.reset);

  useSeo(
    {
      title: "Algorithms Gallery — Browse & Visualize Step by Step | AlgoTheseus",
      description:
        "Browse every AlgoTheseus algorithm guide: sorting, searching, graphs, DP, data structures and strings. Open the step-by-step visualization or load it straight into the interactive C++ tool.",
      canonical: `${SITE_URL}/algorithms`,
      ogImage: `${SITE_URL}/og-image.svg`,
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "AlgoTheseus algorithm guides",
      itemListElement: Object.values(ALGORITHMS).map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/visualize/${e.slug}`,
        name: e.name,
      })),
    },
  );

  const entries = useMemo(
    () =>
      Object.values(ALGORITHMS).map((entry) => ({
        entry,
        category: categoryOf(entry),
        preset: findPreset(entry),
      })),
    [],
  );
  const pills = useMemo(
    () => [
      "All",
      ...CATEGORY_ORDER.filter((c) => entries.some((x) => x.category === c)),
    ],
    [entries],
  );
  const q = query.trim().toLowerCase();
  const visible = entries.filter(
    ({ entry, category }) =>
      (cat === "All" || category === cat) &&
      (q === "" ||
        `${entry.name} ${entry.answerCapsule} ${entry.primaryKeyword} ${entry.secondaryKeywords.join(" ")}`
          .toLowerCase()
          .includes(q)),
  );

  function handleTryIt(preset: CodePreset) {
    setCode(preset.code);
    setActiveSlug(preset.id);
    setRawInput(preset.stdin ?? "");
    resetUI();
    useTraceStore.getState().reset();
    useCFGStore.getState().reset();
    navigate("/");
  }

  return (
    <LegalLayout title="Algorithms" updated="2026-09-15" wide>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-viz-ink/40" />
        <input
          autoFocus
          aria-label="Search algorithms"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search algorithms…"
          className="w-full rounded-lg border border-viz-line bg-viz-panel py-2 pl-9 pr-3 text-base text-viz-ink placeholder:text-viz-ink/40 focus:border-amber-400 focus:outline-none sm:text-sm"
        />
      </div>
      <div
        className="mb-5 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap"
        role="group"
        aria-label="Filter by category"
      >
        {pills.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              cat === c
                ? "border-amber-400 bg-amber-400/15 text-amber-400"
                : "border-viz-line bg-viz-panel text-viz-ink/60 hover:text-viz-ink"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-viz-ink/60">
          No results for &ldquo;{query.trim()}&rdquo;. Try a different keyword
          or category.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map(({ entry, category, preset }) => (
            <article
              key={entry.slug}
              className="flex flex-col gap-2 rounded-lg border border-viz-line bg-viz-panel p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-viz-ink">
                  {entry.name}
                </h2>
                <span className="shrink-0 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                  {category}
                </span>
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-viz-ink/70">
                {entry.answerCapsule}
              </p>
              {complexityOf(entry) && (
                <p className="font-mono text-[11px] text-viz-ink/50">
                  {complexityOf(entry)}
                </p>
              )}
              <div className="mt-auto flex items-center gap-3 pt-1">
                <Link
                  to={`/visualize/${entry.slug}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"
                >
                  Visualize <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {preset && (
                  <button
                    onClick={() => handleTryIt(preset)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-viz-ink/60 transition-colors hover:text-viz-ink"
                  >
                    <Play className="h-3.5 w-3.5" /> Try it
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </LegalLayout>
  );
}
