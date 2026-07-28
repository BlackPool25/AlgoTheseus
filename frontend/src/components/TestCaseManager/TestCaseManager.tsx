/**
 * TestCaseManager.tsx — Drag-and-drop test case file upload zone.
 *
 * Accepts .txt / .in / .out / .ans files, sends them to
 * POST /upload-testcases, and shows a preview of each uploaded file.
 */

import { useCallback, useState, useRef } from "react";
import { api, type UploadedFile } from "../../utils/api";

// ── Constants ──────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = [".txt", ".in", ".out", ".ans"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 50;

type UploadStatus = "idle" | "uploading" | "done" | "error";

interface UploadResult {
  testId: string;
  files: UploadedFile[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedFile(file: File): boolean {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

// ── Component ──────────────────────────────────────────────────────────────

export function TestCaseManager() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File validation ───────────────────────────────────────────────────

  const validateAndAdd = useCallback((incoming: FileList | File[]) => {
    setError(null);
    setResult(null);
    setStatus("idle");

    const arr = Array.from(incoming);
    const newFiles: File[] = [];
    for (const f of arr) {
      if (!isAllowedFile(f)) {
        setError(`"${f.name}" has unsupported extension. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
        return;
      }
      if (f.size > MAX_FILE_SIZE) {
        setError(`"${f.name}" exceeds 10 MB limit (${formatSize(f.size)})`);
        return;
      }
      newFiles.push(f);
    }
    const total = files.length + newFiles.length;
    if (total > MAX_FILES) {
      setError(`Too many files (max ${MAX_FILES})`);
      return;
    }
    setFiles((prev) => [...prev, ...newFiles]);
  }, [files.length]);

  // ── Drag / drop handlers ──────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      validateAndAdd(e.dataTransfer.files);
    }
  }, [validateAndAdd]);

  // ── Click-to-browse ───────────────────────────────────────────────────

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAdd(e.target.files);
    }
    // Reset so the same file can be selected again
    e.target.value = "";
  }, [validateAndAdd]);

  // ── Remove a file from the list ──────────────────────────────────────

  const handleRemove = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
    setStatus("idle");
  }, []);

  // ── Upload ───────────────────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);
    setStatus("uploading");
    try {
      const res = await api.uploadTestcases(files);
      setResult({ testId: res.test_id, files: res.files });
      setStatus("done");
      setFiles([]);
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [files]);

  // ── Reset ────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setFiles([]);
    setResult(null);
    setError(null);
    setStatus("idle");
  }, []);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-100">Test Cases</h2>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowse}
        className={`
          border-2 border-dashed rounded-lg p-6 cursor-pointer
          transition-colors text-center
          ${isDragOver
            ? "border-blue-500 bg-blue-950/30"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-500"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(",")}
          onChange={handleInputChange}
          className="hidden"
        />
        <p className="text-xs text-zinc-400">
          Drop <span className="font-mono text-zinc-300">.txt .in .out .ans</span> files here
        </p>
        <p className="text-xs text-zinc-600 mt-1">or click to browse</p>
      </div>

      {/* Selected files list */}
      {files.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">{files.length} file(s) selected</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center justify-between bg-zinc-800 rounded px-2 py-1">
                <span className="text-xs text-zinc-300 truncate mr-2">{f.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-500">{formatSize(f.size)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(i); }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleUpload}
            disabled={status === "uploading"}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded px-3 py-1.5 transition-colors mt-1"
          >
            {status === "uploading" ? "Uploading…" : `Upload ${files.length} file(s)`}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Upload result */}
      {result && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              Test ID: <span className="font-mono text-zinc-200">{result.testId}</span>
            </span>
            <button
              onClick={handleReset}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {result.files.map((f, i) => (
              <div key={i} className="bg-zinc-800 rounded px-2 py-1.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-zinc-200 truncate">{f.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0 ml-2">{formatSize(f.size)}</span>
                </div>
                {f.preview && (
                  <pre className="text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap font-mono bg-zinc-950 rounded p-1.5 max-h-16 overflow-y-auto">
                    {f.preview}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
