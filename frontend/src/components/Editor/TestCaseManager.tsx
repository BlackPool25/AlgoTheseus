/**
 * components/Editor/TestCaseManager.tsx — Batch test case runner.
 *
 * Unified case list where each case is {label, input text}. Paste cells
 * append locally; any-name .txt/.in files seed cells (label keeps the
 * original filename). "Run Selected" uploads pending cells first (one
 * upload call per cell, renamed client-side to input.txt so the backend
 * `<uuid>/input.txt` contract holds), then fires one POST /execute-batch
 * with all selected ids. Verdict cards show pass/fail where pass = clean
 * run (no compile/runtime error).
 */

import { useRef, useState } from "react";
import {
  api,
  batchedExecuteBatch,
  type ExecuteBatchResponseItem,
} from "../../utils/api";
import { useUIStore } from "../../store/uiStore";

const MAX_CASES = 20;
const MAX_PASTE_BYTES = 100 * 1024; // 100KB per pasted input
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (server cap)
const INPUT_EXTS = [".txt", ".in"];

interface PendingCell {
  key: number;
  label: string;
  input: string;
  selected: boolean;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function TestCaseManager() {
  const code = useUIStore((s) => s.code);
  const batchTestIds = useUIStore((s) => s.batchTestIds);
  const selectedBatchIds = useUIStore((s) => s.selectedBatchIds);
  const batchLabels = useUIStore((s) => s.batchLabels);
  const addBatchCase = useUIStore((s) => s.addBatchCase);
  const removeBatchTestId = useUIStore((s) => s.removeBatchTestId);
  const clearBatchTestIds = useUIStore((s) => s.clearBatchTestIds);
  const toggleSelectedBatchId = useUIStore((s) => s.toggleSelectedBatchId);
  const setSelectedBatchIds = useUIStore((s) => s.setSelectedBatchIds);

  const [cells, setCells] = useState<PendingCell[]>([]);
  const [results, setResults] = useState<ExecuteBatchResponseItem[] | null>(
    null,
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const caseNumRef = useRef(1);

  const running = progress !== null;
  const totalCases = cells.length + batchTestIds.length;
  const selectedPending = cells.filter((c) => c.selected).length;
  const selectedCount = selectedPending + selectedBatchIds.length;

  function labelFor(id: string): string {
    return batchLabels[id] ?? shortId(id);
  }

  function verdictFor(r: ExecuteBatchResponseItem): {
    pass: boolean;
  } {
    const clean = !r.compile_error && !r.runtime_error;
    return { pass: clean };
  }

  // ── Cells ──────────────────────────────────────────────────────────────

  function handleAddCell() {
    setNotice(null);
    if (cells.length + batchTestIds.length >= MAX_CASES) {
      setNotice(`Max ${MAX_CASES} cases — remove one to add another.`);
      return;
    }
    const n = caseNumRef.current++;
    setCells((prev) => [
      ...prev,
      {
        key: keyRef.current++,
        label: `Case ${n}`,
        input: "",
        selected: true,
      },
    ]);
  }

  function updateCell(key: number, field: "input", value: string) {
    if (value.length > MAX_PASTE_BYTES) {
      setNotice("Paste exceeds 100KB — split it or upload as a .txt file.");
      return;
    }
    setNotice(null);
    setCells((prev) =>
      prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    );
  }

  function toggleCell(key: number) {
    setCells((prev) =>
      prev.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c)),
    );
  }

  function removeCell(key: number) {
    setCells((prev) => prev.filter((c) => c.key !== key));
  }

  // ── Any-name file seeding ──────────────────────────────────────────────

  async function handleFiles(chosen: FileList | null) {
    if (!chosen || chosen.length === 0) return;
    setError(null);
    setNotice(null);
    const incoming = Array.from(chosen);
    // Reset so the same file can be picked again.
    if (fileRef.current) fileRef.current.value = "";

    for (const f of incoming) {
      if (!INPUT_EXTS.includes(extOf(f.name))) {
        setNotice(
          `"${f.name}" skipped — allowed: ${INPUT_EXTS.join(", ")} (50 files × 10MB).`,
        );
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        setNotice(`"${f.name}" exceeds the 10MB limit — skipped.`);
        continue;
      }
    }
    const valid = incoming.filter(
      (f) => INPUT_EXTS.includes(extOf(f.name)) && f.size <= MAX_FILE_SIZE,
    );
    if (valid.length === 0) return;

    for (const f of valid) {
      const text = await f.text();
      setCells((prev) => {
        if (prev.length + batchTestIds.length >= MAX_CASES) {
          setNotice(`Max ${MAX_CASES} cases — extra files skipped.`);
          return prev;
        }
        return [
          ...prev,
          {
            key: keyRef.current++,
            label: f.name,
            input: text,
            selected: true,
          },
        ];
      });
    }
  }

