import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { cacheCreatedProjectTask, listProjectTasksForTimeline, refreshStartedProjectTask, replaceProjectTaskInQueryCaches, removeArchivedProjectTaskAndRefill } from "./project-query-cache.js";

const task = { id: "one", projectId: "a", title: "原任务", pinned: false, updatedAt: "2026-10-21T12:00:00Z" };
const key = ["projects", "a", "tasks", "search-source"];

describe("桌面时间线缓存与既有任务操作同步", () => {
  it("新建与重命名更新完整目录，其他项目保持独立", async () => {
    const client = new QueryClient();
    client.setQueryData(key, [task]);
    const created = { ...task, id: "new", updatedAt: "2026-10-22T12:00:00Z" };
    await cacheCreatedProjectTask(client, created);
    expect(client.getQueryData(key)).toEqual([created, task]);
    replaceProjectTaskInQueryCaches(client, { ...created, title: "重命名", pinned: true });
    expect(client.getQueryData(key)).toEqual([{ ...created, title: "重命名", pinned: true }, task]);
    expect(client.getQueryData(["projects", "b", "tasks", "search-source"])).toBeUndefined();
    client.clear();
  });

  it("启动回合刷新更新时间，归档移除任务，不创建不完整的目录", async () => {
    const client = new QueryClient();
    client.setQueryData(key, [task]);
    client.setQueryData(["projects", "a", "tasks"], { pages: [{ data: [task], nextCursor: null }], pageParams: [undefined] });
    await refreshStartedProjectTask(client, "a", "one", "2026-10-22T13:00:00Z");
    expect(client.getQueryData(key)).toEqual([{ ...task, updatedAt: "2026-10-22T13:00:00Z" }]);
    await removeArchivedProjectTaskAndRefill(client, "a", "one");
    expect(client.getQueryData(key)).toEqual([]);
    client.removeQueries({ queryKey: key });
    await cacheCreatedProjectTask(client, task);
    expect(client.getQueryData(key)).toBeUndefined();
    client.clear();
  });

  it("新建前发出的旧目录响应不能覆盖已确认的新任务", async () => {
    const client = new QueryClient();
    client.setQueryData(key, [task]);
    let resolveOld!: (tasks: readonly typeof task[]) => void;
    const stale = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<readonly typeof task[]>(resolve => { resolveOld = resolve; }) });
    const created = { ...task, id: "new" };
    await cacheCreatedProjectTask(client, created);
    resolveOld([task]);
    await Promise.allSettled([stale]);
    expect(client.getQueryData(key)).toEqual([created, task]);
    client.clear();
  });

  it("首次目录加载中收到新建结果时重新读取完整目录，不停留在加载态", async () => {
    const client = new QueryClient();
    const created = { ...task, id: "new" };
    const load = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([created, task]);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: load });
    const stop = observer.subscribe(() => {});
    await cacheCreatedProjectTask(client, created);
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual([created, task]));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    client.clear();
  });

  it("原生完整目录追踪分页、去重重叠任务，并保留取消信号", async () => {
    const signal = new AbortController().signal;
    const second = { ...task, id: "second" };
    const listTasks = vi.fn().mockResolvedValueOnce({ data: [task], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [task, second], nextCursor: null });
    expect(await listProjectTasksForTimeline("a", { listTasks }, signal)).toEqual([task, second]);
    expect(listTasks).toHaveBeenNthCalledWith(2, "a", { limit: 100, cursor: "next" }, { signal });
  });
});
