import { StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./index.css";
import App from "./App";
import { RootErrorBoundary } from "./components/ErrorBoundary/RootErrorBoundary";
import { EditorSkeleton } from "./components/Loading/Skeletons";
import { initTheme } from "./theme";
import { Privacy } from "./routes/Privacy";
import { Terms } from "./routes/Terms";
import { Contact } from "./routes/Contact";
import { NotFound } from "./routes/NotFound";
import { Visualize } from "./routes/Visualize";

// Restore persisted data-theme before first paint (never unstyled).
initTheme();

/** Reset scroll on navigation (BrowserRouter does not do this by itself). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <Suspense fallback={<EditorSkeleton />}>
        <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Existing single-view tool, untouched */}
        <Route path="/" element={<App />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/visualize/:slug" element={<Visualize />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </BrowserRouter>
      </Suspense>
    </RootErrorBoundary>
  </StrictMode>,
);
