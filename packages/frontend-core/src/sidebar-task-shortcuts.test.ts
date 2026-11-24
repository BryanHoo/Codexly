import { describe, expect, it } from "vitest";
import {
  getSidebarActiveTasks,
  getSidebarShortcutLayout,
  readSidebarShortcutExpanded,
  writeSidebarShortcutExpanded,
} from "./sidebar-task-shortcuts.js";

describe("sidebar task shortcuts", () => {
  it.each(["running", "approval"] as const)(
    "preserves known and unknown engines for %s shortcuts",
    (status) => {
      const activity = new Map(
        (["claude", "codex", undefined] as const).map((engine, index) => [
          String(index),
          {
            engine,
            taskId: String(index),
            projectId: "a",
            isRunning: status === "running",
            attention: null,
            pendingApprovalRequestIds: new Set(status === "approval" ? ["request"] : []),
          },
        ]),
      );
      const result = getSidebarActiveTasks(activity, new Set(["a"]));
      expect(result.tasks.map((task) => task.engine)).toEqual(["claude", "codex", undefined]);
      expect(result.tasks.map((task) => task.status)).toEqual([status, status, status]);
    },
  );

  it("keeps completed and failed tasks out of both the shortcut list and its counts", () => {
    const activity = new Map(
      (["running", "completed", "failed"] as const).map((status) => [
        status,
        {
          taskId: status,
          projectId: "a",
          isRunning: status === "running",
          attention: status === "running" ? null : status,
          pendingApprovalRequestIds: new Set<string>(),
        },
      ]),
    );
    expect(getSidebarActiveTasks(activity, new Set(["a"]))).toEqual({
      tasks: [{ id: "running", projectId: "a", title: "running", status: "running" }],
      runningCount: 1,
      approvalCount: 0,
    });
  });

  it("includes unloaded tasks and paused approvals, keeps stable order and separates counts", () => {
    const record = (taskId: string, projectId: string, isRunning = true, approval = false) => ({
      taskId,
      projectId,
      taskName: `任务 ${taskId}`,
      isRunning,
      attention: null,
      pendingApprovalRequestIds: new Set(approval ? ["request"] : []),
    });
    const activity = new Map([
      ["a", record("same", "a")],
      ["b", record("same", "b")],
      ["waiting", record("waiting", "a", false, true)],
      ["finished", record("finished", "a", false)],
      ["removed", record("removed", "removed")],
    ]);
    const result = getSidebarActiveTasks(activity, new Set(["a", "b"]));
    expect(result.tasks.map((task) => [task.projectId, task.id])).toEqual([
      ["a", "waiting"],
      ["a", "same"],
      ["b", "same"],
    ]);
    expect(result).toMatchObject({ runningCount: 2, approvalCount: 1 });
    expect(result.tasks[0]).toMatchObject({ title: "任务 waiting", status: "approval" });
  });

  it("previews two per group and keeps the combined height within one third and 240px", () => {
    const large = getSidebarShortcutLayout(900, 5, 6, true, true);
    expect(large).toMatchObject({ pinnedLimit: 2, activeLimit: 2, height: 240 });
    for (const availableHeight of [360, 480, 600, 720, 900]) {
      const layout = getSidebarShortcutLayout(availableHeight, 5, 6, true, true);
      expect(layout.height).toBeLessThanOrEqual(Math.min(240, availableHeight / 3));
    }
    expect(getSidebarShortcutLayout(360, 5, 6, true, true)).toMatchObject({
      pinnedLimit: 0,
      activeLimit: 1,
    });
  });

  it("respects manual collapse and removes empty groups from the height budget", () => {
    expect(getSidebarShortcutLayout(900, 5, 6, false, false)).toMatchObject({
      pinnedLimit: 0,
      activeLimit: 0,
      height: 64,
    });
    expect(getSidebarShortcutLayout(900, 0, 1, true, true)).toMatchObject({
      pinnedLimit: 0,
      activeLimit: 1,
      height: 60,
    });
    expect(getSidebarShortcutLayout(900, 0, 0, true, true).height).toBe(0);
  });

  it("persists collapse safely and falls back when storage is unavailable or malformed", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(readSidebarShortcutExpanded(storage)).toEqual({ pinned: true, active: true });
    writeSidebarShortcutExpanded(storage, { pinned: false, active: true });
    expect(readSidebarShortcutExpanded(storage)).toEqual({ pinned: false, active: true });
    for (const key of values.keys()) storage.setItem(key, "invalid");
    expect(readSidebarShortcutExpanded(storage)).toEqual({ pinned: true, active: true });
    expect(() => {
      writeSidebarShortcutExpanded(
        {
          ...storage,
          setItem: () => {
            throw Error("disabled");
          },
        },
        { pinned: false, active: false },
      );
    }).not.toThrow();
  });
});
