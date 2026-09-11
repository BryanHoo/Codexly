import { CodexlyHttpError } from "@codexly/client";
import { describe, expect, it, vi } from "vitest";
import { readScheduledTaskRun } from "./scheduled-task-run.js";

describe("scheduled run navigation", () => {
  it("handles deleted tasks without navigation", async () => {
    const client = {
      readTask: vi.fn().mockRejectedValue(new CodexlyHttpError(404, "Not Found")),
      listTasks: vi.fn(),
    };
    expect(await readScheduledTaskRun(client, "project", "gone")).toBeNull();
  });
  it("checks later pinned archive pages even with a readable snapshot", async () => {
    const client = {
      readTask: vi.fn().mockResolvedValue({ snapshot: {} }),
      listTasks: vi
        .fn()
        .mockResolvedValueOnce({ data: [], nextCursor: null })
        .mockResolvedValueOnce({ data: [], nextCursor: "next" })
        .mockResolvedValueOnce({ data: [{ id: "archived" }], nextCursor: null }),
    };
    expect(await readScheduledTaskRun(client, "project", "archived")).toBeNull();
    expect(client.listTasks).toHaveBeenLastCalledWith("project", {
      archived: true,
      pinned: true,
      limit: 100,
      cursor: "next",
    });
  });
  it("returns the fresh snapshot and preserves network errors", async () => {
    const response = { snapshot: {} };
    const client = {
      readTask: vi.fn().mockResolvedValue(response),
      listTasks: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    };
    expect(await readScheduledTaskRun(client, "project", "available")).toBe(response);
    client.readTask.mockRejectedValue(new Error("connection failed"));
    await expect(readScheduledTaskRun(client, "project", "available")).rejects.toThrow(
      "connection failed",
    );
  });
});
