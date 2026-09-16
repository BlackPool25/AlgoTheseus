/**
 * theme.ts — data-theme switcher + localStorage persist (todo 24).
 *
 * Palette names are frozen by docs/theme-tokens.md §4. Unknown stored
 * values fall back to zinc-dark with a console warning — never unstyled.
 */

export const THEMES = [
  "zinc-dark",
  "light",
  "high-contrast",
  "colorblind-safe",
  "papyrus",
  "catppuccin-mocha",
  "gruvbox-dark",
  "nord",
] as const;

export type ThemeName = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeName = "zinc-dark";

export interface ThemeMeta {
  id: ThemeName;
  name: string;
  category: "Signature" | "Developer" | "Accessibility";
  bg: string;
  accent: string;
}

export const THEME_CATALOG: readonly ThemeMeta[] = [
  { id: "zinc-dark", name: "Theseus Dark (Signature)", category: "Signature", bg: "#18181b", accent: "#f59e0b" },
  { id: "light", name: "Theseus Light", category: "Signature", bg: "#fdf6e3", accent: "#268bd2" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", category: "Developer", bg: "#1e1e2e", accent: "#cba6f7" },
  { id: "nord", name: "Nord Frost", category: "Developer", bg: "#2e3440", accent: "#88c0d0" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", category: "Developer", bg: "#282828", accent: "#fe8019" },
  { id: "papyrus", name: "Papyrus Warm", category: "Developer", bg: "#f5edd8", accent: "#8a5a00" },
  { id: "high-contrast", name: "High Contrast", category: "Accessibility", bg: "#000000", accent: "#ffff00" },
  { id: "colorblind-safe", name: "Colorblind Safe", category: "Accessibility", bg: "#ffffff", accent: "#0072b2" },
] as const;

const STORAGE_KEY = "algo-theseus-theme";

/** Pre-rename key (AlgoTheseus was DSA Visualiser): ported once, then dropped. */
const LEGACY_STORAGE_KEY = "dsa-viz-theme";

export function isThemeName(value: string): value is ThemeName {
  return (THEMES as readonly string[]).includes(value);
}

/** Apply a theme: validate, set data-theme, persist. Unknown → default + warn. */
export function applyTheme(value: string): ThemeName {
  const theme: ThemeName = isThemeName(value) ? value : DEFAULT_THEME;
  if (theme !== value) {
    console.warn(
      `[theme] unknown data-theme "${value}", falling back to "${DEFAULT_THEME}"`,
    );
  }
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private-mode storage denial must never break rendering.
  }
  return theme;
}

/** Restore the persisted theme before first paint. */
export function initTheme(): ThemeName {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      // One-time rename port: adopt the legacy value (validated downstream,
      // unknown values fall back to default with a warning), then drop it.
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) {
        stored = legacy;
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
  } catch {
    stored = null;
  }
  return applyTheme(stored ?? DEFAULT_THEME);
}

/** Read the currently applied theme (defaults to zinc-dark). */
export function currentTheme(): ThemeName {
  const value = document.documentElement.dataset.theme ?? DEFAULT_THEME;
  return isThemeName(value) ? value : DEFAULT_THEME;
}

/** Monaco built-in matching the palette luminance (no new deps). */
export function monacoThemeFor(theme: ThemeName): "vs-dark" | "vs" | "hc-black" {
  if (theme === "high-contrast") return "hc-black";
  if (
    theme === "light" ||
    theme === "papyrus" ||
    theme === "colorblind-safe"
  ) {
    return "vs";
  }
  return "vs-dark";
}
