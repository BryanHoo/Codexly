import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./native-invoke.js", () => ({ invoke }));

import { openTaskWindow, restoreTaskWindow } from "./task-window-client.js";

describe("task window native boundary", () => {
  it("opens the exact task without a caller-provided route", async () => {
    await openTaskWindow("temporary", "task-a");
    expect(invoke).toHaveBeenCalledWith("open_task_window", {
      projectId: "temporary", taskId: "task-a", theme: "system", language: "zh-CN",
    });
    await restoreTaskWindow();
    expect(invoke).toHaveBeenCalledWith("restore_task_window");
  });

});
