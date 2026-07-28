/**
 * components/Editor/TestCaseManager.tsx — Batch test case runner.
 *
 * Provides a text input to enter comma-separated test case UUIDs and a
 * "Run Batch" button that fires POST /execute-batch and displays results.
 */

import { useState } from "react";
import { api, type ExecuteBatchResponseItem } from "../../utils/api";
import { useUIStore } from "../../store/uiStore";

export function TestCaseManager() {
  const code = useUIStore((s) => s.code);
  const [testIdsText, setTestIdsText] = useState("");
  const [results, setResults] = useState<ExecuteBatchResponseItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testIds = testIdsText
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function handleRunBatch() {
    if (testIds.length === 0) return;
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.executeBatch({ code, test_ids: testIds });
      setResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const allPassed =
    results && results.every((r) => !r.compile_error && !r.runtime_error);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Batch Test Cases
        </span>
        {results && (
          <span
            className={`text-xs font-mono ${allPassed ? "text-green-400" : "text-red-400"}`}
          >
            {results.filter((r) => !r.compile_error && !r.runtime_error).length}
            /{results.length} passed
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-zinc-900 rounded px-2 py-1.5 text-xs text-zinc-300 font-mono outline-none focus:ring-1 focus:ring-zinc-600 placeholder:text-zinc-600"
          placeholder="test-case-uuid-1, test-case-uuid-2, ..."
          value={testIdsText}
          onChange={(e) => setTestIdsText(e.target.value)}
          spellCheck={false}
        />
        <button
          onClick={handleRunBatch}
          disabled={running || testIds.length === 0}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs rounded px-3 py-1.5 transition-colors shrink-0"
        >
          {running ? "Running…" : "Run Batch"}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="text-xs text-red-400 font-mono bg-red-900/20 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Results list */}
      {results && results.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {results.map((r) => (
            <div
              key={r.test_id}
              className={`rounded px-2 py-1 text-xs font-mono border ${
                r.compile_error || r.runtime_error
                  ? "bg-red-900/10 border-red-800/40 text-red-300"
                  : "bg-zinc-800/50 border-zinc-700/40 text-zinc-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 truncate max-w-[180px]">
                  {r.test_id}
                </span>
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
                {r.timed_out && <span className="text-amber-400">timeout</span>}
                {!r.compile_error && !r.runtime_error && (
                  <span className="text-green-400">
                    {r.total_steps} steps
                  </span>
                )}
              </div>
              {r.stdout && (
                <div className="text-zinc-500 truncate mt-0.5">
                  stdout: {r.stdout.trim()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
