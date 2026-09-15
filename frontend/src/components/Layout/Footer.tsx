import { Link } from "react-router-dom";

/** Persistent footer on every route: Privacy / Terms / Contact + GitHub. */
export function Footer() {
  return (
    <footer className="shrink-0 border-t border-viz-line bg-viz-body px-4 py-2">
      <nav
        aria-label="Legal"
        className="mx-auto flex w-full max-w-3xl items-center justify-center gap-5 text-xs text-viz-ink/60"
      >
        <Link to="/privacy" className="underline-offset-2 hover:text-viz-ink hover:underline">
          Privacy
        </Link>
        <Link to="/terms" className="underline-offset-2 hover:text-viz-ink hover:underline">
          Terms
        </Link>
        <Link to="/contact" className="underline-offset-2 hover:text-viz-ink hover:underline">
          Contact
        </Link>
        <a
          href="https://github.com/BlackPool25/AlgoTheseus"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:text-viz-ink hover:underline"
        >
          GitHub
        </a>
        <a
          href="https://github.com/BlackPool25/AlgoTheseus"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Star AlgoTheseus on GitHub / Contribute"
          title="Star / Contribute"
        >
          <img
            src="https://img.shields.io/github/stars/BlackPool25/AlgoTheseus?style=social"
            alt="Star AlgoTheseus on GitHub"
            loading="lazy"
          />
        </a>
      </nav>
    </footer>
  );
}
