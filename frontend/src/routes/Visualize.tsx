import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ALGORITHMS,
  ALGORITHM_SLUGS,
  getAlgorithm,
  type AlgorithmEntry,
} from "../content/algorithms";
import { useUIStore } from "../store/uiStore";
import { useTraceStore } from "../store/traceStore";
import { useCFGStore } from "../store/cfgStore";
import { LegalLayout } from "./LegalLayout";
import { NotFound } from "./NotFound";
import { useSeo } from "./useSeo";
import { findPreset } from "../content/presets";

const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  window.location.origin;

/**
 * /visualize/:slug — one shared template for all 8 crawlable content pages.
 * Answer capsule renders first for AI-citation extraction.
 */
export function Visualize() {
  const { slug = "" } = useParams<{ slug: string }>();
  const entry = getAlgorithm(slug);

  if (!entry) {
    return <NotFound />;
  }
  return <VisualizePage entry={entry} />;
}

/**
 * Fallback when no CODE_PRESETS entry matches the slug: wrap the page's
 * fragment in common STL includes plus an empty main so the editor still
 * receives a compilable, runnable program (user adds a driver call).
 * Chosen over hiding the button so every page keeps a working handoff.
 */
function fallbackProgram(entry: AlgorithmEntry): string {
  return `#include <algorithm>
#include <deque>
#include <iostream>
#include <queue>
#include <stack>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

${entry.cppSnippet}

int main() {
  // TODO: call ${entry.name} here, then press Run.
  return 0;
}
`;
}

function VisualizePage({ entry }: { entry: AlgorithmEntry }) {
  const navigate = useNavigate();
  const setCode = useUIStore((s) => s.setCode);
  const setActiveSlug = useUIStore((s) => s.setActiveSlug);
  const setRawInput = useUIStore((s) => s.setRawInput);
  const resetUI = useUIStore((s) => s.reset);
  const preset = findPreset(entry);

  // Header handleSelectPreset pattern: load a runnable program into the
  // editor, clear prior run state, then go to the tool.
  function handleTryIt() {
    const runnable = preset?.code ?? fallbackProgram(entry);
    setCode(runnable);
    setActiveSlug(entry.slug);
    setRawInput(preset?.stdin ?? "");
    resetUI();
    useTraceStore.getState().reset();
    useCFGStore.getState().reset();
    navigate("/");
  }
  const pageUrl = `${SITE_URL}/visualize/${entry.slug}`;
  const title = `${entry.name} Visualization (C++) — Step by Step | AlgoTheseus`;
  const description = `Learn ${entry.name} step by step with a C++ example: ${entry.answerCapsule.split(". ")[0]}. Interactive visualization available in the AlgoTheseus tool.`;

  // Three siblings after the current slug, wrapping around (never self).
  const idx = ALGORITHM_SLUGS.indexOf(
    entry.slug as (typeof ALGORITHM_SLUGS)[number],
  );
  const siblings = [1, 2, 3].map(
    (n) => ALGORITHMS[ALGORITHM_SLUGS[(idx + n) % ALGORITHM_SLUGS.length]],
  );

  useSeo(
    {
      title,
      description,
      canonical: pageUrl,
      ogImage: `${SITE_URL}/og-image.svg`,
    },
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          name: "AlgoTheseus",
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          url: SITE_URL,
          description:
            "AlgoTheseus — visualize C++ algorithms step by step: live variable traces, control-flow graphs, and container visuals in the browser.",
        },
        {
          "@type": "HowTo",
          name: `How ${entry.name} works`,
          description: entry.answerCapsule,
          step: entry.steps.map((text, i) => ({
            "@type": "HowToStep",
            position: i + 1,
            text,
          })),
        },
      ],
    },
  );

  return (
    <LegalLayout title={title} updated="2026-09-15">
      {/* Answer capsule first — short citable summary for AI extraction. */}
      <p data-answer-capsule>
        <strong>Short answer: </strong>
        {entry.answerCapsule}
      </p>
      <h2>How {entry.name} works, step by step</h2>
      <ol className="list-decimal space-y-2 pl-6">
        {entry.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>{entry.name} in C++</h2>
      <pre className="overflow-x-auto rounded bg-viz-panel p-4 font-mono text-xs leading-relaxed">
        <code>{entry.cppSnippet}</code>
      </pre>
      <h2>Try it interactively</h2>
      <p>
        <button
          onClick={handleTryIt}
          className="inline-block rounded bg-blue-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-blue-500"
        >
          Visualize {entry.name} in the interactive AlgoTheseus tool
        </button>
      </p>
      <h2>Keep exploring</h2>
      <ul className="list-disc space-y-1 pl-6">
        {siblings.map((s) => (
          <li key={s.slug}>
            <Link to={`/visualize/${s.slug}`}>
              Visualize {s.name} step by step with a C++ example
            </Link>
          </li>
        ))}
      </ul>
    </LegalLayout>
  );
}
