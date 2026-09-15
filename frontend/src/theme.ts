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

const STORAGE_KEY = "dsa-viz-theme";

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
