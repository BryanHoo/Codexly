import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  cachePinnedProjectTask,
  cacheRemovedProjectTask,
  updateTaskTitleInProjectListCaches,
} from "./project-query-cache.js";

const task = {
  id: "one",
  projectId: "a",
  title: "已有任务",
  pinned: false,
  updatedAt: "2026-10-21T12:00:00Z",
};
const key = ["projects", "a", "tasks", "search-source"];

describe("Web 时间线目录同步", () => {
  it.each(["pin", "archive"])("旧目录响应不能撤销 %s 操作", async (action) => {
    const client = new QueryClient();
    client.setQueryData(key, [task]);
    let resolveOld!: (tasks: readonly (typeof task)[]) => void;
    const stale = client.fetchQuery({
      queryKey: key,
      queryFn: () =>
        new Promise<readonly (typeof task)[]>((resolve) => {
          resolveOld = resolve;
        }),
    });
    if (action === "pin")
      cachePinnedProjectTask(client, { ...task, pinned: true }, [{ ...task, pinned: true }]);
    else cacheRemovedProjectTask(client, "a", "one", { data: [], nextCursor: null });
    resolveOld([task]);
    await Promise.allSettled([stale]);
    expect(client.getQueryData(key)).toEqual(action === "pin" ? [{ ...task, pinned: true }] : []);
    client.clear();
  });

  it("已有标题的任务也同步快照更新时间，不依赖新聊天标题推导", () => {
    const client = new QueryClient();
    client.setQueryData(key, [task]);
    updateTaskTitleInProjectListCaches(
      client,
      { ...task, updatedAt: "2026-10-22T12:00:00Z", turns: [] },
      {},
    );
    expect(client.getQueryData(key)).toEqual([{ ...task, updatedAt: "2026-10-22T12:00:00Z" }]);
    client.clear();
  });
});
