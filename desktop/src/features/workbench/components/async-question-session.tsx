import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";

export type QuestionAnswer = Readonly<{ choice: number | null; text: string }>;
export type QuestionDraft = Readonly<{
  answers: readonly QuestionAnswer[];
  status: "editing" | "sending" | "sent";
  error: boolean;
}>;

type QuestionStorage = Pick<Storage, "getItem" | "setItem">;
type QuestionDraftState = Readonly<{
  drafts: ReadonlyMap<string, QuestionDraft>;
  dismissedIds: ReadonlySet<string>;
  sentIds: ReadonlySet<string>;
  dismiss: (id: string) => void;
  markSent: (id: string) => void;
}>;
type QuestionDraftStore = StoreApi<QuestionDraftState>;
// 仅共享有在途投递的任务；完成后释放引用，不常驻缓存所有历史任务的草稿。
const pendingStores = new WeakMap<QuestionStorage, Map<string, QuestionDraftStore>>();
const storeScopes = new WeakMap<QuestionDraftStore, Readonly<{ scope: string; storage: QuestionStorage }>>();

function readDismissedQuestions(storage: QuestionStorage, key: string | undefined): Set<string> {
  try {
    const ids: unknown = JSON.parse(key === undefined ? "[]" : storage.getItem(key) ?? "[]");
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) return new Set(ids);
  } catch { /* 忽略损坏的偏好记录，不阻断任务打开。 */ }
  return new Set();
}

export function createQuestionDraftStore(scope?: string, storage: QuestionStorage = appPreferenceStorage): QuestionDraftStore {
  const pending = scope === undefined ? undefined : pendingStores.get(storage)?.get(scope);
  if (pending !== undefined) return pending;
  const key = scope === undefined ? undefined : `codeagent:async-questions:dismissed:v1:${scope}`;
  const sentKey = scope === undefined ? undefined : `codeagent:async-questions:sent:v1:${scope}`;
  const store = createStore<QuestionDraftState>((set, get) => ({
    drafts: new Map(),
    dismissedIds: readDismissedQuestions(storage, key),
    sentIds: readDismissedQuestions(storage, sentKey),
    markSent(id) {
      if (get().sentIds.has(id)) return;
      const sentIds = new Set(get().sentIds).add(id);
      // 已投递身份独立于草稿淘汰和历史分页；离开任务后旧请求成功也记录原任务。
      set({ sentIds });
      if (sentKey !== undefined) {
        try { storage.setItem(sentKey, JSON.stringify([...sentIds])); }
        catch { /* 存储不可用时仍保留当前会话的成功状态。 */ }
      }
    },
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
  if (scope !== undefined) storeScopes.set(store, { scope, storage });
  return store;
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
  const store = useMemo(() => createQuestionDraftStore(scope), [scope]);
  const value = useMemo(() => ({ enabled, store, submit }), [enabled, store, submit]);
  return <AsyncQuestionContext value={value}>{children}</AsyncQuestionContext>;
}

export const useAsyncQuestionSession = () => useContext(AsyncQuestionContext);

export function saveQuestionDraft(
  store: ReturnType<typeof createQuestionDraftStore>, id: string, draft: QuestionDraft,
) {
  if (draft.status === "sent") store.getState().markSent(id);
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
  const identity = storeScopes.get(store);
  if (identity === undefined) return;
  if (draft.status === "sending") {
    let tasks = pendingStores.get(identity.storage);
    if (tasks === undefined) {
      tasks = new Map();
      pendingStores.set(identity.storage, tasks);
    }
    tasks.set(identity.scope, store);
  } else if (![...store.getState().drafts.values()].some((value) => value.status === "sending")) {
    // 导航回来会复用同一在途状态；成功或失败后即移除登记，后续从持久记录恢复。
    pendingStores.get(identity.storage)?.delete(identity.scope);
  }
}
