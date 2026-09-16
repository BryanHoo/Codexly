import { describe, expect, it } from "vitest";

import { FakeRpcClient } from "./agent-provider.test-support.js";
import { CodexGlobalSearchService } from "./global-search.js";
import { decodeTaskTurnCursor } from "./task-history-pagination.js";

const temporaryThread = {
  id: "task-1",
  model: null,
  name: "搜索任务",
  preview: "",
  projectId: null,
  reasoningEffort: null,
  section: null,
  updatedAt: 1_757_894_400,
};

const occurrence = {
  itemId: "item-1",
  snippet: "包含中文关键词的历史消息",
  snippetMatchRange: { end: 6, start: 2 },
  turnCursor: "inclusive-cursor",
  turnId: "turn-1",
};

function decodeReturnedTurnCursor(value: string | undefined): string | undefined {
  expect(value).toBeTypeOf("string");
  if (value === undefined) throw new Error("Search occurrence turn cursor is missing");
  return decodeTaskTurnCursor({ cursor: value }).turnCursor;
}

describe("CodexGlobalSearchService", () => {
  it("搜索任务标题并过滤未注册项目", async () => {
    const foreignThread = { ...temporaryThread, id: "foreign", projectId: "foreign-project" };
    const client = new FakeRpcClient([
      { data: [temporaryThread, foreignThread], nextCursor: "page-2" },
    ]);
    const service = new CodexGlobalSearchService(client);

    await expect(
      service.searchTasks({ archived: true, cursor: "page-1", kind: "tasks", query: " 搜索 " }, [
        { id: "temporary", kind: "temporary" },
      ]),
    ).resolves.toMatchObject({
      data: [{ snippet: "", task: { id: "task-1", projectId: "temporary", title: "搜索任务" } }],
      nextCursor: "page-2",
    });
    expect(client.calls).toEqual([
      {
        method: "thread/list",
        params: {
          archived: true,
          cursor: "page-1",
          limit: 30,
          modelProviders: [],
          searchTerm: "搜索",
          sortDirection: "desc",
          sortKey: "recency_at",
        },
      },
    ]);
  });

  it("仅返回存在可见消息锚点的历史结果", async () => {
    const client = new FakeRpcClient([
      {
        data: [{ snippet: "过程输出", thread: temporaryThread }],
        nextCursor: null,
      },
      { data: [occurrence], nextCursor: null },
    ]);
    const service = new CodexGlobalSearchService(client);

    const page = await service.searchTasks({ archived: false, kind: "history", query: "中文" }, [
      { id: "temporary", kind: "temporary" },
    ]);

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.snippet).toBe(occurrence.snippet);
    expect(page.data[0]?.task.id).toBe("task-1");
    expect(page.data[0]?.occurrence).toMatchObject({
      itemId: occurrence.itemId,
      snippet: occurrence.snippet,
      snippetMatchRange: occurrence.snippetMatchRange,
      turnId: occurrence.turnId,
    });
    expect(decodeReturnedTurnCursor(page.data[0]?.occurrence?.turnCursor)).toBe(
      occurrence.turnCursor,
    );
    expect(client.calls.at(-1)).toEqual({
      method: "thread/searchOccurrences",
      params: { limit: 1, searchTerm: "中文", threadId: "task-1" },
    });
  });

  it("读取匹配位置前验证任务归属", async () => {
    const client = new FakeRpcClient([
      { thread: { ...temporaryThread, projectId: "project-1" } },
      { data: [occurrence], nextCursor: null },
    ]);
    const service = new CodexGlobalSearchService(client);

    const page = await service.searchTaskOccurrences(
      "task-1",
      { cursor: "page-2", query: "中文" },
      { id: "project-1", kind: "project" },
    );

    expect(page.nextCursor).toBeNull();
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      itemId: occurrence.itemId,
      snippet: occurrence.snippet,
      snippetMatchRange: occurrence.snippetMatchRange,
      turnId: occurrence.turnId,
    });
    expect(decodeReturnedTurnCursor(page.data[0]?.turnCursor)).toBe(occurrence.turnCursor);
    expect(client.calls).toEqual([
      {
        method: "thread/read",
        params: { includeTurns: false, threadId: "task-1" },
      },
      {
        method: "thread/searchOccurrences",
        params: {
          cursor: "page-2",
          limit: 30,
          searchTerm: "中文",
          threadId: "task-1",
        },
      },
    ]);
  });
});
