import type { AgentMcpAuthStatus, AgentMcpServerPage } from "@codexly/protocol";

import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";
import type { TaskRuntimeState } from "./task-runtime-state.js";

const MCP_DISPLAY_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s]+/giu;

type CodexMcpRpcClient = Readonly<{
  request(method: string, params?: unknown): Promise<unknown>;
}>;

function mapMcpAuthStatus(value: unknown): AgentMcpAuthStatus {
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

function optionalNullableString(value: unknown, context: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return expectString(value, context).replace(MCP_DISPLAY_URL_PATTERN, "[URL redacted]");
}

export async function listCodexMcpServers(
  client: CodexMcpRpcClient,
  runtime: TaskRuntimeState,
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
    // 只映射安全展示字段；工具定义、资源与 URL 不得越过 Provider 边界。
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
      if (serverInfo !== null) {
        expectString(serverInfo["name"], "mcpServerStatus/list serverInfo name");
      }
      if (servers.has(name)) {
        continue;
      }
      servers.set(name, {
        authStatus: mapMcpAuthStatus(server["authStatus"]),
        description:
          serverInfo === null
            ? null
            : optionalNullableString(
                serverInfo["description"],
                "mcpServerStatus/list serverInfo description",
              ),
        error: null,
        failureReason: null,
        name,
        status: "ready",
        title:
          serverInfo === null
            ? null
            : optionalNullableString(serverInfo["title"], "mcpServerStatus/list serverInfo title"),
        toolCount: Object.keys(tools).length,
        version:
          serverInfo === null
            ? null
            : optionalNullableString(
                serverInfo["version"],
                "mcpServerStatus/list serverInfo version",
              ),
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

  const startupStatuses = runtime.mcpServerStatuses.get(taskId);
  if (startupStatuses !== undefined) {
    for (const [name, startup] of startupStatuses) {
      const readyServer = servers.get(name);
      if (startup.status === "ready" && readyServer !== undefined) {
        startupStatuses.delete(name);
        continue;
      }
      servers.set(name, {
        authStatus: readyServer?.authStatus ?? null,
        description: readyServer?.description ?? null,
        error: startup.error,
        failureReason: startup.failureReason,
        name,
        status: startup.status,
        title: readyServer?.title ?? null,
        toolCount: readyServer?.toolCount ?? 0,
        version: readyServer?.version ?? null,
      });
    }
  }
  runtime.mcpServerNames.set(taskId, new Set(servers.keys()));
  return {
    data: [...servers.values()].toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function reloadCodexMcpServers(
  client: CodexMcpRpcClient,
  runtime: TaskRuntimeState,
  taskId: string,
): Promise<AgentMcpServerPage> {
  const previousStatuses = runtime.mcpServerStatuses.get(taskId);
  const names = new Set([
    ...(runtime.mcpServerNames.get(taskId) ?? []),
    ...(runtime.mcpServerStatuses.get(taskId)?.keys() ?? []),
  ]);
  // 官方重载是进程级触发；对外仍只返回已验证目标 Task 的重新加载状态。
  runtime.mcpServerStatuses.set(
    taskId,
    new Map(
      [...names].map((name) => [
        name,
        { error: null, failureReason: null, status: "starting" as const },
      ]),
    ),
  );
  try {
    expectRecord(
      await client.request("config/mcpServer/reload"),
      "config/mcpServer/reload response",
    );
  } catch (error) {
    // 重载未被 Codex 接受时恢复原状态，避免后续查询永久停留在 starting。
    if (previousStatuses === undefined) {
      runtime.mcpServerStatuses.delete(taskId);
    } else {
      runtime.mcpServerStatuses.set(taskId, previousStatuses);
    }
    throw error;
  }
  return listCodexMcpServers(client, runtime, taskId);
}
