import { Link } from "react-router-dom";
import { LegalLayout } from "./LegalLayout";

export function NotFound() {
  return (
    <LegalLayout title="Page not found" updated="2026-09-15">
      <p>
        The page you’re looking for doesn’t exist — it may have moved or the
        link may be mistyped.
      </p>
      <p>
        <Link
          to="/"
          className="inline-block rounded bg-blue-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-blue-500"
        >
          Back to AlgoTheseus
        </Link>
      </p>
    </LegalLayout>
  );
}
