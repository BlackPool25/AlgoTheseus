import { useState } from "react";
import { Link } from "react-router-dom";
import { Play, ChevronDown, BookOpen, Github, Sparkles } from "lucide-react";
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
  }

  function handleReset() {
    resetUI();
    useTraceStore.getState().reset();
    useCFGStore.getState().reset();
  }

  const currentThemeMeta = THEME_CATALOG.find((t) => t.id === theme) ?? THEME_CATALOG[0];

  return (
    <header className="flex items-center justify-between px-3 md:px-4 py-2 bg-viz-body border-b border-viz-line shrink-0 select-none z-30">
      {/* Left: Brand + Presets + Engine Badges */}
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-viz-ink hover:opacity-95 transition-opacity shrink-0 group"
          title="AlgoTheseus — See How Algorithms Think"
        >
          <BrandLogo size={28} className="group-hover:rotate-3 transition-transform duration-200" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 leading-tight">
              <span className="font-bold text-sm md:text-base tracking-tight text-viz-ink">
                Algo<span className="text-amber-400">Theseus</span>
              </span>
            </div>
            <span className="hidden sm:block text-[10px] text-viz-ink/50 leading-none">
              execution labyrinth tracer
            </span>
          </div>
        </Link>

        {/* Algorithm Presets Dropdown */}
        <div className="relative">
          <button
            onClick={() => setPresetsOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-viz-panel/80 hover:bg-viz-panel border border-viz-line text-xs text-viz-ink font-medium transition-colors"
            title="Load canonical algorithms"
            aria-expanded={presetsOpen}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden sm:inline">Templates</span>
            <ChevronDown className="w-3 h-3 text-viz-ink/60 shrink-0" />
          </button>

          {presetsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPresetsOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1.5 w-64 md:w-72 rounded-lg bg-viz-panel border border-viz-line shadow-xl py-1.5 z-50 overflow-hidden text-xs">
                <div className="px-3 py-1.5 font-semibold text-[11px] text-viz-ink/60 uppercase tracking-wider border-b border-viz-line/50">
                  Algorithm Presets
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-viz-line/30">
                  {CODE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectPreset(p)}
                      className="w-full text-left px-3 py-2 hover:bg-amber-500/10 hover:text-amber-400 transition-colors flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-viz-ink">{p.name}</span>
                        <span className="text-[10px] text-viz-ink/40">{p.category}</span>
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

        {/* Badges: Language & Sandbox */}
        <div className="hidden lg:flex items-center gap-1.5">
          <span className="text-[11px] bg-viz-panel/80 border border-viz-line text-viz-ink/70 px-2 py-0.5 rounded font-mono">
            C++20 · clang
          </span>
          <span
            data-testid="engine-badge"
            title={
              engineSel.crossOriginIsolated
                ? "cross-origin isolated (SAB available)"
                : "server sandbox fallback active"
            }
            className="flex items-center gap-1.5 text-[11px] bg-viz-panel/80 border border-viz-line text-viz-ink/70 px-2 py-0.5 rounded font-mono"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            engine: {engineSel.engine}
          </span>
        </div>
      </div>

      {/* Right: Docs + Theme + Reset + Run */}
      <div className="flex items-center gap-2">
        {/* SEO Algorithm Guide Link */}
        <Link
          to="/visualize/binary-search"
          className="hidden md:flex items-center gap-1 text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1 rounded hover:bg-viz-panel"
          title="Explore algorithm visual guide"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Algorithms</span>
        </Link>

        {/* GitHub link */}
        <a
          href="https://github.com/BlackPool25/AlgoTheseus"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center gap-1 text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1 rounded hover:bg-viz-panel"
          title="GitHub Repository"
        >
          <Github className="w-3.5 h-3.5" />
          <span>GitHub</span>
        </a>

        {/* Accessible Theme Selector */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-viz-panel/90 border border-viz-line text-xs text-viz-ink font-mono focus-within:ring-1 focus-within:ring-amber-400">
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
            style={{ backgroundColor: currentThemeMeta.accent }}
          />
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
            className="bg-transparent text-xs text-viz-ink font-mono outline-none cursor-pointer"
          >
            {THEMES.map((t) => (
              <option key={t} value={t} className="bg-viz-panel text-viz-ink">
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Reset button */}
        {status === "done" && (
          <button
            onClick={handleReset}
            className="text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1 rounded hover:bg-viz-panel"
            title="Reset trace and editor output"
          >
            Reset
          </button>
        )}

        {/* Primary Run Button */}
        <button
          onClick={onExecute}
          disabled={isLoading}
          aria-label={isLoading ? "Running…" : "Run"}
          className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-semibold text-xs md:text-sm rounded px-3.5 md:px-4 py-1.5 shadow-sm transition-all duration-150 active:scale-98 cursor-pointer"
          title="Execute C++ code and trace step-by-step"
        >
          <Play className={`w-3.5 h-3.5 fill-current ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Running…" : "Run"}</span>
        </button>
      </div>
    </header>
  );
}
