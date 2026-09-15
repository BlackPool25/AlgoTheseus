import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../components/Layout/Footer";

const LEGAL_REVIEW_COMMENT =
  "<!-- LEGAL BASELINE: Privacy/Terms/Contact texts below are a draft baseline only and require human legal review before reliance. -->";

/**
 * LegalLayout — shared minimal shell for /privacy, /terms, /contact, *.
 * Same theme tokens as the tool (bg-viz-*, text-viz-*), semantic h1/main,
 * skip-link, and a back-to-tool link. No tracking, no cookies.
 */
export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-viz-body text-viz-ink">
      <a
        href="#legal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-viz-panel focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>
      {/* Real HTML comment in the DOM: baseline needs human legal review. */}
      <div
        aria-hidden="true"
        hidden
        dangerouslySetInnerHTML={{ __html: LEGAL_REVIEW_COMMENT }}
      />
      <main
        id="legal-main"
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6"
      >
        <p className="mb-4 text-xs font-mono text-viz-ink/60">
          <Link to="/" className="underline hover:text-viz-ink">
            ← Back to AlgoTheseus
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-xs font-mono text-viz-ink/60">
          Last updated: {updated}
        </p>
        <div className="mt-6 space-y-5 text-sm leading-relaxed text-viz-ink/90 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-viz-ink [&_a]:underline">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
