import { create } from "zustand";
import type { SearchOccurrence } from "@/protocol/global-search.js";

export type HistoryLocation = SearchOccurrence &
  Readonly<{ projectId: string; taskId: string; query: string }>;
// 只保留当前一次定位；不把历史快照写入实时 Runtime，也不持久化搜索词。
export const useHistoryLocation = create<{
  location: HistoryLocation | null;
  setLocation: (location: HistoryLocation | null) => void;
}>((set) => ({ location: null, setLocation: (location) => set({ location }) }));
