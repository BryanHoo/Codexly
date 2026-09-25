import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";

export type QuestionAnswer = Readonly<{ choice: number | null; text: string }>;
export type QuestionDraft = Readonly<{
  answers: readonly QuestionAnswer[];
  status: "editing" | "sending" | "sent";
  error: boolean;
}>;

type QuestionStorage = Pick<Storage, "getItem" | "setItem">;

function readDismissedQuestions(storage: QuestionStorage, key: string | undefined): Set<string> {
  try {
    const ids: unknown = JSON.parse(key === undefined ? "[]" : storage.getItem(key) ?? "[]");
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) return new Set(ids);
  } catch { /* 忽略损坏的偏好记录，不阻断任务打开。 */ }
  return new Set();
}

export function createQuestionDraftStore(scope?: string, storage: QuestionStorage = appPreferenceStorage) {
  const key = scope === undefined ? undefined : `codeagent:async-questions:dismissed:v1:${scope}`;
  return createStore<Readonly<{
    drafts: ReadonlyMap<string, QuestionDraft>;
    dismissedIds: ReadonlySet<string>;
    dismiss: (id: string) => void;
  }>>((set, get) => ({
    drafts: new Map(),
    dismissedIds: readDismissedQuestions(storage, key),
    dismiss(id) {
      const dismissedIds = new Set(get().dismissedIds).add(id);
      // 关闭记录独立于有界草稿，仅显式关闭时持久化 ID，重开任务仍生效。
      set({ dismissedIds });
      if (key !== undefined) {
        try { storage.setItem(key, JSON.stringify([...dismissedIds])); }
        catch { /* 存储不可用时保留当前会话内的关闭结果。 */ }
      }
    },
  }));
}

const AsyncQuestionContext = createContext<Readonly<{
  enabled: boolean;
  store: ReturnType<typeof createQuestionDraftStore>;
  submit: (text: string) => Promise<boolean>;
}> | null>(null);

export function AsyncQuestionProvider({ children, enabled, submit, scope }: Readonly<{
  children: ReactNode;
  enabled: boolean;
  scope?: string;
  submit: (text: string) => Promise<boolean>;
}>) {
  // 会话级保存草稿，虚拟列表卸载问题表单后仍可恢复；逐问题订阅避免流式重绘。
  const [store] = useState(() => createQuestionDraftStore(scope));
  const value = useMemo(() => ({ enabled, store, submit }), [enabled, store, submit]);
  return <AsyncQuestionContext value={value}>{children}</AsyncQuestionContext>;
}

export const useAsyncQuestionSession = () => useContext(AsyncQuestionContext);

export function saveQuestionDraft(
  store: ReturnType<typeof createQuestionDraftStore>, id: string, draft: QuestionDraft,
) {
  store.setState((state) => {
    const drafts = new Map(state.drafts);
    drafts.delete(id);
    drafts.set(id, draft);
    // 只保留最近操作的有界草稿，发送中的记录不能淘汰。
    if (drafts.size > 128) {
      for (const [key, value] of drafts) {
        if (key !== id && value.status !== "sending") {
          drafts.delete(key);
          break;
        }
      }
    }
    return { drafts };
  });
}
