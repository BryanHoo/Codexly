import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider MCP servers", () => {
  it("lists only MCP servers readable by the current task across all pages", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "unsupported",
            name: "playwright",
            pluginId: null,
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: null,
            tools: { browser_open: { description: "secret detail", inputSchema: {} } },
          },
        ],
        nextCursor: "page-2",
      },
      {
        data: [
          {
            authStatus: "unknown",
            name: "fast-context",
            pluginId: "plugin-fast-context",
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: null,
            tools: {},
          },
          {
            authStatus: "notLoggedIn",
            name: "playwright",
            pluginId: null,
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: null,
            tools: {},
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).resolves.toEqual({
      data: [
        {
          authStatus: "unknown",
          description: null,
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "ready",
          title: null,
          tools: [],
          version: null,
        },
        {
          authStatus: "unsupported",
          description: null,
          error: null,
          failureReason: null,
          name: "playwright",
          status: "ready",
          title: null,
          tools: ["browser_open"],
          version: null,
        },
      ],
    });
    expect(rpc.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: projectRootPath,
          historyMode: "paginated",
          projectId: project.id,
          runtimeWorkspaceRoots: [projectRootPath],
        },
      },
      {
        method: "mcpServerStatus/list",
        params: { detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
      {
        method: "mcpServerStatus/list",
        params: { cursor: "page-2", detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
    ]);
  });

  it("resumes a persisted task before listing its MCP servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await provider.readTask("task-1");
    await expect(provider.listMcpServers("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/goal/get",
      "thread/turns/list",
      "thread/resume",
      "mcpServerStatus/list",
    ]);
  });

  it("resumes a persisted task before reloading its MCP servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread() },
      {},
      { data: [], nextCursor: null },
    ]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);

    await provider.readTask("task-1");
    await expect(provider.reloadMcpServers("task-1")).resolves.toEqual({ data: [] });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/goal/get",
      "thread/turns/list",
      "thread/resume",
      "config/mcpServer/reload",
      "mcpServerStatus/list",
    ]);
  });

  it("merges MCP startup failures, redacts diagnostics, and reloads known task servers", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "oAuth",
            name: "fast-context",
            pluginId: "plugin-fast-context",
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: {
              description: "Semantic repository search at https://internal.example.com/docs",
              icons: null,
              name: "fast-context",
              title: "Fast Context",
              version: "1.2.0",
              websiteUrl: "https://example.com",
            },
            tools: {
              search: { description: "search", inputSchema: {}, name: "search" },
              trace: { description: "trace", inputSchema: {}, name: "trace" },
            },
          },
        ],
        nextCursor: null,
      },
      {},
      {
        data: [
          {
            authStatus: "oAuth",
            name: "fast-context",
            pluginId: "plugin-fast-context",
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: {
              description: "Semantic repository search",
              icons: null,
              name: "fast-context",
              title: "Fast Context",
              version: "1.2.0",
              websiteUrl: "https://example.com",
            },
            tools: {
              search: { description: "search", inputSchema: {}, name: "search" },
              trace: { description: "trace", inputSchema: {}, name: "trace" },
            },
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));

    await provider.startTask();
    provider.receiveNotification("mcpServer/startupStatus/updated", {
      error:
        "OAuth request to https://auth.example.com/callback failed: API_TOKEN=top-secret-value",
      failureReason: "reauthenticationRequired",
      name: "docs",
      status: "failed",
      threadId: "task-1",
    });
    expect(events).toContainEqual({
      payload: {
        error: "OAuth request to [URL redacted] failed: API_TOKEN=[REDACTED]",
        failureReason: "reauthenticationRequired",
        name: "docs",
        status: "failed",
      },
      taskId: "task-1",
      type: "mcp_server.status_updated",
    });

    await expect(provider.listMcpServers("task-1")).resolves.toEqual({
      data: [
        {
          authStatus: null,
          description: null,
          error: "OAuth request to [URL redacted] failed: API_TOKEN=[REDACTED]",
          failureReason: "reauthenticationRequired",
          name: "docs",
          status: "failed",
          title: null,
          tools: [],
          version: null,
        },
        {
          authStatus: "oAuth",
          description: "Semantic repository search at [URL redacted]",
          error: null,
          failureReason: null,
          name: "fast-context",
          status: "ready",
          title: "Fast Context",
          tools: ["search", "trace"],
          version: "1.2.0",
        },
      ],
    });
    await expect(provider.reloadMcpServers("task-1")).resolves.toMatchObject({
      data: [
        { error: null, name: "docs", status: "starting" },
        { error: null, name: "fast-context", status: "starting" },
      ],
    });
    expect(rpc.calls.slice(-2)).toEqual([
      { method: "config/mcpServer/reload", params: undefined },
      {
        method: "mcpServerStatus/list",
        params: { detail: "toolsAndAuthOnly", threadId: "task-1" },
      },
    ]);
  });

  it("restores MCP startup states when the reload RPC fails", async () => {
    const readyServerPage = {
      data: [
        {
          authStatus: "unsupported",
          name: "playwright",
          pluginId: null,
          resourceTemplates: [],
          resources: [],
          runtimeStatus: "connected",
          serverInfo: null,
          tools: {},
        },
      ],
      nextCursor: null,
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      readyServerPage,
      new Error("reload unavailable"),
      readyServerPage,
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await provider.listMcpServers("task-1");
    await expect(provider.reloadMcpServers("task-1")).rejects.toThrow("reload unavailable");
    await expect(provider.listMcpServers("task-1")).resolves.toMatchObject({
      data: [{ name: "playwright", status: "ready" }],
    });
  });

  it("rejects repeated MCP status cursors for a task", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { data: [], nextCursor: "same-page" },
      { data: [], nextCursor: "same-page" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).rejects.toThrow(
      "mcpServerStatus/list returned a repeated cursor",
    );
  });

  it("maps the 0.151.0 MCP runtime connection status", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "notLoggedIn",
            name: "private-docs",
            pluginId: null,
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "authenticationRequired",
            serverInfo: null,
            tools: {},
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).resolves.toMatchObject({
      data: [
        {
          failureReason: "reauthenticationRequired",
          name: "private-docs",
          status: "failed",
        },
      ],
    });
  });

  it("rejects MCP status entries without the 0.151.0 plugin ownership field", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            authStatus: "unsupported",
            name: "incomplete-server",
            resourceTemplates: [],
            resources: [],
            runtimeStatus: "connected",
            serverInfo: null,
            tools: {},
          },
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(provider.listMcpServers("task-1")).rejects.toThrow(
      "mcpServerStatus/list pluginId is invalid",
    );
  });
});
