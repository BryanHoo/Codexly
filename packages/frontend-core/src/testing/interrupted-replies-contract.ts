import type { AgentItem, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { expect, test, vi } from "vitest";
import type { InterruptedReplyStorage } from "../interrupted-replies.js";

const identity = { projectId: "project", taskId: "task" };
const timestamp = "2026-11-03T00:00:00Z";
function response(status: "running" | "interrupted" = "running", sessionId = "session") {
  return {
    checkpoint: { sessionId, sequence: 0 },
    snapshot: {
      ...identity,
      id: identity.taskId,
      title: "中断恢复",
      pinned: false,
      updatedAt: timestamp,
      status: status === "running" ? "running" : "idle",
      contextUsage: null,
      goal: null,
      plan: null,
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "model",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      pendingRequests: [],
      turnsNextCursor: null,
      turns: [
        {
          id: "turn",
          status,
          startedAt: timestamp,
          completedAt: null,
          error: null,
          items: [
            {
              id: "process",
              type: "message",
              role: "assistant",
              phase: "commentary",
              text: "正在处理",
            },
          ],
        },
      ],
    },
  } satisfies AgentTaskSnapshotResponse;
}
type FixtureResponse = ReturnType<typeof response>;
type Message = Extract<AgentItem, { type: "message" }>;
type Turn = Omit<FixtureResponse["snapshot"]["turns"][number], "items"> & { items: Message[] };
type FixtureEvent = {
  version: 2;
  provider: string;
  taskId: string;
  turnId: string;
  sessionId: string;
  timestamp: string;
  sequence: number;
} & (
  | { type: "message.delta"; itemId: string; payload: { delta: string } }
  | { type: "item.started"; itemId: string; payload: { item: Message } }
  | { type: "turn.completed"; payload: { turn: Turn } }
);
interface Store {
  getState(): {
    applyEvents(events: readonly FixtureEvent[]): void;
    hydrate(response: FixtureResponse): void;
    reconcile(response: FixtureResponse): void;
    getItem(itemId: string, turnId: string): { id: string; text?: string } | undefined;
  };
}
export function runInterruptedReplyContract(
  create: (initial: FixtureResponse, storage: InterruptedReplyStorage) => Store,
) {
  for (const mode of ["切换任务", "重启应用"] as const) {
    test(`${mode}后从持久记录恢复中断前的正文，过程信息不丢失`, () => {
      const values = new Map<string, string>();
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: vi.fn((key: string, value: string) => {
          values.set(key, value);
        }),
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
      const initial = response();
      const store = create(initial, storage);
      const envelope = {
        version: 2 as const,
        provider: "codex",
        ...identity,
        turnId: "turn",
        sessionId: "session",
        timestamp,
      };
      store.getState().applyEvents([
        {
          ...envelope,
          sequence: 1,
          type: "item.started",
          itemId: "answer",
          payload: {
            item: {
              id: "answer",
              type: "message",
              role: "assistant",
              phase: "final_answer",
              text: "",
            },
          },
        },
        {
          ...envelope,
          sequence: 2,
          type: "message.delta",
          itemId: "answer",
          payload: { delta: "已生成的" },
        },
        {
          ...envelope,
          sequence: 3,
          type: "message.delta",
          itemId: "answer",
          payload: { delta: "部分结果" },
        },
      ]);
      expect(storage.setItem).not.toHaveBeenCalled();
      const history = response("interrupted", mode === "重启应用" ? "new-session" : "session");
      const terminal = history.snapshot.turns[0];
      if (terminal === undefined) throw new Error("恢复测试必须包含一个回合");
      store.getState().applyEvents([
        {
          ...envelope,
          sequence: 4,
          type: "turn.completed",
          payload: {
            turn: {
              ...terminal,
              items: [
                ...terminal.items,
                {
                  id: "answer",
                  type: "message",
                  role: "assistant",
                  phase: "final_answer",
                  text: "",
                },
              ],
            },
          },
        },
      ]);
      expect(store.getState().getItem("answer", "turn")?.text).toBe("已生成的部分结果");
      // 新建真实 Store，且重启分支只复制磁盘字符串，不复用原内存或 checkpoint。
      const disk = new Map(values);
      const restored = create(history, { ...storage, getItem: (key) => disk.get(key) ?? null });
      expect(restored.getState().getItem("answer", "turn")?.text).toBe("已生成的部分结果");
      expect(restored.getState().getItem("process", "turn")?.text).toBe("正在处理");
      restored.getState().hydrate(history);
      expect(restored.getState().getItem("answer", "turn")?.text).toBe("已生成的部分结果");
      restored.getState().reconcile(history);
      expect(restored.getState().getItem("answer", "turn")?.text).toBe("已生成的部分结果");
    });
  }
}