  // ── Run ────────────────────────────────────────────────────────────────

  function handleSelectAll() {
    const uploadedAll =
      batchTestIds.length === 0 ||
      batchTestIds.every((id) => selectedBatchIds.includes(id));
    const cellsAll = cells.length > 0 && cells.every((c) => c.selected);
    const all = uploadedAll && (cells.length === 0 || cellsAll);
    if (all) {
      setSelectedBatchIds([]);
      setCells((prev) => prev.map((c) => ({ ...c, selected: false })));
    } else {
      setSelectedBatchIds([...batchTestIds]);
      setCells((prev) => prev.map((c) => ({ ...c, selected: true })));
    }
  }

  async function handleRunBatch() {
    setError(null);
    setNotice(null);
    const pending = cells.filter((c) => c.selected);
    const empty = pending.filter((c) => c.input.trim().length === 0);
    const toUpload = pending.filter((c) => c.input.trim().length > 0);
    if (empty.length > 0) {
      setNotice(
        `${empty.map((c) => c.label).join(", ")} ${empty.length === 1 ? "is" : "are"} empty — skipped.`,
      );
    }
    const uploadedIds = selectedBatchIds.filter((id) =>
      batchTestIds.includes(id),
    );
    if (toUpload.length === 0 && uploadedIds.length === 0) {
      if (empty.length === 0) setNotice("Nothing selected — add a case first.");
      return;
    }

    setResults(null);
    const freshIds: string[] = [];
    try {
      for (let i = 0; i < toUpload.length; i++) {
        const cell = toUpload[i];
        setProgress(`Uploading ${i + 1}/${toUpload.length}…`);
        const files: File[] = [
          new File([new Blob([cell.input])], "input.txt", {
            type: "text/plain",
          }),
        ];
        const res = await api.uploadTestcases(files);
        addBatchCase(res.test_id, cell.label);
        freshIds.push(res.test_id);
      }
      // Pending cells are now server-side cases — drop them locally.
      const uploadedKeys = new Set(toUpload.map((c) => c.key));
      setCells((prev) => prev.filter((c) => !uploadedKeys.has(c.key)));

      const allIds = [...uploadedIds, ...freshIds];
      setProgress("Running…");
      const res = await batchedExecuteBatch({ code, test_ids: allIds });
      setResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  }

  const passedCount =
    results?.filter((r) => verdictFor(r).pass).length ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-viz-ink/60 uppercase tracking-wide">
          Batch Test Cases
        </span>
        {results ? (
          <span
            className={`text-xs font-mono ${passedCount === results.length ? "text-green-400" : "text-red-400"}`}
          >
            {passedCount}/{results.length} passed
          </span>
        ) : (
          totalCases > 0 && (
            <span className="text-xs font-mono text-viz-ink/60">
              {selectedCount}/{totalCases} selected
            </span>
          )
        )}
      </div>

      {/* Upload any-name .txt/.in input files */}
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={INPUT_EXTS.join(",")}
          onChange={(e) => void handleFiles(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs bg-viz-panel hover:bg-viz-body text-viz-ink rounded px-3 py-1.5 transition-colors border border-viz-line/40 shrink-0"
        >
          Upload .txt/.in files
        </button>
        <span className="text-[11px] text-viz-ink/60">
          any filename · input files only · 50 files × 10MB
        </span>
      </div>

      {/* Unified case list */}
      {totalCases === 0 ? (
        <p className="text-xs text-viz-ink/60 bg-viz-body rounded px-2 py-1.5">
          No cases yet — paste an input cell or upload .txt files (max 20
          cases, 50 files × 10MB).
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs text-viz-ink/60 hover:text-viz-ink transition-colors shrink-0"
            >
              Select all
            </button>
            <button
              onClick={() => {
                clearBatchTestIds();
                setCells([]);
              }}
              className="text-xs text-viz-ink/60 hover:text-red-300 transition-colors shrink-0"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-0.5">
            {/* Pending paste cells */}
            {cells.map((cell) => (
              <div
                key={cell.key}
                className={`rounded px-2 py-1.5 text-xs border ${
                  cell.selected
                    ? "bg-viz-panel border-viz-line text-viz-ink"
                    : "bg-viz-body border-viz-line/40 text-viz-ink/60"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                      cell.selected ? "bg-emerald-400" : "bg-viz-ink/30"
                    }`}
                  />
                  <button
                    onClick={() => toggleCell(cell.key)}
                    className="font-mono truncate hover:text-viz-ink transition-colors"
                    title={cell.label}
                    role="checkbox"
                    aria-checked={cell.selected}
                  >
                    {cell.label}
                  </button>
                  <span className="text-[10px] text-viz-ink/40 shrink-0">
                    not uploaded
                  </span>
                  <button
                    onClick={() => removeCell(cell.key)}
                    aria-label={`Remove ${cell.label}`}
                    className="ml-auto hover:text-red-300 transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  className="mt-1.5 w-full bg-viz-body rounded px-2 py-1.5 text-base text-viz-ink font-mono outline-none focus:ring-1 focus:ring-viz-line placeholder:text-viz-ink/40 resize-y min-h-[3rem]"
                  placeholder="paste program input…"
                  value={cell.input}
                  onChange={(e) =>
                    updateCell(cell.key, "input", e.target.value)
                  }
                  spellCheck={false}
                />
              </div>
            ))}
            {/* Uploaded cases */}
            {batchTestIds.map((id) => {
              const selected = selectedBatchIds.includes(id);
              return (
                <div
                  key={id}
                  className={`rounded px-2 py-1.5 text-xs border ${
                    selected
                      ? "bg-viz-panel border-viz-line text-viz-ink"
                      : "bg-viz-body border-viz-line/40 text-viz-ink/60"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        selected ? "bg-emerald-400" : "bg-viz-ink/30"
                      }`}
                    />
                    <button
                      onClick={() => toggleSelectedBatchId(id)}
                      className="font-mono truncate hover:text-viz-ink transition-colors"
                      title={id}
                      role="checkbox"
                      aria-checked={selected}
                    >
                      {labelFor(id)}
                    </button>
                    <button
                      onClick={() => removeBatchTestId(id)}
                      aria-label={`Remove ${labelFor(id)}`}
                      className="ml-auto hover:text-red-300 transition-colors shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={handleAddCell}
        className="text-xs bg-viz-panel hover:bg-viz-body text-viz-ink rounded px-3 py-1.5 transition-colors border border-viz-line/40 self-start"
      >
        + Add input cell
      </button>

      {/* Notice / error banners */}
      {notice && (
        <div className="text-xs text-amber-300 font-mono bg-amber-900/20 rounded px-2 py-1">
          {notice}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 font-mono bg-red-900/20 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Results list */}
      {results && results.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {results.map((r) => {
            const v = verdictFor(r);
            return (
              <div
                key={r.test_id}
                className={`rounded px-2 py-1 text-xs font-mono border ${
                  v.pass
                    ? "bg-viz-panel/50 border-viz-line/40 text-viz-ink"
                    : "bg-red-900/10 border-red-800/40 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-viz-ink/60 truncate max-w-[180px]">
                    {labelFor(r.test_id)}
                  </span>
                  {v.pass ? (
                    <span className="text-green-400">passed</span>
                  ) : (
                    <span className="text-red-400">failed</span>
                  )}
                  {r.compile_error && (
                    <span className="text-red-400" title={r.compile_error}>
                      compile err
                    </span>
                  )}
                  {r.runtime_error && (
                    <span className="text-amber-400" title={r.runtime_error}>
                      runtime err
                    </span>
                  )}
                  {r.timed_out && (
                    <span className="text-amber-400">timeout</span>
                  )}
                  {!r.compile_error && !r.runtime_error && (
                    <span className="text-viz-ink/60">
                      {r.total_steps} steps
                    </span>
                  )}
                </div>
                {r.stdout && (
                  <div className="text-viz-ink/60 truncate mt-0.5">
                    stdout: {r.stdout.trim()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky run bar — contained in panel flow */}
      <div className="sticky bottom-0 rounded-lg border border-viz-line/40 bg-viz-panel p-2 at-safe-bottom-sm">
        <button
          onClick={() => void handleRunBatch()}
          disabled={running || selectedCount === 0}
          className="w-full min-h-[44px] bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs rounded-lg px-3 py-2 transition-colors"
        >
          {progress ??
            (selectedCount > 0
              ? `Run Selected (${selectedCount})`
              : "Run Batch")}
        </button>
      </div>
    </div>
  );
}
