import { describe, expect, it, vi } from "vitest";
import { FakeRpcClient, projectTaskScope } from "./agent-provider.test-support.js";
import { CodexTaskTitles } from "./task-titles.js";

const input = { files: [], images: [], skills: [], text: "生成标题", textAttachments: [] };
function setup(name: string | null = null, projectId: string | null = projectTaskScope.id) {
  const rpc = new FakeRpcClient([]);
  const readModel = vi.fn(() => Promise.resolve("commit-model"));
  const logger = { warn: vi.fn() };
  const titles = new CodexTaskTitles(rpc, readModel, logger);
  let releaseOutput: () => void = () => undefined;
  const request = vi.spyOn(rpc, "request").mockImplementation((method, params) =>
    Promise.resolve().then(() => {
      const p = params as Record<string, unknown>;
      if (method === "config/read") return { config: {} };
      if (method === "thread/start") return { thread: { id: "hidden" } };
      if (method === "turn/start") {
        releaseOutput = () => {
          titles.receiveNotification({
            method: "item/completed",
            params: {
              threadId: "hidden",
              turnId: "turn",
              item: { type: "agentMessage", text: '{"title":"自动标题"}', phase: "final_answer" },
            },
          });
          titles.receiveNotification({
            method: "turn/completed",
            params: { threadId: "hidden", turn: { id: "turn", status: "completed" } },
          });
        };
        return { turn: { id: "turn" } };
      }
      if (method === "thread/read") return { thread: { id: "task", projectId, name } };
      if (method === "thread/name/set") name = p["name"] as string;
      return {};
    }),
  );
  titles.register("task", projectTaskScope, "/work");
  return {
    titles,
    request,
    readModel,
    logger,
    release: () => {
      releaseOutput();
    },
  };
}

describe("automatic task titles", () => {
  it("claims a new task once, reads its model in the background and persists the result", async () => {
    const { titles, request, readModel, release } = setup();
    titles.start("task", input);
    titles.start("task", input);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("turn/start", expect.anything());
    });
    release();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/name/set", {
        threadId: "task",
        name: "自动标题",
      });
    });
    expect(readModel).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({ model: "commit-model" }),
    );
    await titles.releaseProject(projectTaskScope.id);
  });

  it.each(["手动标题", null])(
    "preserves existing names and rejects foreign ownership (name=%s)",
    async (name) => {
      const { titles, request, release, logger } = setup(
        name,
        name ? projectTaskScope.id : "foreign",
      );
      titles.start("task", input);
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledWith("turn/start", expect.anything());
      });
      release();
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledWith("thread/read", expect.anything());
      });
      await titles.releaseProject(projectTaskScope.id);
      expect(request.mock.calls.some(([method]) => method === "thread/name/set")).toBe(false);
      if (!name) expect(logger.warn).toHaveBeenCalledOnce();
    },
  );

  it("serializes manual rename against the automatic read/write pair", async () => {
    const { titles, request, release } = setup();
    titles.start("task", input);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("turn/start", expect.anything());
    });
    let finishRename: () => void = () => undefined;
    const manual = titles.mutate("task", async () => {
      await new Promise<void>((resolve) => {
        finishRename = resolve;
      });
      await request("thread/name/set", { threadId: "task", name: "用户标题" });
    });
    await Promise.resolve();
    release();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/unsubscribe", expect.anything());
    });
    finishRename();
    await manual;
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("thread/read", expect.anything());
    });
    await titles.releaseProject(projectTaskScope.id);
    expect(request.mock.calls.filter(([method]) => method === "thread/name/set")).toEqual([
      ["thread/name/set", { threadId: "task", name: "用户标题" }],
    ]);
  });

  it("cancels auxiliary turns when their project is released", async () => {
    const { titles, request } = setup();
    titles.start("task", input);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("turn/start", expect.anything());
    });
    await titles.releaseProject(projectTaskScope.id);
    expect(request).toHaveBeenCalledWith("turn/interrupt", { threadId: "hidden", turnId: "turn" });
    expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "hidden" });
    expect(request.mock.calls.some(([method]) => method === "thread/name/set")).toBe(false);
  });
});
