import { describe, expect, it, vi } from "vitest";

import { FakeRpcClient } from "./agent-provider.test-support.js";
import { CodexGlobalSearchService } from "./global-search.js";
import { decodeTaskTurnCursor } from "./task-history-pagination.js";
import { createHarness } from "./jsonl-rpc-client.test-support.js";
import { RpcResponseError } from "./jsonl-rpc-errors.js";

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
  it("精确接口不支持时分页检索可见消息并保留定位与续页游标", async () => {
    const client = new FakeRpcClient([
      { data: [{ thread: temporaryThread }], nextCursor: "tasks-next" },
      new RpcResponseError({
        code: -32601,
        data: null,
        message: "thread/searchOccurrences is not supported yet",
      }),
      {
        data: [
          {
            id: "turn-empty",
            items: [{ id: "tool", type: "commandExecution", aggregatedOutput: "中文" }],
          },
        ],
        backwardsCursor: "empty-anchor",
        nextCursor: "older",
      },
      {
        data: [
          {
            id: "turn-hit",
            items: [
              { id: "commentary", type: "agentMessage", phase: "commentary", text: "中文" },
              {
                id: "user-hit",
                type: "userMessage",
                content: [{ type: "text", text: "😀中文 中文" }],
              },
            ],
          },
        ],
        backwardsCursor: "hit-anchor",
        nextCursor: null,
      },
    ]);
    const service = new CodexGlobalSearchService(client);
    const page = await service.searchTasks({ archived: false, kind: "history", query: "中文" }, [
      { id: "temporary", kind: "temporary" },
    ]);
    expect(page.nextCursor).toBe("tasks-next");
    expect(page.data[0]?.occurrence).toMatchObject({
      itemId: "user-hit",
      turnId: "turn-hit",
      snippet: "😀中文 中文",
      snippetMatchRange: { start: 2, end: 4 },
    });
    expect(decodeReturnedTurnCursor(page.data[0]?.occurrence?.turnCursor)).toBe("hit-anchor");
    expect(
      client.calls.filter((call) => call.method === "thread/turns/list").map((call) => call.params),
    ).toEqual([
      { threadId: "task-1", itemsView: "full", limit: 10, sortDirection: "desc" },
      { threadId: "task-1", itemsView: "full", limit: 10, sortDirection: "desc", cursor: "older" },
    ]);
  });

  it("权限或其他 RPC 错误不进入兼容检索", async () => {
    const error = new RpcResponseError({ code: -32602, data: null, message: "invalid thread" });
    const client = new FakeRpcClient([{ thread: temporaryThread }, error]);
    await expect(
      new CodexGlobalSearchService(client).searchTaskOccurrences(
        "task-1",
        { query: "中文" },
        { id: "temporary", kind: "temporary" },
      ),
    ).rejects.toBe(error);
    expect(client.calls.map((call) => call.method)).toEqual([
      "thread/read",
      "thread/searchOccurrences",
    ]);
  });
  it.each(["tasks", "history"] as const)("取消的 %s 搜索不派发 RPC", async (kind) => {
    const client = new FakeRpcClient([{ data: [], nextCursor: null }]);
    const controller = new AbortController();
    controller.abort();
    const service = new CodexGlobalSearchService(client);

    await expect(
      service.searchTasks({ archived: false, kind, query: "中文" }, [], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.calls).toHaveLength(0);
  });

  it("取消首批历史锚点查询后立即结束等待且不派发剩余查询", async () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const controller = new AbortController();
    const service = new CodexGlobalSearchService(client);
    const search = service.searchTasks(
      { archived: false, kind: "history", query: "中文" },
      [{ id: "temporary", kind: "temporary" }],
      controller.signal,
    );
    const outcome = expect(search).rejects.toMatchObject({ name: "AbortError" });
    try {
      serverOutput.write(
        `${JSON.stringify({
          id: 1,
          result: {
            data: Array.from({ length: 10 }, (_, index) => ({
              thread: { ...temporaryThread, id: `task-${String(index)}` },
            })),
            nextCursor: null,
          },
        })}\n`,
      );
      // 首批四个锚点全部在途时取消，证明不必等响应或超时才能释放搜索。
      await vi.waitFor(() => {
        expect(sentMessages).toHaveLength(5);
      });
      controller.abort();
      await outcome;
      for (let id = 2; id <= 5; id += 1) {
        serverOutput.write(
          `${JSON.stringify({ id, result: { data: [occurrence], nextCursor: null } })}\n`,
        );
      }
      await Promise.resolve();
      expect(sentMessages).toHaveLength(5);
      expect(client.closed).toBe(false);
    } finally {
      client.close();
    }
  });

  it("验证归属期间取消匹配位置搜索后不再查询锚点", async () => {
    const controller = new AbortController();
    const client = new FakeRpcClient([
      () => {
        controller.abort();
        return { thread: temporaryThread };
      },
      { data: [occurrence], nextCursor: null },
    ]);
    const service = new CodexGlobalSearchService(client);
    await expect(
      service.searchTaskOccurrences(
        "task-1",
        { query: "中文" },
        { id: "temporary", kind: "temporary" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(client.calls.map((call) => call.method)).toEqual(["thread/read"]);
  });

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

  it("分批验证历史锚点并保留下一页游标", async () => {
    const threads = Array.from({ length: 11 }, (_, index) => ({
      snippet: "过程输出",
      thread: { ...temporaryThread, id: `task-${String(index)}` },
    }));
    const client = new FakeRpcClient([
      { data: threads, nextCursor: "next-page" },
      ...Array.from({ length: 11 }, (_, index) => ({
        data: index === 0 ? [] : [occurrence],
        nextCursor: null,
      })),
    ]);
    const service = new CodexGlobalSearchService(client);

    const page = await service.searchTasks({ archived: false, kind: "history", query: "中文" }, [
      { id: "temporary", kind: "temporary" },
    ]);

    expect(client.calls[0]).toMatchObject({ method: "thread/search", params: { limit: 10 } });
    expect(client.calls.filter((call) => call.method === "thread/searchOccurrences")).toHaveLength(
      10,
    );
    expect(page.data).toHaveLength(9);
    expect(page.data.every((item) => item.occurrence !== undefined)).toBe(true);
    expect(page.nextCursor).toBe("next-page");
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
