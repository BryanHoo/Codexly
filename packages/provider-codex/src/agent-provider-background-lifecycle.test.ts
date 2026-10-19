import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

const input = { files: [], images: [], skills: [], text: "后台继续执行", textAttachments: [] };
const options = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;
const turn = {
  id: "turn-background",
  status: "inProgress",
  items: [],
  itemsView: { type: "full" },
  startedAt: 1_753_228_800,
  completedAt: null,
  durationMs: null,
  error: null,
};

describe("background task subscription lifetime", () => {
  it("keeps a starting task subscribed so its later tool approval is delivered", async () => {
    const gate = Promise.withResolvers<unknown>();
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      () => gate.promise,
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.startTask();
    const starting = provider.startTurn("task-1", input, options);
    await vi.waitFor(() => {
      expect(rpc.calls.at(-1)?.method).toBe("turn/start");
    });
    try {
      // 模拟用户发送后立即切走：启动响应和 turn/started 均尚未到达。
      expect(await provider.unsubscribeTask("task-1")).toBe("busy");
      expect(rpc.calls.some(({ method }) => method === "thread/unsubscribe")).toBe(false);
      rpc.emitServerRequest(7, "item/commandExecution/requestApproval", {
        availableDecisions: ["accept", "decline"],
        command: "pnpm check",
        cwd: "/workspace/Codexly",
        itemId: "command-1",
        kind: "command",
        reason: "执行检查",
        startedAtMs: 1_753_228_800_000,
        threadId: "task-1",
        turnId: turn.id,
      });
      expect(events.some((event) => event.type === "pending_request.created")).toBe(true);
    } finally {
      gate.resolve({ turn });
      await starting;
    }
  });

  it("does not let an older idle read revoke a newly running task subscription", async () => {
    const gate = Promise.withResolvers<unknown>();
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread({ turns: [], status: { type: "idle" } }) },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const request = rpc.request.bind(rpc);
    const requestSpy = vi
      .spyOn(rpc, "request")
      .mockImplementation((method, params) =>
        method === "thread/goal/get" ? gate.promise : request(method, params),
      );
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();
    const reading = provider.readTask("task-1");
    await vi.waitFor(() => {
      expect(requestSpy).toHaveBeenCalledWith(
        "thread/goal/get",
        expect.anything(),
        undefined,
        undefined,
      );
    });
    // 历史读取尚未完成时，实时事件已经证明任务开始执行。
    rpc.emitNotification("turn/started", { threadId: "task-1", turn });
    gate.resolve({ goal: null });
    await reading;
    expect(await provider.unsubscribeTask("task-1")).toBe("busy");
    expect(rpc.calls.some(({ method }) => method === "thread/unsubscribe")).toBe(false);
  });
});
