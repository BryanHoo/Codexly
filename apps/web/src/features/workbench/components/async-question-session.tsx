import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createStore } from "zustand/vanilla";

export type QuestionAnswer = Readonly<{ choice: number | null; text: string }>;
export type QuestionDraft = Readonly<{
  answers: readonly QuestionAnswer[];
  status: "editing" | "sending" | "sent";
  error: boolean;
}>;

export const createQuestionDraftStore = () =>
  createStore<
    Readonly<{
      drafts: ReadonlyMap<string, QuestionDraft>;
    }>
  >(() => ({ drafts: new Map() }));

const AsyncQuestionContext = createContext<Readonly<{
  enabled: boolean;
  store: ReturnType<typeof createQuestionDraftStore>;
  submit: (text: string) => Promise<boolean>;
}> | null>(null);

export function AsyncQuestionProvider({
  children,
  enabled,
  submit,
}: Readonly<{
  children: ReactNode;
  enabled: boolean;
  submit: (text: string) => Promise<boolean>;
}>) {
  // 会话级保存草稿，虚拟列表卸载问题表单后仍可恢复；逐问题订阅避免流式重绘。
  const [store] = useState(createQuestionDraftStore);
  const value = useMemo(() => ({ enabled, store, submit }), [enabled, store, submit]);
  return <AsyncQuestionContext value={value}>{children}</AsyncQuestionContext>;
}

export const useAsyncQuestionSession = () => useContext(AsyncQuestionContext);

export function saveQuestionDraft(
  store: ReturnType<typeof createQuestionDraftStore>,
  id: string,
  draft: QuestionDraft,
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
