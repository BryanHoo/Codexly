import type { PendingRequest } from "@codexly/protocol";
import { expect, test } from "vitest";

const timestamp = "2026-10-17T00:00:00.000Z";
interface Message {
  id: string;
  type: "message";
  role: "user" | "assistant";
  text: string;
  identityAliases?: string[];
  attachments?: { id: string; kind: "image"; mediaType: "image/png"; name: string; size: number }[];
}
interface Tool {
  id: string;
  type: "tool";
  name: string;
  status: "running" | "completed";
}
type Item = Message | Tool;
const message = (id: string, text = "Hello", aliases?: string[]): Message => ({
  id,
  type: "message",
  role: "assistant",
  text,
  ...(aliases === undefined ? {} : { identityAliases: aliases }),
});
const image = (id: string): Message => ({
  id,
  type: "message",
  role: "user",
  text: "",
  attachments: [
    { id: `image-${id}`, kind: "image", mediaType: "image/png", name: `${id}.png`, size: 100 },
  ],
});
function response(items: Item[], sessionId = "session", sequence = 0) {
  return {
    checkpoint: { sessionId, sequence },
    snapshot: {
      id: "task",
      projectId: "project",
      title: "契约测试",
      pinned: false,
      updatedAt: timestamp,
      status: "running" as const,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [] as PendingRequest[],
      turnsNextCursor: null as string | null,
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
          completedAt: null,
          error: null,
          items,
          itemTimings: {} as Record<string, { startedAtMs?: number; completedAtMs?: number }>,
        },
      ],
    },
  };
}
type Response = ReturnType<typeof response>;
function fixtureTurn(initial: Response) {
  const turn = initial.snapshot.turns[0];
  if (turn === undefined) throw new Error("契约样本必须包含一个回合");
  return turn;
}
const envelope = (sequence: number, sessionId = "session") => ({
  version: 2 as const,
  provider: "codex" as const,
  taskId: "task",
  turnId: "turn",
  timestamp,
  sessionId,
  sequence,
});
const completed = (item: Item, sequence: number, sessionId = "session") => ({
  ...envelope(sequence, sessionId),
  type: "item.completed" as const,
  itemId: item.id,
  payload: { item },
});
type ContractEvent =
  | ReturnType<typeof completed>
  | (Omit<ReturnType<typeof completed>, "type"> & { type: "item.started" })
  | ({
      type: "task.notice";
      payload: { code: "runtime_warning"; level: "warning"; message: string };
    } & ReturnType<typeof envelope>)
  | ({
      type: "turn.completed";
      payload: {
        turn: Omit<Response["snapshot"]["turns"][number], "status"> & { status: "completed" };
      };
    } & ReturnType<typeof envelope>);
interface ContractStore {
  getState(): {
    reconcile(response: Response): void;
    applyEvents(events: readonly ContractEvent[]): void;
    notices: readonly unknown[];
    retainedBytes: number;
    reconstructSnapshot():
      | {
          turns: readonly {
            id: string;
            items: readonly { id: string; status?: string }[];
            itemTimings?: Record<string, { startedAtMs?: number; completedAtMs?: number }>;
          }[];
          pendingRequests: readonly { requestId: string }[];
          turnsNextCursor: string | null;
        }
      | undefined;
  };
}

