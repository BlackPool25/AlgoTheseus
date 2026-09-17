import { useState } from "react";
import { Link } from "react-router-dom";
import { Play, ChevronDown, BookOpen, Github, Sparkles, MoreVertical, Settings } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { THEMES, THEME_CATALOG, type ThemeName } from "../../theme";
import { CODE_PRESETS, type CodePreset } from "../../content/presets";
import { useUIStore } from "../../store/uiStore";
import { useTraceStore } from "../../store/traceStore";
import { useCFGStore } from "../../store/cfgStore";
import type { EngineSelection } from "../../utils/executionEngine";

interface HeaderProps {
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  onExecute: () => void;
  isLoading: boolean;
  engineSel: EngineSelection;
}

export function Header({
  theme,
  onThemeChange,
  onExecute,
  isLoading,
  engineSel,
}: HeaderProps) {
  const { setCode, setRawInput, reset: resetUI, status } = useUIStore();
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function handleSelectPreset(preset: CodePreset) {
    setCode(preset.code);
    if (preset.stdin) {
      setRawInput(preset.stdin);
    } else {
      setRawInput("");
    }
    resetUI();
    useTraceStore.getState().reset();
    useCFGStore.getState().reset();
    setPresetsOpen(false);
    setSettingsOpen(false);
  }

  function handleReset() {
    resetUI();
    useTraceStore.getState().reset();
    useCFGStore.getState().reset();
  }

  const currentThemeMeta = THEME_CATALOG.find((t) => t.id === theme) ?? THEME_CATALOG[0];

  return (
    <header className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-0 px-4 py-2 bg-viz-body border-b border-viz-line shrink-0 select-none z-30 overflow-x-clip">
      {/* Row 1 (mobile): Brand + Run — dissolves into the single desktop row via md:contents */}
      <div className="flex w-full items-center justify-between gap-2 min-w-0 md:contents">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-viz-ink hover:opacity-95 transition-opacity min-w-0 shrink md:shrink-0 group"
          title="AlgoTheseus — See How Algorithms Think"
        >
          <BrandLogo size={32} className="group-hover:rotate-3 transition-transform duration-200 shrink-0" />
          <div className="flex-col min-w-0 hidden min-[360px]:flex">
            <div className="flex items-center gap-1.5 leading-tight min-w-0">
              <span className="block truncate whitespace-nowrap font-bold text-base md:text-lg tracking-tight text-viz-ink">
                Algo<span className="text-amber-400">Theseus</span>
              </span>
            </div>
            <span className="block truncate whitespace-nowrap text-[10px] tracking-wide text-viz-ink/50 leading-none max-w-[168px]">
              execution labyrinth tracer
            </span>
          </div>
        </Link>

        {/* Mobile-only Run — thumb-sized, always reachable in row 1 */}
        <button
          onClick={onExecute}
          disabled={isLoading}
          aria-label={isLoading ? "Running…" : "Run"}
          className="md:hidden flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded px-4 h-11 min-w-[64px] whitespace-nowrap shadow-sm transition-all duration-150 active:scale-98 cursor-pointer shrink-0"
          title="Execute C++ code and trace step-by-step"
        >
          <Play className={`w-3.5 h-3.5 fill-current ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Running…" : "Run"}</span>
        </button>
      </div>

      {/* Row 2 (mobile): horizontally-scrollable controls */}
      <div className="flex w-full items-center gap-2 min-w-0 md:w-auto md:justify-end">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-none md:overflow-visible">
        {/* Algorithm Presets Dropdown (mobile top-level; desktop lives in Settings) */}
        <div className="relative shrink-0 md:hidden">
          <button
            onClick={() => setPresetsOpen((v) => !v)}
            className="flex items-center gap-1 px-2 h-11 rounded bg-viz-panel/80 hover:bg-viz-panel border border-viz-line text-xs text-viz-ink font-medium transition-colors"
            title="Load canonical algorithms"
            aria-expanded={presetsOpen}
            aria-label="Load algorithm templates"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="whitespace-nowrap">Templates</span>
            <ChevronDown className="w-3 h-3 text-viz-ink/60 shrink-0" />
          </button>

          {presetsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPresetsOpen(false)}
              />
              <div className="fixed left-4 right-4 top-[114px] md:absolute md:left-0 md:right-auto md:top-full rounded-lg bg-viz-panel border border-viz-line shadow-xl py-1.5 z-50 overflow-hidden text-xs md:w-72 md:mt-1.5">
                <div className="px-3 py-1.5 font-semibold text-[11px] text-viz-ink/60 uppercase tracking-wider border-b border-viz-line/50">
                  Algorithm Presets
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-viz-line/30">
                  {CODE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectPreset(p)}
                      className="w-full text-left px-3 py-2.5 min-h-[44px] justify-center hover:bg-amber-500/10 hover:text-amber-400 transition-colors flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-viz-ink truncate">{p.name}</span>
                        <span className="text-[10px] text-viz-ink/40 shrink-0">{p.category}</span>
                      </div>
                      <span className="text-[11px] text-viz-ink/60 line-clamp-1">
                        {p.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Accessible Theme Selector — mobile top-level; desktop lives in
            Settings. Full name stays readable: ellipsis + title tooltip. */}
        <div
          className="flex md:hidden items-center gap-1.5 px-2 h-11 max-w-[128px] shrink-0 rounded bg-viz-panel/90 border border-viz-line text-viz-ink font-mono focus-within:ring-1 focus-within:ring-amber-400"
          title={`${currentThemeMeta.name} (${theme})`}
        >
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
            style={{ backgroundColor: currentThemeMeta.accent }}
          />
          <select
            aria-label="Theme"
            title={`${currentThemeMeta.name} (${theme})`}
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
            className="bg-transparent truncate max-w-[88px] text-base md:text-xs text-viz-ink font-mono outline-none cursor-pointer"
          >
            {THEMES.map((t) => (
              <option key={t} value={t} className="bg-viz-panel text-viz-ink">
                {THEME_CATALOG.find((m) => m.id === t)?.name ?? t}
              </option>
            ))}
          </select>
        </div>

        {/* Mobile kebab overflow (···): badges, GitHub, legal — top level
            keeps only Templates + theme + Run. Desktop keeps its own items. */}
        <div className="relative shrink-0 md:hidden">
          <button
            onClick={() => setKebabOpen((v) => !v)}
            className="flex items-center justify-center w-11 h-11 text-viz-ink/70 hover:text-viz-ink transition-colors rounded hover:bg-viz-panel border border-viz-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            title="More options"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={kebabOpen}
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {kebabOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setKebabOpen(false)}
              />
              <div
                role="menu"
                aria-label="More options"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setKebabOpen(false);
                }}
                className="fixed left-4 right-4 top-[114px] rounded-lg bg-viz-panel border border-viz-line shadow-xl py-1.5 z-50 overflow-hidden text-xs"
              >
                <Link
                  to="/algorithms"
                  role="menuitem"
                  onClick={() => setKebabOpen(false)}
                  className="flex items-center gap-2 w-full text-left px-3 min-h-[44px] hover:bg-amber-500/10 hover:text-amber-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>Algorithms guide</span>
                </Link>
                <div className="px-3 py-2 flex flex-wrap items-center gap-1.5 border-t border-viz-line/50">
                  <span className="text-[11px] bg-viz-body border border-viz-line text-viz-ink/70 px-2 py-0.5 rounded font-mono">
                    C++20 · clang
                  </span>
                  <span
                    title={
                      engineSel.crossOriginIsolated
                        ? "cross-origin isolated (SAB available)"
                        : "server sandbox fallback active"
                    }
                    className="flex items-center gap-1.5 text-[11px] bg-viz-body border border-viz-line text-viz-ink/70 px-2 py-0.5 rounded font-mono"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    engine: {engineSel.engine}
                  </span>
                </div>
                <a
                  href="https://github.com/BlackPool25/AlgoTheseus"
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={() => setKebabOpen(false)}
                  className="flex items-center gap-2 w-full text-left px-3 min-h-[44px] hover:bg-amber-500/10 hover:text-amber-400 transition-colors border-t border-viz-line/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                >
                  <Github className="w-3.5 h-3.5 shrink-0" />
                  <span>GitHub</span>
                </a>
                <nav
                  aria-label="Legal"
                  className="flex items-center gap-5 px-3 min-h-[44px] border-t border-viz-line/50 text-viz-ink/60"
                >
                  <Link
                    to="/privacy"
                    role="menuitem"
                    onClick={() => setKebabOpen(false)}
                    className="underline-offset-2 hover:text-viz-ink hover:underline py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                  >
                    Privacy
                  </Link>
                  <Link
                    to="/terms"
                    role="menuitem"
                    onClick={() => setKebabOpen(false)}
                    className="underline-offset-2 hover:text-viz-ink hover:underline py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                  >
                    Terms
                  </Link>
                  <Link
                    to="/contact"
                    role="menuitem"
                    onClick={() => setKebabOpen(false)}
                    className="underline-offset-2 hover:text-viz-ink hover:underline py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
                  >
                    Contact
                  </Link>
                </nav>
              </div>
            </>
          )}
        </div>
        <Link
          to="/algorithms"
          className="hidden md:flex items-center gap-1 text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1 rounded hover:bg-viz-panel shrink-0"
          title="Explore algorithm visual guide"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Algorithms</span>
        </Link>

        {/* Reset button (mobile top-level; desktop swaps with Run in one fixed slot) */}
        {status === "done" && (
          <button
            onClick={handleReset}
            className="flex md:hidden shrink-0 items-center justify-center text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 h-11 min-w-[44px] rounded hover:bg-viz-panel"
            title="Reset trace and editor output"
          >
            Reset
          </button>
        )}
        </div>

        {/* Desktop Settings cluster: Templates + theme + toolchain status
            behind one gear. Mobile keeps its own kebab — separate state,
            separate markup, never merged. */}
        <div className="hidden md:flex relative items-center shrink-0">
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex items-center justify-center w-8 h-8 text-viz-ink/60 hover:text-viz-ink transition-colors rounded hover:bg-viz-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            title="Settings"
            aria-label="Settings"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Always mounted (CSS-hidden when closed) so the engine-badge
              testid stays queryable without opening the menu. */}
          <div
            role="menu"
            aria-label="Settings"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsOpen(false);
            }}
            className={`${settingsOpen ? "" : "hidden"} absolute right-0 top-full mt-1.5 w-72 rounded-lg bg-viz-panel border border-viz-line shadow-xl py-1.5 z-50 overflow-hidden text-xs`}
          >
            <div className="px-3 py-1.5 font-semibold text-[11px] text-viz-ink/60 uppercase tracking-wider border-b border-viz-line/50">
              Algorithm Presets
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-viz-line/30">
              {CODE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPreset(p)}
                  className="w-full text-left px-3 py-2 hover:bg-amber-500/10 hover:text-amber-400 transition-colors flex flex-col gap-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-viz-ink truncate">{p.name}</span>
                    <span className="text-[10px] text-viz-ink/40 shrink-0">{p.category}</span>
                  </div>
                  <span className="text-[11px] text-viz-ink/60 line-clamp-1">
                    {p.description}
                  </span>
                </button>
              ))}
            </div>
            {settingsOpen && (
              <div className="border-t border-viz-line/50 px-3 py-2">
                <div
                  className="flex items-center gap-1.5 text-viz-ink font-mono focus-within:ring-1 focus-within:ring-amber-400 rounded"
                  title={`${currentThemeMeta.name} (${theme})`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                    style={{ backgroundColor: currentThemeMeta.accent }}
                  />
                  <select
                    aria-label="Theme"
                    title={`${currentThemeMeta.name} (${theme})`}
                    value={theme}
                    onChange={(e) => onThemeChange(e.target.value as ThemeName)}
                    className="bg-transparent flex-1 text-xs text-viz-ink font-mono outline-none cursor-pointer"
                  >
                    {THEMES.map((t) => (
                      <option key={t} value={t} className="bg-viz-panel text-viz-ink">
                        {THEME_CATALOG.find((m) => m.id === t)?.name ?? t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {/* Toolchain status: read-only (spans, no click handlers) so it
                reads as plain status text — no pill, no chevron. */}
            <div className="px-3 py-2 border-t border-viz-line/50 font-mono text-[11px] text-viz-ink/50">
              <span>C++20 · clang</span>
              <span
                data-testid="engine-badge"
                title={
                  engineSel.crossOriginIsolated
                    ? "cross-origin isolated (SAB available)"
                    : "server sandbox fallback active"
                }
                className="ml-2"
              >
                engine: {engineSel.engine}
              </span>
            </div>
          </div>
        </div>
        {settingsOpen && (
          <div
            className="hidden md:block fixed inset-0 z-40"
            onClick={() => setSettingsOpen(false)}
          />
        )}

        {/* GitHub link (desktop only, unchanged) */}
        <a
          href="https://github.com/BlackPool25/AlgoTheseus"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center gap-1 text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1 rounded hover:bg-viz-panel shrink-0"
          title="GitHub Repository"
        >
          <Github className="w-3.5 h-3.5" />
          <span>GitHub</span>
        </a>

        {/* Desktop Run/Reset: one fixed-width slot — Reset swaps with Run in
            place so the toolbar never grows or reflows between states.
            (Mobile uses the row-1 thumb-sized Run; untouched.) */}
        <div className="hidden md:flex items-center justify-center shrink-0 w-24">
          {status === "done" ? (
            <button
              onClick={handleReset}
              aria-label="Reset"
              className="flex items-center justify-center gap-1.5 text-viz-ink/70 hover:text-viz-ink font-semibold text-sm rounded px-4 py-1.5 min-w-[76px] bg-viz-panel border border-viz-line hover:bg-viz-panel/70 shadow-sm transition-all duration-150 active:scale-98 cursor-pointer"
              title="Reset trace and editor output"
            >
              Reset
            </button>
          ) : (
            <button
              onClick={onExecute}
              disabled={isLoading}
              aria-label={isLoading ? "Running…" : "Run"}
              className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-semibold text-sm rounded px-4 py-1.5 min-w-[76px] shadow-sm transition-all duration-150 active:scale-98 cursor-pointer"
              title="Execute C++ code and trace step-by-step"
            >
              <Play className={`w-3.5 h-3.5 fill-current ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Running…" : "Run"}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
