import type { AgentItem } from "@codexly/protocol";
import type { TaskStore, TaskStoreState } from "../../conversation/runtime/task-store-core.js";

export type QuestionMessage = Extract<AgentItem, { type: "message" }>;
export type QuestionEntry = Readonly<{ key: string; item: QuestionMessage }>;
const emptyQuestions: readonly QuestionEntry[] = [];

function matchesReply(item: QuestionMessage, text: string): boolean {
  const questions = item.questions ?? [];
  let remainder = text.trim();
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    if (question === undefined) return false;
    const title = question.title;
    const prefix = `${index === 0 ? title.trimStart() : title}\n`;
    if (!remainder.startsWith(prefix)) return false;
    remainder = remainder.slice(prefix.length);
    const next = questions[index + 1];
    if (next === undefined) return remainder.trim().length > 0;
    const boundary = remainder.indexOf(`\n\n${next.title}\n`);
    if (boundary < 1 || remainder.slice(0, boundary).trim() === "") return false;
    remainder = remainder.slice(boundary + 2);
  }
  return false;
}

export function collectAsyncQuestions(state: TaskStoreState): readonly QuestionEntry[] {
  const pending: QuestionEntry[] = [];
  for (const turnId of state.turnIds) {
    for (const key of state.itemKeysByTurnId[turnId] ?? []) {
      // peek 不拼接流式文本或命令输出；只读取完整消息中的问题与用户回答。
      const item = state.itemStoresByKey.get(key)?.peek();
      if (item?.type !== "message") continue;
      if (item.role === "assistant" && (item.questions?.length ?? 0) > 0) {
        pending.push({ key, item });
      } else if (item.role === "user") {
        // 普通消息没有 requestId，只识别本项目生成的完整回答格式，不猜测任意用户消息。
        const answered = pending.findLastIndex((entry) => matchesReply(entry.item, item.text));
        if (answered >= 0) pending.splice(answered, 1);
      }
    }
  }
  return pending;
}

export function createAsyncQuestionProjection(store: TaskStore | undefined) {
  let revision = -1;
  let itemStores: TaskStoreState["itemStoresByKey"] | undefined;
  let questions = emptyQuestions;
  return {
    subscribe: (notify: () => void) => store?.subscribe(notify) ?? (() => undefined),
    getSnapshot: () => {
      const state = store?.getState();
      if (state === undefined) return emptyQuestions;
      if (revision === state.itemStructureRevision && itemStores === state.itemStoresByKey) {
        return questions;
      }
      revision = state.itemStructureRevision;
      itemStores = state.itemStoresByKey;
      const next = collectAsyncQuestions(state);
      // 无关完整 Item 更新也复用引用，避免固定问答区跟随执行过程重绘。
      if (
        next.length !== questions.length ||
        next.some(
          (entry, index) =>
            entry.key !== questions[index]?.key || entry.item !== questions[index].item,
        )
      ) {
        questions = next;
      }
      return questions;
    },
  };
}
