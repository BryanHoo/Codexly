import { it, expect, vi } from "vitest";
import type { LocalTask, LocalCatalogStore, CatalogOperations } from "@codexly/core";
import { AcpTaskManagement } from "./task-management.js";
it("本地归档、重命名和置顶不启动 agent，删除须先确认原生成功", async () => {
  let task: LocalTask | null = {
    id: "task",
    provider: "codex",
    projectId: "project",
    sessionId: "native",
    cwd: "/workspace",
    title: "旧",
    updatedAt: 1,
    status: "idle",
    archived: false,
    pinned: false,
  };
  const store: LocalCatalogStore = {
    catalog: <K extends keyof CatalogOperations>(op: K, payload: CatalogOperations[K][0]) => {
      if (op === "task.read") return Promise.resolve(task as CatalogOperations[K][1]);
      if (op === "task.patch") {
        if (!task) throw new Error("任务不存在");
        task = { ...task, ...(payload as Partial<LocalTask>) };
        return Promise.resolve(task as CatalogOperations[K][1]);
      }
      if (op === "task.remove") {
        task = null;
        return Promise.resolve(true as CatalogOperations[K][1]);
      }
      throw new Error(op);
    },
  };
  const native = vi.fn(() => Promise.resolve());
  const clear = vi.fn(() => Promise.resolve());
  let busy = false;
  const management = new AcpTaskManagement(
    "codex",
    "project",
    store,
    () => busy,
    native,
    clear,
    () => undefined,
  );
  await management.renameTask("task", "新标题");
  expect((await management.pinTask("task", true)).pinned).toBe(true);
  await management.archiveTask("task");
  expect(task.archived).toBe(true);
  expect(native).not.toHaveBeenCalled();
  await management.unarchiveTask("task");
  busy = true;
  await expect(management.deleteTask("task")).rejects.toThrow("运行");
  busy = false;
  native.mockRejectedValueOnce(new Error("断线"));
  await expect(management.deleteTask("task")).rejects.toThrow("断线");
  expect(task).not.toBeNull();
  expect(clear).not.toHaveBeenCalled();
  await management.deleteTask("task");
  expect(task).toBeNull();
  expect(clear).toHaveBeenCalledWith("task");
});
