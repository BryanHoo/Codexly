import { expect, it, vi } from "vitest";
import { TauriSidebarClient } from "./sidebar-client.js";
import type { InvokeImplementation } from "./native-client.js";

class AcpClient extends TauriSidebarClient {
  protected override applicationRuntime(): Promise<"acp"> {
    return Promise.resolve("acp");
  }
}

it("ACP 搜索和附件打开显式选择共享宿主，不初始化旧模型进程", async () => {
  const invoke = vi.fn(async (command: string) =>
    command === "open_task_attachment"
      ? { attachmentId: "a", status: "opened" }
      : { data: [], nextCursor: null },
  );
  const ensureRuntime = vi.fn(async () => undefined);
  const client = new AcpClient({ invoke: invoke as InvokeImplementation, ensureRuntime });
  await client.searchTasks({ query: "中文", archived: false });
  await client.searchTaskOccurrences("t", "中文", "cursor");
  await client.openTaskAttachment("p", "t", "a");
  expect(invoke).toHaveBeenCalledWith("search_tasks", {
    input: { query: "中文", archived: false },
    agentRuntime: "acp",
  });
  expect(invoke).toHaveBeenCalledWith("search_task_occurrences", {
    taskId: "t",
    query: "中文",
    cursor: "cursor",
    agentRuntime: "acp",
  });
  expect(invoke).toHaveBeenCalledWith("open_task_attachment", {
    projectId: "p",
    taskId: "t",
    attachmentId: "a",
    agentRuntime: "acp",
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
});
