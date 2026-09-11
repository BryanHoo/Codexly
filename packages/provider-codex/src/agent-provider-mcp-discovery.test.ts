import { describe, expect, it, vi } from "vitest";

import { listCodexMcpServers } from "./agent-provider-mcp.js";

function createClient(toolsError: unknown, runtimeStatus = "connected") {
  return {
    request: vi.fn().mockResolvedValue({
      data: [
        {
          name: "search",
          pluginId: null,
          serverInfo: null,
          authStatus: "unsupported",
          runtimeStatus,
          tools: {},
          toolsError,
        },
      ],
      nextCursor: null,
    }),
  };
}

describe("Codex 0.154 MCP 工具发现", () => {
  it("将工具发现失败显示为失败，且不转发原始错误或追加请求", async () => {
    const client = createClient("Bearer secret-token https://private.example.com");
    await expect(listCodexMcpServers(client, "task-1")).resolves.toEqual({
      data: [{ displayName: "search", name: "search", status: "failed", toolCount: 0 }],
    });
    expect(client.request).toHaveBeenCalledExactlyOnceWith("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
      threadId: "task-1",
    });
  });

  it("保留有效空目录的连接状态", async () => {
    await expect(listCodexMcpServers(createClient(null), "task-1")).resolves.toMatchObject({
      data: [{ status: "connected", toolCount: 0 }],
    });
  });

  it.each(["authenticationRequired", "disabled", "cancelled", "starting"])(
    "工具错误不覆盖更具体的运行状态 %s",
    async (status) => {
      await expect(
        listCodexMcpServers(createClient("discovery failed", status), "task-1"),
      ).resolves.toMatchObject({ data: [{ status }] });
    },
  );

  it.each([undefined, 42, {}, false])("拒绝非法 toolsError %s", async (value) => {
    await expect(listCodexMcpServers(createClient(value), "task-1")).rejects.toThrow(
      "mcpServerStatus/list toolsError is invalid",
    );
  });
});
