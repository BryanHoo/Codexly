import type { AgentItem, AgentTask, AgentTaskSnapshotResponse, AgentTurn } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  createConversationExport,
  MAX_CONVERSATION_EXPORT_BYTES,
  type ConversationRecord,
} from "./conversation-export.js";

const timestamp = "2026-10-25T00:00:00.000Z";
const task: AgentTask = {
  id: "task",
  projectId: "project",
  title: "中文 / 对话 🐈",
  pinned: false,
  updatedAt: timestamp,
};
const message = (id: string, text = id): AgentItem => ({ id, type: "message", role: "user", text });
const turn = (id: string, items: AgentItem[]): AgentTurn => ({
  id,
  items,
  status: "completed",
  error: null,
  startedAt: timestamp,
  completedAt: timestamp,
});
function page(turns: AgentTurn[], cursor: string | null = null): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sessionId: "session", sequence: 1 },
    snapshot: {
      ...task,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      settings: {
        model: "model",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "idle",
      turns,
      turnsNextCursor: cursor,
    },
  };
}

describe("createConversationExport", () => {
  it("按 UTF-8 字节限制大小，超限时拒绝导出", async () => {
    const source = page([
      turn("large", [message("body", "🐈".repeat(MAX_CONVERSATION_EXPORT_BYTES / 4))]),
    ]);
    await expect(
      createConversationExport({ readTask: vi.fn().mockResolvedValue(source) }, task),
    ).rejects.toThrow(RangeError);
  });
  it.each(["codex", "claude"] as const)(
    "合并 %s 的回合与条目续页，保留最新实体及时间顺序",
    async (engine) => {
      const newest = {
        ...turn("new", [message("b", "最新正文"), message("c", "代码\n```ts\n你好 🐈\n```")]),
        itemTimings: { b: { completedAtMs: 20 } },
      };
      const olderItems = {
        ...turn("new", [message("a"), message("b", "旧正文")]),
        itemTimings: { b: { startedAtMs: 10 } },
      };
      const readTask = vi
        .fn()
        .mockResolvedValueOnce(page([newest], "items"))
        .mockResolvedValueOnce(page([olderItems], "older"))
        .mockResolvedValueOnce(page([turn("old", [message("original")])]));
      const result = await createConversationExport(
        { readTask },
        { ...task, engine },
        new Date(timestamp),
      );
      const json = JSON.parse(result.content) as ConversationRecord;
      expect(json).toMatchObject({
        format: "codexly-conversation",
        version: 1,
        exportedAt: timestamp,
        task: { id: task.id, engine },
      });
      expect(json.turns.map((entry) => entry.id)).toEqual(["old", "new"]);
      expect(json.turns[1]?.items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
      expect(json.turns[1]?.items[1]).toMatchObject({ text: "最新正文" });
      expect(json.turns[1]?.items[2]).toHaveProperty("text", expect.stringContaining("你好 🐈"));
      expect(json.turns[1]?.itemTimings?.["b"]).toEqual({ startedAtMs: 10, completedAtMs: 20 });
      expect(json).not.toHaveProperty("settings");
      expect(result.content).not.toContain("turnsNextCursor");
      expect(result.fileName).toMatch(/\.json$/u);
      expect(result.fileName).not.toMatch(/[/:\\*?"<>|]/u);
      expect(readTask.mock.calls.map((args: unknown[]) => args[2])).toEqual([
        { summary: false },
        { summary: false, cursor: "items" },
        { summary: false, cursor: "older" },
      ]);
    },
  );

  it("保留工具、附件元数据与空任务，不输出内部过程游标", async () => {
    const tool: AgentItem = { id: "reason", type: "reasoning", summary: "分析", content: "过程" };
    const attachment = {
      id: "file",
      kind: "image",
      name: "图片.png",
      mediaType: "image/png",
      size: 12,
    } as const;
    const source = page([
      {
        ...turn("t", [tool, { ...message("u"), attachments: [attachment] } as AgentItem]),
        processCursor: "private-cursor",
      },
    ]);
    const result = await createConversationExport(
      { readTask: vi.fn().mockResolvedValue(source) },
      task,
    );
    expect((JSON.parse(result.content) as ConversationRecord).turns[0]?.items).toEqual(
      source.snapshot.turns[0]?.items,
    );
    expect(result.content).not.toContain("private-cursor");
    const empty = await createConversationExport(
      { readTask: vi.fn().mockResolvedValue(page([])) },
      task,
    );
    expect((JSON.parse(empty.content) as ConversationRecord).turns).toEqual([]);
  });

  it("检测循环游标，后续读取失败时不返回半份导出", async () => {
    const readTask = vi.fn().mockResolvedValue(page([turn("t", [])], "loop"));
    await expect(createConversationExport({ readTask }, task)).rejects.toThrow(/cursor/iu);
    expect(readTask).toHaveBeenCalledTimes(2);
    readTask
      .mockReset()
      .mockResolvedValueOnce(page([], "next"))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(createConversationExport({ readTask }, task)).rejects.toThrow("offline");
  });

  it("拒绝其他任务或项目的分页响应", async () => {
    const source = page([]);
    await expect(
      createConversationExport(
        {
          readTask: vi.fn().mockResolvedValue({
            ...source,
            snapshot: { ...source.snapshot, projectId: "foreign" },
          }),
        },
        task,
      ),
    ).rejects.toThrow(/identity/iu);
  });
});
