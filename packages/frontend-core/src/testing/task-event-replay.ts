import type { AgentEvent } from "@codexly/protocol";
import { describe, expect, test, vi } from "vitest";

const timestamp = "2026-10-29T00:00:00.000Z";
const identity = { projectId: "project", taskId: "task" };
const envelope = (sequence: number, provider: string) => ({
  version: 2 as const,
  provider,
  ...identity,
  turnId: "turn",
  sessionId: "session",
  sequence,
  timestamp,
});
const message = (id: string, role: "assistant" | "user", text: string) => ({
  id,
  type: "message" as const,
  role,
  text,
});
type Item =
  | ReturnType<typeof message>
  | {
      id: string;
      type: "command";
      command: string;
      cwd: string;
      status: "running" | "completed";
      output?: string;
      outputOmitted: { bytes: number; lines: number };
    };
function response(items: Item[] = []) {
  return {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: identity.taskId,
      projectId: identity.projectId,
      title: "事件回放",
      pinned: false,
      updatedAt: timestamp,
      status: "running" as const,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      turnsNextCursor: null,
      settings: {
        approvalPolicy: "on-request" as const,
        approvalsReviewer: "user" as const,
        model: "model",
        reasoningEffort: "high",
        sandboxMode: "workspace-write" as const,
      },
      turns: [
        {
          id: "turn",
          status: "running" as const,
          startedAt: timestamp,
          completedAt: null as string | null,
          error: null,
          items,
        },
      ],
    },
  };
}
type Response = ReturnType<typeof response>;
function fixtureTurn(initial: Response) {
  const turn = initial.snapshot.turns[0];
  if (turn === undefined) throw new Error("回放样本必须包含一个回合");
  return turn;
}
type Turn = Response["snapshot"]["turns"][number];
type ReplayEvent =
  | Extract<
      AgentEvent,
      {
        type:
          | "message.delta"
          | "command.output_delta"
          | "pending_request.created"
          | "pending_request.resolved"
          | "pending_request.expired"
          | "provider.error";
      }
    >
  | (ReturnType<typeof envelope> &
      (
        | { type: "turn.started"; payload: { turn: Turn } }
        | {
            type: "turn.completed";
            payload: { turn: Omit<Turn, "status"> & { status: "completed" } };
          }
        | { type: "item.started" | "item.completed"; itemId: string; payload: { item: Item } }
      ));
interface ReplayItem {
  id: string;
  type: string;
  text?: string;
  summary?: string;
  output?: unknown;
  status?: string;
}
interface ReplayStore {
  getState(): {
    applyEvents(events: readonly ReplayEvent[]): void;
    checkpoint: { sequence: number; sessionId: string } | null;
    itemStoresByKey: Map<string, { read(): unknown; subscribe(listener: () => void): () => void }>;
    getItem(itemId: string, turnId: string): ReplayItem | undefined;
    reconstructSnapshot():
      | { turns: readonly { items: readonly ReplayItem[]; status: string; error: string | null }[] }
      | undefined;
    pendingRequestsById: Readonly<Record<string, { status: string }>>;
    retainedBytes: number;
  };
}

