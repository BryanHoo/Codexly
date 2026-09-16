import { describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";
import { jsonResponse, task } from "./http-client.test-support.js";

describe("CodexlyClient global search", () => {
  it("构建搜索和匹配位置请求并校验响应", async () => {
    const occurrence = {
      itemId: "item-1",
      snippet: "中文历史",
      snippetMatchRange: { end: 2, start: 0 },
      turnCursor: "turn-cursor",
      turnId: "turn-1",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ occurrence, snippet: occurrence.snippet, task }],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [occurrence], nextCursor: "next" }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.searchTasks({ archived: false, kind: "history", query: "中文 历史" });
    await client.searchTaskOccurrences("project one", "task/1", "中文", "page/2");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/search/tasks?archived=false&kind=history&query=%E4%B8%AD%E6%96%87+%E5%8E%86%E5%8F%B2",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%2F1/search-occurrences?cursor=page%2F2&query=%E4%B8%AD%E6%96%87",
    );
  });

  it("拒绝结构错误的搜索响应", async () => {
    const client = new CodexlyClient({
      fetch: vi.fn(() => Promise.resolve(jsonResponse({ data: [] }))),
    });

    await expect(
      client.searchTasks({ archived: false, kind: "tasks", query: "task" }),
    ).rejects.toThrow(/schema/iu);
  });
});
