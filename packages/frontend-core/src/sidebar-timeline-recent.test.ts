import { describe, expect, it, vi } from "vitest";
import { loadSidebarTimelineRecent } from "./sidebar-timeline-recent.js";

const task = (id: string, updatedAt: string) => ({
  id,
  projectId: "a",
  title: id,
  pinned: false,
  updatedAt,
});
const since = Date.parse("2026-10-16T00:00:00Z");
describe("时间线近期分页", () => {
  it("读到较早任务就停止，不继续请求历史页", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: [task("today", "2026-10-22T00:00:00Z")], nextCursor: "next" })
      .mockResolvedValueOnce({
        data: [task("week", "2026-10-16T00:00:00Z"), task("old", "2026-10-15T23:59:59Z")],
        nextCursor: "old-page",
      });
    const result = await loadSidebarTimelineRecent(load, since);
    expect(result.tasks.map((item) => item.id)).toEqual(["today", "week"]);
    expect(result.hasEarlier).toBe(true);
    expect(result.earlierCount).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("next");
  });
  it("首屏结束时保留较早任务的准确数量，近期分页去重", async () => {
    const recent = task("today", "2026-10-22T00:00:00Z");
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: [recent], nextCursor: "next" })
      .mockResolvedValueOnce({
        data: [recent, task("old", "2026-10-15T00:00:00Z")],
        nextCursor: null,
      });
    expect(await loadSidebarTimelineRecent(load, since)).toEqual({
      tasks: [recent],
      hasEarlier: true,
      earlierCount: 1,
    });
  });
  it("重复游标直接报错，不能将截断结果误报为完整近期任务", async () => {
    const load = vi
      .fn()
      .mockResolvedValue({ data: [task("today", "2026-10-22T00:00:00Z")], nextCursor: "repeat" });
    await expect(loadSidebarTimelineRecent(load, since)).rejects.toThrow("cursor");
  });
});
