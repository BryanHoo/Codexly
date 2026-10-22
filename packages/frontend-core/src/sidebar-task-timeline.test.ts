import {
  readSidebarTaskView,
  writeSidebarTaskView,
  readSidebarTimelineCollapsedGroups,
  writeSidebarTimelineCollapsedGroups,
} from "./sidebar-task-view.js";
import { describe, expect, it } from "vitest";
import { buildSidebarTimelineRows } from "./sidebar-task-timeline.js";

const now = new Date(2026, 9, 22, 12);
const task = (id: string, day: number, hour = 12, projectId = "a") => ({
  id,
  projectId,
  updatedAt: new Date(2026, 9, day, hour).toISOString(),
});

describe("侧栏任务时间线", () => {
  it("默认仅收起更早分组，持久化全部展开选择，损坏或不可写时仍可操作", () => {
    let saved: string | null = null;
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    expect([...readSidebarTimelineCollapsedGroups(storage)]).toEqual(["earlier"]);
    writeSidebarTimelineCollapsedGroups(storage, new Set());
    expect(readSidebarTimelineCollapsedGroups(storage).size).toBe(0);
    writeSidebarTimelineCollapsedGroups(storage, new Set(["today", "earlier"]));
    expect([...readSidebarTimelineCollapsedGroups(storage)]).toEqual(["today", "earlier"]);
    saved = '{"version":1,"collapsedGroups":["unknown"]}';
    expect([...readSidebarTimelineCollapsedGroups(storage)]).toEqual(["earlier"]);
    expect([...readSidebarTimelineCollapsedGroups(undefined)]).toEqual(["earlier"]);
    expect(() => {
      writeSidebarTimelineCollapsedGroups(
        {
          ...storage,
          setItem: () => {
            throw Error("disabled");
          },
        },
        new Set(),
      );
    }).not.toThrow();
  });

  it("按本地自然日分组，近七天包括今天及之前六天，并按更新时间降序排列", () => {
    const tasks = [
      task("old", 15),
      task("week", 16),
      task("yesterday", 21),
      task("today", 22, 0),
      task("latest", 22, 11),
    ];
    const original = [...tasks];
    const rows = buildSidebarTimelineRows([tasks], now);
    expect(rows.map((row) => (row.kind === "heading" ? row.group : row.task.id))).toEqual([
      "today",
      "latest",
      "today",
      "yesterday",
      "yesterday",
      "week",
      "week",
      "earlier",
      "old",
    ]);
    expect(tasks).toEqual(original);
  });

  it("跨项目去重且保留最新版本，相同时间以稳定身份排序，无效日期放到更早", () => {
    const latest = task("same", 22);
    const rows = buildSidebarTimelineRows(
      [
        [task("same", 21), { ...task("bad", 20), updatedAt: "invalid" }],
        [task("same", 22, 12, "b"), latest, task("same", 22, 12, "a")],
      ],
      now,
    );
    expect(
      rows.filter((row) => row.kind === "task").map((row) => [row.task.projectId, row.task.id]),
    ).toEqual([
      ["a", "same"],
      ["b", "same"],
      ["a", "bad"],
    ]);
    expect(rows.filter((row) => row.kind === "heading").map((row) => row.group)).toEqual([
      "today",
      "earlier",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("跨午夜重新分组，夏令时使用日历边界，空目录不产生标题", () => {
    expect(buildSidebarTimelineRows([], now)).toEqual([]);
    const rows = buildSidebarTimelineRows([[task("midnight", 22, 0)]], new Date(2026, 9, 23, 0));
    expect(rows[0]).toMatchObject({ kind: "heading", group: "yesterday", count: 1 });
    const dstNow = new Date(2026, 2, 9, 0);
    const dstTask = { id: "dst", projectId: "a", updatedAt: new Date(2026, 2, 8, 0).toISOString() };
    expect(buildSidebarTimelineRows([[dstTask]], dstNow)[0]).toMatchObject({ group: "yesterday" });
  });

  it("安全持久化视图偏好，损坏或不可用时回退项目视图", () => {
    let saved: string | null = null;
    const storage = {
      getItem: () => saved,
      setItem: (_: string, value: string) => {
        saved = value;
      },
    };
    expect(readSidebarTaskView(storage)).toBe("projects");
    writeSidebarTaskView(storage, "timeline");
    expect(readSidebarTaskView(storage)).toBe("timeline");
    saved = '{"version":2,"view":"timeline"}';
    expect(readSidebarTaskView(storage)).toBe("projects");
    saved = "broken";
    expect(readSidebarTaskView(storage)).toBe("projects");
    expect(readSidebarTaskView(undefined)).toBe("projects");
    expect(() => {
      writeSidebarTaskView(
        {
          ...storage,
          setItem: () => {
            throw Error("disabled");
          },
        },
        "timeline",
      );
    }).not.toThrow();
  });
});
