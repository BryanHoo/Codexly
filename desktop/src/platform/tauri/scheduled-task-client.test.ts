import { describe, expect, it, vi } from "vitest";
import type { ScheduledTaskInput } from "@/protocol/index.js";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

const input: ScheduledTaskInput = {
  enabled: true,
  name: "Daily review",
  projectId: "project-a",
  projectName: "Project A",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
};

describe("scheduled task client", () => {
  it("previews at most five dates without connecting the provider", async () => {
    const invoke = vi.fn(async () => ({ dates: [2_000_000_000_000] }));
    const ensureRuntime = vi.fn();
    const client = new TauriSidebarClient({ invoke: invoke as InvokeImplementation, ensureRuntime });
    expect(await client.previewScheduledTask(input.schedule)).toEqual({ dates: [2_000_000_000_000] });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("preview_scheduled_task", { schedule: input.schedule });
    expect(ensureRuntime).not.toHaveBeenCalled();
  });
  it("maps CRUD and execution commands without starting the interactive runtime", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "list_scheduled_tasks" ? { data: [] } : { task: { id: "schedule-a" } },
    );
    const ensureRuntime = vi.fn(async () => undefined);
    const client = new TauriSidebarClient({
      ensureRuntime,
      invoke: invoke as InvokeImplementation,
    });
    await client.listScheduledTasks();
    await client.createScheduledTask(input);
    await client.updateScheduledTask("schedule-a", input);
    await client.setScheduledTaskEnabled("schedule-a", false);
    await client.runScheduledTaskNow("schedule-a");
    await client.deleteScheduledTask("schedule-a");

    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(invoke.mock.calls).toEqual([
      ["list_scheduled_tasks"],
      ["create_scheduled_task", { input }],
      ["update_scheduled_task", { input, taskId: "schedule-a" }],
      ["set_scheduled_task_enabled", { enabled: false, taskId: "schedule-a" }],
      ["run_scheduled_task_now", { taskId: "schedule-a" }],
      ["delete_scheduled_task", { taskId: "schedule-a" }],
    ]);
  });

  it("preserves a native string rejection as a detailed Error", async () => {
    const invoke = vi.fn(async () =>
      Promise.reject("invalid args `input`: missing field `atUnixMs`"),
    );
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.createScheduledTask(input)).rejects.toEqual(
      expect.objectContaining({
        message: "invalid args `input`: missing field `atUnixMs`",
      }),
    );
  });
});
