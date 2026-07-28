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

  setCode: (code: string) => void;
  setRawInput: (input: string) => void;
  setExecuteResult: (
    stdout: string,
    compileError: string | null,
    runtimeError: string | null,
    truncated?: boolean
  ) => void;
  setStatus: (status: AppStatus) => void;
  setError: (msg: string) => void;
  reset: () => void;
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

  setCode: (code) => set({ code }),
  setRawInput: (rawInput) => set({ rawInput }),

  setExecuteResult: (stdout, compileError, runtimeError, truncated = false) =>
    set({
      stdout,
      compileError,
      runtimeError,
      truncated,
      status: compileError || runtimeError ? "error" : "done",
    }),

  setStatus: (status) => set({ status }),
  setError: (msg) => set({ status: "error", errorMessage: msg }),

  reset: () =>
    set({
      status: "idle",
      errorMessage: null,
      stdout: "",
      compileError: null,
      runtimeError: null,
      truncated: false,
    }),
}));
