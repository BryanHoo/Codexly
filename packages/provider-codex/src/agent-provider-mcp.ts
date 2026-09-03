import type { AgentMcpServerConnectionStatus, AgentMcpServerPage } from "@codexly/protocol";

import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

type CodexMcpRpcClient = Readonly<{
  request(method: string, params?: unknown): Promise<unknown>;
}>;

function mapMcpAuthStatus(value: unknown) {
  if (
    value === "unknown" ||
    value === "unsupported" ||
    value === "notLoggedIn" ||
    value === "bearerToken" ||
    value === "oAuth"
  ) {
    return value;
  }
  throw new CodexProtocolMappingError("mcpServerStatus/list authStatus is invalid");
}

function mapMcpRuntimeStatus(
  value: unknown,
  authStatus: ReturnType<typeof mapMcpAuthStatus>,
): AgentMcpServerConnectionStatus {
  switch (value) {
    case "notStarted":
    case "starting":
    case "connected":
    case "authenticationRequired":
    case "failed":
    case "cancelled":
    case "disabled":
      return value;
    case null:
      // 对齐 Codex 0.152 TUI：无运行态但未登录时应明确提示认证。
      return authStatus === "notLoggedIn" ? "authenticationRequired" : "unknown";
    default:
      throw new CodexProtocolMappingError("mcpServerStatus/list runtimeStatus is invalid");
  }
}

export async function listCodexMcpServers(
  client: CodexMcpRpcClient,
  taskId: string,
): Promise<AgentMcpServerPage> {
  const servers = new Map<string, AgentMcpServerPage["data"][number]>();
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const response = expectRecord(
      await client.request("mcpServerStatus/list", {
        ...(cursor === undefined ? {} : { cursor }),
        detail: "toolsAndAuthOnly",
        threadId: taskId,
      }),
      "mcpServerStatus/list response",
    );
    const page = response["data"];
    if (!Array.isArray(page)) {
      throw new CodexProtocolMappingError("mcpServerStatus/list data must be an array");
    }
    // 只输出右栏需要的摘要，完整工具定义、认证信息和资源不得越过 Provider 边界。
    for (const entry of page) {
      const server = expectRecord(entry, "mcpServerStatus/list server");
      const name = expectString(server["name"], "mcpServerStatus/list server name");
      if (name.length === 0) {
        throw new CodexProtocolMappingError("mcpServerStatus/list server name is invalid");
      }
      const pluginId = server["pluginId"];
      if (pluginId !== null && typeof pluginId !== "string") {
        throw new CodexProtocolMappingError("mcpServerStatus/list pluginId is invalid");
      }
      const serverInfoValue = server["serverInfo"];
      const serverInfo =
        serverInfoValue === null || serverInfoValue === undefined
          ? null
          : expectRecord(serverInfoValue, "mcpServerStatus/list serverInfo");
      const tools = expectRecord(server["tools"], "mcpServerStatus/list tools");
      const authStatus = mapMcpAuthStatus(server["authStatus"]);
      let displayName = name;
      if (serverInfo !== null) {
        expectString(serverInfo["name"], "mcpServerStatus/list serverInfo name");
        const title = serverInfo["title"];
        if (title !== null && title !== undefined) {
          const mappedTitle = expectString(title, "mcpServerStatus/list serverInfo title");
          if (mappedTitle.length > 0) displayName = mappedTitle;
        }
      }
      if (servers.has(name)) {
        continue;
      }
      servers.set(name, {
        displayName,
        name,
        status: mapMcpRuntimeStatus(server["runtimeStatus"], authStatus),
        toolCount: Object.keys(tools).length,
      });
    }

    const nextCursor = response["nextCursor"];
    if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
      throw new CodexProtocolMappingError(
        "mcpServerStatus/list nextCursor must be a string or null",
      );
    }
    if (nextCursor === null || nextCursor === undefined) {
      break;
    }
    if (visitedCursors.has(nextCursor)) {
      throw new CodexProtocolMappingError("mcpServerStatus/list returned a repeated cursor");
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    data: [...servers.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function reloadCodexMcpServers(
  client: CodexMcpRpcClient,
  taskId: string,
): Promise<AgentMcpServerPage> {
  expectRecord(await client.request("config/mcpServer/reload"), "config/mcpServer/reload response");
  return listCodexMcpServers(client, taskId);
}