/** 两端注册同一组行为用例，防止平台副本再次产生身份与恢复语义差异。 */
export function taskIdentityContract(createStore: (initial: Response) => ContractStore): void {
  const ids = (store: ContractStore) =>
    store
      .getState()
      .reconstructSnapshot()
      ?.turns[0]?.items.map((item) => item.id);
  test.each(["Hello", "Hello world"])("不同 ID 的文本消息不能因内容 %s 合并", (text) => {
    const store = createStore(response([message("old")]));
    store.getState().reconcile(response([message("new", text)]));
    expect(ids(store)).toEqual(["old", "new"]);
  });
  test("相同媒体类型和大小的纯图片消息仍是独立实体", () => {
    const store = createStore(response([image("old")]));
    store.getState().reconcile(response([image("new")]));
    expect(ids(store)).toEqual(["old", "new"]);
  });
  test.each([
    message("canonical", "权威正文", ["old"]),
    { ...image("canonical"), identityAliases: ["old"] },
  ])("快照只依据明确别名接管旧实体 $id", (canonical) => {
    const store = createStore(
      response([canonical.attachments === undefined ? message("old") : image("old")]),
    );
    store.getState().reconcile(response([canonical]));
    expect(ids(store)).toEqual(["canonical"]);
    store.getState().reconcile(response([canonical]));
    expect(ids(store)).toEqual(["canonical"]);
  });
  test("单条完成事件按明确别名去重并保留原位置", () => {
    const store = createStore(response([message("old"), message("tail")]));
    store.getState().applyEvents([completed(message("canonical", "完成", ["old"]), 1)]);
    expect(ids(store)).toEqual(["canonical", "tail"]);
  });
  test("切回任务后旧回答 ID 再次出现仍原位接管，缺省别名不能丢失身份", () => {
    const answer = {
      ...message("native-answer", "范围\n整个项目", ["persisted-answer"]),
      role: "user" as const,
    };
    const withoutAliases = {
      id: answer.id,
      type: answer.type,
      role: answer.role,
      text: answer.text,
    };
    const tail = message("tail", "继续执行");
    const store = createStore(response([answer, tail]));
    // 中间快照可能不带别名；之后恢复持久回答时仍须识别同一实体。
    store.getState().reconcile(response([withoutAliases, tail]));
    for (let index = 0; index < 3; index++) {
      store.getState().reconcile(response([tail, { ...withoutAliases, id: "persisted-answer" }]));
      expect(ids(store)).toEqual(["persisted-answer", "tail"]);
      store.getState().reconcile(response([withoutAliases, tail]));
      expect(ids(store)).toEqual(["native-answer", "tail"]);
    }
  });
  test.each(["item.started", "item.completed", "turn.completed"] as const)(
    "%s 省略别名后恢复异步回答仍只显示一次且保持原位置",
    (type) => {
      const answer = {
        ...message("native-answer", "结构方案\n确认，按此方案实施", ["persisted-answer"]),
        role: "user" as const,
      };
      const { identityAliases: _aliases, ...native } = answer;
      const tail = message("tail", "结构方案已确认，我现在按此实施。");
      const store = createStore(response([answer, tail]));
      // 实时/终态事件不携带服务端补充的持久回答别名，不能撤销已确认的身份关系。
      store.getState().applyEvents([
        type === "turn.completed"
          ? {
              ...envelope(1),
              type,
              payload: {
                turn: { ...fixtureTurn(response([native, tail])), status: "completed" },
              },
            }
          : { ...completed(native, 1), type },
      ]);
      for (let index = 0; index < 3; index++) {
        store
          .getState()
          .reconcile(response([tail, { ...native, id: "persisted-answer" }], "session", 1));
        expect(ids(store)).toEqual(["persisted-answer", "tail"]);
        store.getState().reconcile(response([native, tail], "session", 1));
        expect(ids(store)).toEqual(["native-answer", "tail"]);
      }
    },
  );
  test.each(["item.started", "item.completed", "turn.completed"] as const)(
    "%s 使用已知旧别名返回时不能在助手回复后追加第二条回答",
    (type) => {
      const answer = {
        ...message("native-answer", "范围\n整个项目", ["persisted-answer"]),
        role: "user" as const,
      };
      const tail = message("tail", "继续执行");
      const store = createStore(response([answer, tail]));
      const late = { ...answer, id: "persisted-answer", identityAliases: [] };
      for (let sequence = 1; sequence <= 3; sequence++) {
        store.getState().applyEvents([
          type === "turn.completed"
            ? {
                ...envelope(sequence),
                type,
                payload: {
                  turn: { ...fixtureTurn(response([late, tail])), status: "completed" },
                },
              }
            : { ...completed(late, sequence), type },
        ]);
        const snapshot = store.getState().reconstructSnapshot();
        expect(snapshot?.turns[0]?.items).toHaveLength(2);
        expect(snapshot?.turns[0]?.items[1]?.id).toBe("tail");
        if (type !== "turn.completed") {
          const authoritative = createStore(
            response([{ ...late, identityAliases: ["native-answer"] }, tail], "session", sequence),
          );
          expect(store.getState().retainedBytes).toBe(authoritative.getState().retainedBytes);
        }
      }
    },
  );
  test("别名接管释放旧正文的内存预算", () => {
    const canonical = message("canonical", "完成", ["old"]);
    const store = createStore(response([message("old", "长正文".repeat(10_000)), message("tail")]));
    store.getState().applyEvents([completed(canonical, 1)]);
    const authoritative = createStore(response([canonical, message("tail")], "session", 1));
    expect(store.getState().retainedBytes).toBe(authoritative.getState().retainedBytes);
  });
  test("终态回合按明确别名去重并保留迟到工具", () => {
    const tool: Tool = { id: "tool", type: "tool", name: "shell", status: "completed" };
    const store = createStore(response([message("old"), tool]));
    store.getState().applyEvents([
      {
        ...envelope(1),
        type: "turn.completed",
        payload: {
          turn: {
            ...fixtureTurn(response([message("canonical", "完成", ["old"])])),
            status: "completed",
          },
        },
      },
    ]);
    expect(ids(store)).toEqual(["canonical", "tool"]);
  });
  test("新进程的空 items 权威快照不能补回旧实时实体", () => {
    const store = createStore(response([message("old")]));
    store.getState().reconcile(response([], "restarted", 0));
    expect(ids(store)).toEqual([]);
    store.getState().applyEvents([completed(message("stale"), 99)]);
    expect(ids(store)).toEqual([]);
    store.getState().applyEvents([completed(message("fresh"), 1, "restarted")]);
    expect(ids(store)).toEqual(["fresh"]);
  });
  test("新 session 丢弃旧分页历史和游标", () => {
    const initial = response([message("old")]);
    initial.snapshot.turnsNextCursor = "old-cursor";
    initial.snapshot.turns.unshift({ ...fixtureTurn(initial), id: "older", items: [] });
    const store = createStore(initial);
    const incoming = response([], "restarted");
    incoming.snapshot.turnsNextCursor = "new-cursor";
    store.getState().reconcile(incoming);
    const snapshot = store.getState().reconstructSnapshot();
    expect(snapshot?.turns.map((turn) => turn.id)).toEqual(["turn"]);
    expect(snapshot?.turnsNextCursor).toBe("new-cursor");
  });
  test("同一 session 保留实时工具并接受快照之后的迟到完成事件", () => {
    const tool: Tool = { id: "tool", type: "tool", name: "shell", status: "running" };
    const store = createStore(response([message("old"), tool]));
    store.getState().reconcile(response([message("old")], "session", 1));
    expect(ids(store)).toEqual(["old", "tool"]);
    store.getState().applyEvents([completed({ ...tool, status: "completed" }, 2)]);
    expect(ids(store)).toEqual(["old", "tool"]);
    expect(store.getState().reconstructSnapshot()?.turns[0]?.items[1]?.status).toBe("completed");
  });
  test("新运行时清除旧审批、工具计时与警告，同会话警告可保留", () => {
    const initial = response([message("old")]);
    fixtureTurn(initial).itemTimings = { tool: { startedAtMs: 100 } };
    initial.snapshot.pendingRequests = [
      {
        type: "command_approval",
        kind: "command",
        requestId: "approval",
        projectId: "project",
        taskId: "task",
        turnId: "turn",
        itemId: "tool",
        createdAt: timestamp,
        expiresAt: null,
        status: "pending",
        command: "pwd",
        cwd: "/work",
        reason: null,
        networkAccess: null,
        availableDecisions: ["allow", "deny"],
      },
    ];
    const store = createStore(initial);
    store.getState().applyEvents([
      {
        ...envelope(1),
        type: "task.notice",
        payload: { code: "runtime_warning", level: "warning", message: "旧警告" },
      },
    ]);
    store.getState().reconcile(response([message("old")], "session", 2));
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().reconstructSnapshot()?.turns[0]?.itemTimings?.["tool"]).toEqual({
      startedAtMs: 100,
    });
    store.getState().reconcile(response([], "restarted"));
    expect(store.getState().notices).toEqual([]);
    expect(store.getState().reconstructSnapshot()?.pendingRequests).toEqual([]);
    expect(store.getState().reconstructSnapshot()?.turns[0]?.itemTimings).toEqual({});
  });
}
