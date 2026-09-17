/**
 * store/uiStore.ts — Zustand store for UI state.
 *
 * Owns: code, raw input, and the submission status.
 * Status drives the UI flow: idle → executing → done/error.
 */

import { create } from "zustand";

export type AppStatus =
  | "idle"
  | "executing"
  | "done"
  | "error";

interface UIStore {
  code: string;
  rawInput: string;
  status: AppStatus;
  errorMessage: string | null;
  stdout: string;
  compileError: string | null;
  runtimeError: string | null;
  truncated: boolean;
  warnings: string[];
  batchTestIds: string[];
  selectedBatchIds: string[];
  batchLabels: Record<string, string>;

  setCode: (code: string) => void;
  setRawInput: (input: string) => void;
  setExecuteResult: (
    stdout: string,
    compileError: string | null,
    runtimeError: string | null,
    truncated?: boolean,
    warnings?: string[]
  ) => void;
  setStatus: (status: AppStatus) => void;
  setError: (msg: string) => void;
  clearError: () => void;
  reset: () => void;
  addBatchTestId: (id: string) => void;
  removeBatchTestId: (id: string) => void;
  clearBatchTestIds: () => void;
  toggleSelectedBatchId: (id: string) => void;
  setSelectedBatchIds: (ids: string[]) => void;
  setBatchLabel: (id: string, label: string) => void;
  addBatchCase: (id: string, label?: string) => void;
}

const DEFAULT_CODE = `#include <vector>
#include <iostream>

int bsearch(std::vector<int>& arr, int target) {
    int lo = 0, hi = (int)arr.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main() {
    std::vector<int> arr = {1, 3, 5, 7, 9, 11, 13};
    int target = 7;
    int result = bsearch(arr, target);
    std::cout << "Found at index: " << result << std::endl;
    return 0;
}
`;

export const useUIStore = create<UIStore>((set) => ({
  code: DEFAULT_CODE,
  rawInput: "",
  status: "idle",
  errorMessage: null,
  stdout: "",
  compileError: null,
  runtimeError: null,
  truncated: false,
  warnings: [],
  batchTestIds: [],
  selectedBatchIds: [],
  batchLabels: {},

  setCode: (code) => set({ code }),
  setRawInput: (rawInput) => set({ rawInput }),

  setExecuteResult: (stdout, compileError, runtimeError, truncated = false, warnings = []) =>
    set({
      stdout,
      compileError,
      runtimeError,
      truncated,
      warnings,
      status: compileError || runtimeError ? "error" : "done",
    }),

  setStatus: (status) => set({ status }),
  setError: (msg) => set({ status: "error", errorMessage: msg }),
  clearError: () =>
    set({
      errorMessage: null,
      compileError: null,
      runtimeError: null,
      warnings: [],
      status: "idle",
    }),

  reset: () =>
    set({
      status: "idle",
      errorMessage: null,
      stdout: "",
      compileError: null,
      runtimeError: null,
      truncated: false,
      warnings: [],
    }),

  addBatchTestId: (id) =>
    set((s) =>
      s.batchTestIds.includes(id)
        ? s
        : {
            batchTestIds: [...s.batchTestIds, id],
            selectedBatchIds: [...s.selectedBatchIds, id],
          },
    ),
  removeBatchTestId: (id) =>
    set((s) => ({
      batchTestIds: s.batchTestIds.filter((x) => x !== id),
      selectedBatchIds: s.selectedBatchIds.filter((x) => x !== id),
      batchLabels: Object.fromEntries(
        Object.entries(s.batchLabels).filter(([k]) => k !== id),
      ),
    })),
  clearBatchTestIds: () =>
    set({ batchTestIds: [], selectedBatchIds: [], batchLabels: {} }),
  toggleSelectedBatchId: (id) =>
    set((s) => ({
      selectedBatchIds: s.selectedBatchIds.includes(id)
        ? s.selectedBatchIds.filter((x) => x !== id)
        : [...s.selectedBatchIds, id],
    })),
  setSelectedBatchIds: (ids) => set({ selectedBatchIds: ids }),
  setBatchLabel: (id, label) =>
    set((s) => ({ batchLabels: { ...s.batchLabels, [id]: label } })),
  addBatchCase: (id, label) =>
    set((s) => ({
      batchTestIds: s.batchTestIds.includes(id)
        ? s.batchTestIds
        : [...s.batchTestIds, id],
      selectedBatchIds: s.selectedBatchIds.includes(id)
        ? s.selectedBatchIds
        : [...s.selectedBatchIds, id],
      batchLabels: label ? { ...s.batchLabels, [id]: label } : s.batchLabels,
    })),
}));
