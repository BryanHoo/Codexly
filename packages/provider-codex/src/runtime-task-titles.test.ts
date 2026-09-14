import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import { FakeRpcClient, nativeThread, project } from "./agent-provider.test-support.js";

const input = {
  files: [],
  images: [],
  skills: [],
  text: "请修复任务标题生成",
  textAttachments: [],
};
const settings = {
  approvalPolicy: "never",
  approvalsReviewer: "user",
  model: "main-model",
  reasoningEffort: "high",
  sandboxMode: "read-only",
} as const;
const turn = {
  completedAt: null,
  durationMs: null,
  error: null,
  id: "main-turn",
  items: [],
  itemsView: { type: "full" },
  startedAt: 1_753_228_800,
  status: "inProgress",
};

function setup({
  goal = false,
  temporary = false,
  failFirst = false,
  name = null as string | null,
} = {}) {
  const rpc = new FakeRpcClient([]);
  const model = vi.fn(() => Promise.resolve("commit-model"));
  const runtime = createCodexRuntimeProvider({ client: rpc, readTaskTitleModel: model });
  const provider = temporary ? runtime.forTemporary("/tmp") : runtime.forProject(project);
  const events: AgentProviderEvent[] = [];
  provider.subscribeEvents((event) => events.push(event));
  let mainAttempts = 0;
  const request = vi.spyOn(rpc, "request").mockImplementation((method, params) =>
    Promise.resolve().then(() => {
      const p = params as Record<string, unknown>;
      if (method === "thread/start")
        return {
          thread:
            p["threadSource"] === "system"
              ? { id: "hidden" }
              : nativeThread({ name, projectId: temporary ? null : project.id }),
        };
      if (method === "config/read") return { config: {} };
      if (method === "turn/start") {
        if (p["threadId"] === "hidden") {
          rpc.emitNotification("item/completed", {
            threadId: "hidden",
            turnId: "title-turn",
            item: {
              type: "agentMessage",
              text: '{"title":"修复任务标题生成"}',
              phase: "final_answer",
            },
          });
          rpc.emitNotification("turn/completed", {
            threadId: "hidden",
            turn: { id: "title-turn", status: "completed" },
          });
          return { turn: { id: "title-turn" } };
        }
        if (failFirst && mainAttempts++ === 0) throw new Error("Main turn failed");
        return { turn };
      }
      if (method === "thread/goal/set") {
        rpc.emitNotification("turn/started", { threadId: "task-1", turn });
        return {
          goal: {
            createdAt: 1_754_396_400,
            objective: input.text,
            status: "active",
            threadId: "task-1",
            timeUsedSeconds: 0,
            tokenBudget: null,
            tokensUsed: 0,
            updatedAt: 1_754_396_400,
          },
        };
      }
      if (method === "thread/read")
        return { thread: nativeThread({ name, projectId: temporary ? null : project.id }) };
      if (method === "thread/name/set")
        rpc.emitNotification("thread/name/updated", {
          threadId: p["threadId"],
          threadName: p["name"],
        });
      return {};
    }),
  );
  return {
    runtime,
    provider,
    model,
    request,
    events,
    options: { ...settings, ...(goal ? { goalMode: true as const } : {}) },
  };
}

describe("runtime task title integration", () => {
  it.each([
    { goal: false, temporary: false },
    { goal: true, temporary: false },
    { goal: false, temporary: true },
  ])("generates titles after the first successful turn: %j", async (mode) => {
    const { provider, model, request, events, options } = setup(mode);
    await provider.startTask();
    expect(model).not.toHaveBeenCalled();
    await provider.startTurn("task-1", input, options);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/name/set", {
        threadId: "task-1",
        name: "修复任务标题生成",
      });
    });
    expect(events.some((event) => event.taskId === "hidden")).toBe(false);
    expect(
      events.some((event) => event.type === "task.metadata_changed" && event.taskId === "task-1"),
    ).toBe(true);
    await provider.startTurn("task-1", input, options);
    expect(model).toHaveBeenCalledOnce();
  });

  it("does not claim a title on a failed main turn", async () => {
    const { provider, model, request, options } = setup({ failFirst: true });
    await provider.startTask();
    await expect(provider.startTurn("task-1", input, options)).rejects.toThrow("Main turn failed");
    expect(model).not.toHaveBeenCalled();
    await provider.startTurn("task-1", input, options);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/name/set", expect.anything());
    });
    expect(model).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "does not generate for ephemeral or already named tasks (ephemeral=%s)",
    async (ephemeral) => {
      const { provider, model, options } = setup({ name: ephemeral ? null : "现有标题" });
      await provider.startTask({ ephemeral });
      await provider.startTurn("task-1", input, options);
      expect(model).not.toHaveBeenCalled();
    },
  );
  it("returns the main turn while model settings are still loading", async () => {
    const { provider, model, request, options } = setup();
    let finishModel: (model: string) => void = () => undefined;
    model.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishModel = resolve;
        }),
    );
    await provider.startTask();
    await expect(provider.startTurn("task-1", input, options)).resolves.toMatchObject({
      id: "main-turn",
    });
    expect(request.mock.calls.some(([method]) => method === "config/read")).toBe(false);
    finishModel("latest-commit-model");
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/name/set", expect.anything());
    });
    expect(request).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({ model: "latest-commit-model" }),
    );
  });
});
