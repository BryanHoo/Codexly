import { assert, expect, it } from "vitest";
import { FakeRpcClient } from "./agent-provider.test-support.js";
import { searchLegacyOccurrences } from "./legacy-search-occurrences.js";

const page = {
  backwardsCursor: "inclusive",
  nextCursor: "older",
  data: [
    {
      id: "turn",
      items: [
        {
          id: "user",
          type: "userMessage",
          content: [{ type: "text", text: "😀中文 ".repeat(31) }],
        },
      ],
    },
  ],
};

it("一页内超过三十个命中时准确续查，不重复或遗漏", async () => {
  const client = new FakeRpcClient([page, page]);
  const first = await searchLegacyOccurrences(client, "task", "中文", undefined, 30);
  expect(first.data).toHaveLength(30);
  expect(first.nextCursor).not.toBeNull();
  assert(first.nextCursor !== null);
  const second = await searchLegacyOccurrences(client, "task", "中文", first.nextCursor, 30);
  expect(second.data).toHaveLength(1);
  assert(second.nextCursor !== null);
  expect(JSON.parse(second.nextCursor.slice("codexly-search-v1:".length))).toMatchObject({
    turnCursor: "older",
    offset: 0,
  });
  expect(client.calls[1]?.params).toMatchObject({ cursor: "inclusive" });
});

it("续查游标不能跨任务或查询复用", async () => {
  const client = new FakeRpcClient([page]);
  const first = await searchLegacyOccurrences(client, "task", "中文", undefined, 1);
  assert(first.nextCursor !== null);
  for (const [task, query] of [
    ["foreign", "中文"],
    ["task", "其他"],
  ] as const) {
    await expect(
      searchLegacyOccurrences(client, task, query, first.nextCursor, 30),
    ).rejects.toThrow("cursor is invalid");
  }
  expect(client.calls).toHaveLength(1);
});

it("跳过未命中页时仍响应取消，不派发后续分页请求", async () => {
  const controller = new AbortController();
  const client = new FakeRpcClient([
    () => {
      controller.abort();
      return { data: [], backwardsCursor: null, nextCursor: "older" };
    },
  ]);
  await expect(
    searchLegacyOccurrences(client, "task", "中文", undefined, 30, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(client.calls).toHaveLength(1);
});

it("服务端循环游标立即报错，不无限追读", async () => {
  const client = new FakeRpcClient([
    { data: [], backwardsCursor: null, nextCursor: "older" },
    { data: [], backwardsCursor: null, nextCursor: "older" },
  ]);
  await expect(searchLegacyOccurrences(client, "task", "中文", undefined, 30)).rejects.toThrow(
    "repeated cursor",
  );
  expect(client.calls).toHaveLength(2);
});

it("Unicode 大小写扩展仍返回正确 UTF-16 摘要范围", async () => {
  const client = new FakeRpcClient([
    {
      ...page,
      nextCursor: null,
      data: [
        {
          id: "turn",
          items: [{ id: "agent", type: "agentMessage", phase: "final_answer", text: "😀İ中文" }],
        },
      ],
    },
  ]);
  const result = await searchLegacyOccurrences(client, "task", "i", undefined, 30);
  expect(result.data[0]).toMatchObject({
    snippet: "😀İ中文",
    snippetMatchRange: { start: 2, end: 3 },
  });
});
