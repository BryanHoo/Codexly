import { describe, expect, it, vi } from "vitest";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

describe("Tauri native request cancellation", () => {
  it("cancels an in-flight task read through the native request id", async () => {
    const invoke = vi.fn((command: string, _args?: Record<string, unknown>) =>
      command === "read_task" ? new Promise(() => undefined) : Promise.resolve({}),
    );
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const controller = new AbortController();

    const request = client.readTask("project-a", "thread-a", { signal: controller.signal });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("read_task", expect.any(Object)));
    controller.abort();
    const outcome = await Promise.race([
      request.catch((error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve("still-pending"), 20)),
    ]);

    expect(outcome).toMatchObject({ name: "AbortError" });
    const readArgs = invoke.mock.calls.find(([command]) => command === "read_task")?.[1];
    expect(readArgs).toMatchObject({ requestId: expect.any(String) });
    expect(invoke).toHaveBeenCalledWith("cancel_native_request", {
      requestId: readArgs?.requestId,
    });
  });

  it("adds native request ids to cancellable task and directory reads", async () => {
    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) =>
      command === "list_tasks" || command === "list_completed_tasks"
        ? { data: [], nextCursor: null }
        : { data: [], path: null },
    );
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const signal = new AbortController().signal;

    await client.listTasks("project-a", {}, { signal });
    await client.listCompletedTasks({}, { signal });
    await client.listProjectDirectories("/work", { signal });

    for (const [, args] of invoke.mock.calls) {
      expect(args).toMatchObject({ requestId: expect.any(String) });
    }
  });
});
