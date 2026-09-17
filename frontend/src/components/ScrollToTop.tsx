import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Reset scroll on navigation (BrowserRouter does not do this by itself). */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
