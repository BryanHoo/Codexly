import { create } from "zustand";
import type { SearchOccurrence } from "@codexly/protocol";

export type HistoryLocation = SearchOccurrence &
  Readonly<{ projectId: string; query: string; taskId: string }>;

// 历史定位只属于当前视图，不写入持久化状态或实时 Runtime。
export const useHistoryLocation = create<{
  location: HistoryLocation | null;
  setLocation: (location: HistoryLocation | null) => void;
}>((set) => ({
  location: null,
  setLocation: (location) => {
    set({ location });
  },
}));
