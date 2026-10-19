import { expect, it, vi } from "vitest";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

it.each(["refresh", "reconnect", "reload"] as const)(
  "transports the explicit MCP %s action over desktop IPC",
  async (action) => {
    const invoke = vi.fn(async () => ({ data: [], statusSource: "cached", observedAt: null }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    expect(await client.retryMcpServers("project-a", "thread-a", { action })).toMatchObject({
      statusSource: "cached",
      observedAt: null,
    });
    expect(invoke).toHaveBeenCalledWith("retry_mcp_servers", {
      projectId: "project-a",
      taskId: "thread-a",
      action,
    });
  },
);
