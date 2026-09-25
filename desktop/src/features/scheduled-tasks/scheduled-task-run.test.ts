import { describe, expect, it, vi } from "vitest";
import { readScheduledTaskRun } from "./scheduled-task-run.js";

describe("readScheduledTaskRun", () => {
  it.each(["thread not loaded: gone", "thread not found: gone"])("reports an unavailable task before navigation: %s", async (message) => {
    const client = { readTask: vi.fn().mockRejectedValue(new Error(message)), listTasks: vi.fn() };
    expect(await readScheduledTaskRun(client, "project", "gone")).toBeNull();
    expect(client.listTasks).not.toHaveBeenCalled();
  });
  it("rejects an archived task even when its snapshot remains readable", async () => {
    const client = {
      readTask: vi.fn().mockResolvedValue({ snapshot: { id: "archived" } }),
      listTasks: vi.fn().mockImplementation(async (_project, options) => ({
        data: options.pinned ? [{ id: "archived" }] : [], nextCursor: null,
      })),
    };
    expect(await readScheduledTaskRun(client, "temporary", "archived")).toBeNull();
  });
  it("checks later archive pages and returns the fresh snapshot for an available task", async () => {
    const snapshot = { snapshot: { id: "available" } };
    const client = {
      readTask: vi.fn().mockResolvedValue(snapshot),
      listTasks: vi.fn().mockImplementation(async (_project, options) => ({
        data: [], nextCursor: options.cursor || options.pinned ? null : "page-2",
      })),
    };
    expect(await readScheduledTaskRun(client, "project", "available")).toBe(snapshot);
    expect(client.listTasks).toHaveBeenCalledWith("project", { archived: true, limit: 100, cursor: "page-2" });
  });
  it("preserves connection failures instead of claiming the task was deleted", async () => {
    const client = { readTask: vi.fn().mockRejectedValue(new Error("connection failed")), listTasks: vi.fn() };
    await expect(readScheduledTaskRun(client, "project", "task")).rejects.toThrow("connection failed");
  });
});