/** 同一组预设事件直接喂入真实 Store；不引入模拟模型、网络或人为等待。 */
export function runTaskEventReplayContract<Store extends ReplayStore>(
  createStore: (initial: Response) => Store,
  appendReasoning: (store: Store, sequence: number, provider: string) => void,
): void {
  for (const provider of ["codex", "claude"]) {
    describe(`${provider} 共享事件回放`, () => {
      const ids = (store: Store) =>
        store
          .getState()
          .reconstructSnapshot()
          ?.turns[0]?.items.map((item) => item.id);
      test("晚到的空启动事件保留已经显示的提交消息与 Store 身份", () => {
        const initial = response([message("submitted-user-turn", "user", "继续")]);
        const store = createStore(initial);
        const original = [...store.getState().itemStoresByKey.values()][0];
        store.getState().applyEvents([
          {
            ...envelope(1, provider),
            type: "turn.started",
            payload: { turn: { ...fixtureTurn(initial), items: [] } },
          },
        ]);
        expect(ids(store)).toEqual(["submitted-user-turn"]);
        expect([...store.getState().itemStoresByKey.values()][0]).toBe(original);
      });
      test("权威用户消息原位接管占位，不能移到已经到达的助手后面", () => {
        const store = createStore(response([message("submitted-user-turn", "user", "继续")]));
        store.getState().applyEvents([
          {
            ...envelope(1, provider),
            type: "item.started",
            itemId: "assistant",
            payload: { item: message("assistant", "assistant", "处理") },
          },
          {
            ...envelope(2, provider),
            type: "item.completed",
            itemId: "user",
            payload: { item: message("user", "user", "继续") },
          },
        ]);
        expect(ids(store)).toEqual(["user", "assistant"]);
      });
      test.each([false, true])("批量模式 %s 保持重复过滤、审批和终态合并一致", (batched) => {
        const initial = response([message("user", "user", "执行检查")]);
        const store = createStore(initial);
        const command: Item = {
          id: "command",
          type: "command",
          command: "pwd",
          cwd: "/work",
          status: "running",
          outputOmitted: { bytes: 0, lines: 0 },
        };
        const request = {
          type: "tool_approval" as const,
          toolName: "shell",
          input: {},
          reason: null,
          requestId: "approval",
          ...identity,
          turnId: "turn",
          itemId: "command",
          createdAt: timestamp,
          expiresAt: null,
          availableDecisions: ["allow" as const, "deny" as const],
        };
        const delta: ReplayEvent = {
          ...envelope(5, provider),
          type: "message.delta",
          itemId: "assistant",
          payload: { delta: "你好 🌏" },
        };
        const events: ReplayEvent[] = [
          {
            ...envelope(1, provider),
            type: "item.started",
            itemId: command.id,
            payload: { item: command },
          },
          {
            ...envelope(2, provider),
            type: "pending_request.created",
            itemId: "command",
            payload: { request: { ...request, status: "pending" } },
          },
          {
            ...envelope(3, provider),
            type: "pending_request.resolved",
            itemId: "command",
            payload: { request: { ...request, status: "resolved" } },
          },
          {
            ...envelope(4, provider),
            type: "command.output_delta",
            itemId: command.id,
            payload: { delta: "/work\n" },
          },
          delta,
          delta,
          { ...delta, sequence: 99, taskId: "another" },
          { ...delta, sequence: 99, sessionId: "another" },
          {
            ...envelope(6, provider),
            type: "message.delta",
            itemId: "assistant",
            payload: { delta: "，完成" },
          },
        ];
        if (batched) store.getState().applyEvents(events);
        else for (const event of events) store.getState().applyEvents([event]);
        expect(store.getState().checkpoint).toEqual({ sessionId: "session", sequence: 6 });
        expect(store.getState().getItem("assistant", "turn")?.text).toBe("你好 🌏，完成");
        expect(store.getState().getItem("command", "turn")?.output).toBe("/work\n");
        expect(store.getState().pendingRequestsById["approval"]?.status).toBe("resolved");
        // 终态仅携带正文摘要时，实时命令仍保留，且完整正文只接管同一实体。
        store.getState().applyEvents([
          {
            ...envelope(7, provider),
            type: "turn.completed",
            payload: {
              turn: {
                ...fixtureTurn(initial),
                status: "completed",
                completedAt: timestamp,
                items: [
                  message("user", "user", "执行检查"),
                  message("assistant", "assistant", "你好 🌏，完成。"),
                ],
              },
            },
          },
        ]);
        expect(ids(store)).toEqual(["user", "command", "assistant"]);
        expect(store.getState().getItem("assistant", "turn")?.text).toBe("你好 🌏，完成。");
        expect(store.getState().reconstructSnapshot()?.turns[0]?.status).toBe("completed");
        expect(store.getState().retainedBytes).toBeGreaterThan(0);
      });
      test("可重试错误由新输出解除，审批过期保留终态并拒绝旧事件重放", () => {
        const store = createStore(response([message("assistant", "assistant", "开始")]));
        const request = {
          type: "tool_approval" as const,
          toolName: "shell",
          input: {},
          reason: null,
          requestId: "expired",
          ...identity,
          turnId: "turn",
          itemId: "tool",
          createdAt: timestamp,
          expiresAt: null,
          availableDecisions: ["allow" as const, "deny" as const],
        };
        const created: ReplayEvent = {
          ...envelope(1, provider),
          itemId: "tool",
          type: "pending_request.created",
          payload: { request: { ...request, status: "pending" } },
        };
        store.getState().applyEvents([
          created,
          {
            ...envelope(2, provider),
            type: "provider.error",
            payload: { message: "正在重试", willRetry: true },
          },
        ]);
        expect(store.getState().reconstructSnapshot()?.turns[0]?.error).toBe("正在重试");
        expect(store.getState().reconstructSnapshot()?.turns[0]?.status).toBe("running");
        store.getState().applyEvents([
          {
            ...envelope(3, provider),
            type: "message.delta",
            itemId: "assistant",
            payload: { delta: "恢复" },
          },
          {
            ...envelope(4, provider),
            itemId: "tool",
            type: "pending_request.expired",
            payload: { request: { ...request, status: "expired" } },
          },
          created,
        ]);
        expect(store.getState().getItem("assistant", "turn")?.text).toBe("开始恢复");
        expect(store.getState().reconstructSnapshot()?.turns[0]?.error).toBeNull();
        expect(store.getState().pendingRequestsById["expired"]?.status).toBe("expired");
        expect(store.getState().checkpoint?.sequence).toBe(4);
      });
      test("推理通过平台适配保持公开摘要，不混入助手正文", () => {
        const store = createStore(response());
        appendReasoning(store, 1, provider);
        const reasoning = store.getState().getItem("reasoning", "turn");
        expect(reasoning?.summary ?? reasoning?.text).toBe("公开摘要");
        expect(store.getState().getItem("assistant", "turn")).toBeUndefined();
        expect(store.getState().checkpoint?.sequence).toBe(1);
      });
      test("增量批次只发布目标条目一次，不读取已有历史正文", () => {
        const store = createStore(
          response([
            message("history", "assistant", "历史".repeat(1000)),
            message("assistant", "assistant", ""),
          ]),
        );
        const entries = [...store.getState().itemStoresByKey.values()];
        const history = entries[0];
        const assistant = entries[1];
        if (history === undefined || assistant === undefined)
          throw new Error("回放样本必须包含历史和助手条目");
        const historyRead = vi.spyOn(history, "read");
        const published = vi.fn();
        const unsubscribe = assistant.subscribe(published);
        try {
          store.getState().applyEvents(
            Array.from({ length: 64 }, (_, index) => ({
              ...envelope(index + 1, provider),
              type: "message.delta" as const,
              itemId: "assistant",
              payload: { delta: "文" },
            })),
          );
          expect(historyRead).not.toHaveBeenCalled();
          expect(published).toHaveBeenCalledTimes(1);
          expect(store.getState().getItem("assistant", "turn")?.text).toBe("文".repeat(64));
        } finally {
          unsubscribe();
          historyRead.mockRestore();
        }
      });
    });
  }
}
