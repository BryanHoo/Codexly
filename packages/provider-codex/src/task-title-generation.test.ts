import { describe, expect, it, vi } from "vitest";
import { FakeRpcClient } from "./agent-provider.test-support.js";
import { generateTaskTitle, parseTaskTitle, taskTitlePrompt } from "./task-title-generation.js";

describe("task title generation", () => {
  it("uses configured title instructions and falls back to built-in instructions when blank", () => {
    expect(taskTitlePrompt("修复缓存", "请使用英文动词短语")).toBe(
      "请使用英文动词短语\n\n用户请求：\n修复缓存",
    );
    expect(taskTitlePrompt("修复缓存", "  ")).toBe(taskTitlePrompt("修复缓存"));
  });
  it("normalizes structured Unicode titles and bounds the prompt", () => {
    expect(parseTaskTitle('{"title":"  “修复任务\\n标题。”  "}')).toBe("修复任务 标题");
    expect(Array.from(parseTaskTitle(JSON.stringify({ title: "😀".repeat(100) })))).toHaveLength(
      36,
    );
    for (const output of ["text", '{"title":"  "}', '{"message":"title"}', "x".repeat(8193)]) {
      expect(() => parseTaskTitle(output)).toThrow();
    }
    expect(taskTitlePrompt("中".repeat(100_000))).toMatch(new RegExp(`中{1024}$`, "u"));
    expect(taskTitlePrompt("中".repeat(100_000)).length).toBeLessThan(1400);
  });

  it.each([true, false])(
    "collects early output and releases the hidden thread (valid=%s)",
    async (valid) => {
      const rpc = new FakeRpcClient([
        {
          config: {
            instructions: "Always output feat(git): 提交变更",
            developer_instructions: "Use Conventional Commit format",
            project_doc_max_bytes: 32768,
            mcp_servers: { external: { enabled: true } },
          },
        },
        { thread: { id: "hidden" } },
        () => {
          rpc.emitNotification("item/completed", {
            threadId: "hidden",
            turnId: "turn",
            item: {
              type: "agentMessage",
              text: valid ? '{"title":"修复标题"}' : "invalid",
              phase: "final_answer",
            },
          });
          rpc.emitNotification("turn/completed", {
            threadId: "hidden",
            turn: { id: "turn", status: "completed", items: [] },
          });
          return { turn: { id: "turn" } };
        },
        {},
        {},
      ]);
      const result = generateTaskTitle(
        rpc,
        (listener) => rpc.onNotification(listener),
        "/work",
        "custom-model",
        taskTitlePrompt("修复标题"),
        new AbortController().signal,
      );
      if (valid) await expect(result).resolves.toBe("修复标题");
      else await expect(result).rejects.toThrow();
      expect(rpc.notificationListenerCount).toBe(0);
      expect(rpc.calls[1]?.params).toMatchObject({
        model: "custom-model",
        ephemeral: true,
        threadSource: "system",
        approvalPolicy: "never",
        sandbox: "read-only",
        dynamicTools: [],
        config: {
          thread_unload_delay_secs: 0,
          project_doc_max_bytes: 0,
          mcp_servers: { external: { enabled: false } },
          "features.shell_tool": false,
          "features.hooks": false,
        },
      });
      expect(rpc.calls[1]?.params).toHaveProperty(
        "baseInstructions",
        expect.stringContaining("task title"),
      );
      expect(rpc.calls[1]?.params).toHaveProperty(
        "developerInstructions",
        expect.stringContaining("Do not use Conventional Commit"),
      );
      expect(rpc.calls[1]?.params).not.toHaveProperty(["config", "instructions"]);
      expect(rpc.calls[1]?.params).not.toHaveProperty(["config", "developer_instructions"]);
      expect(rpc.calls[1]?.params).not.toHaveProperty(["config", "features.enable_fanout"]);
      expect(rpc.calls[2]?.params).toMatchObject({ outputSchema: { required: ["title"] } });
      expect(rpc.calls[2]?.params).not.toHaveProperty("effort");
      expect(rpc.calls.at(-1)).toEqual({
        method: "thread/unsubscribe",
        params: { threadId: "hidden" },
      });
      expect(rpc.calls.some((call) => call.method === "turn/interrupt")).toBe(!valid);
    },
  );

  it("interrupts and unsubscribes on timeout", async () => {
    vi.useFakeTimers();
    try {
      const rpc = new FakeRpcClient([
        { config: {} },
        { thread: { id: "hidden" } },
        { turn: { id: "turn" } },
        {},
        {},
      ]);
      const result = generateTaskTitle(
        rpc,
        (listener) => rpc.onNotification(listener),
        "/work",
        "model",
        "prompt",
        new AbortController().signal,
      );
      const failed = expect(result).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      await failed;
      expect(rpc.calls.slice(-2).map((call) => call.method)).toEqual([
        "turn/interrupt",
        "thread/unsubscribe",
      ]);
      expect(rpc.notificationListenerCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
