import { describe, expect, it } from "vitest";
import type { AgentProviderEvent, PendingRequestResolutionError } from "@codexly/core";
import type { PendingRequest } from "@codexly/protocol";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider server requests", () => {
  it("rejects unsupported server request methods instead of leaving Codex blocked", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    rpc.emitServerRequest("unsupported-request", "item/tool/futureApproval", {
      threadId: "task-1",
    });
    await Promise.resolve();

    expect(rpc.serverErrors).toEqual([
      {
        error: {
          code: -32601,
          data: { method: "item/tool/futureApproval" },
          message: "Method not found",
        },
        id: "unsupported-request",
      },
    ]);
  });

  it("rejects user input questions that have no available answer", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitServerRequest("empty-choice", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      isBlocking: true,
      itemId: "empty-choice-item",
      questions: [
        {
          header: "模式",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [],
          question: "下一步怎么处理？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });
    await Promise.resolve();

    expect(events).toEqual([]);
    expect(rpc.serverErrors).toEqual([
      {
        error: {
          code: -32602,
          data: { method: "item/tool/requestUserInput" },
          message: "Invalid params",
        },
        id: "empty-choice",
      },
    ]);
  });

  it("rejects user input requests without an explicit blocking state", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitServerRequest("missing-blocking", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      itemId: "missing-blocking-item",
      questions: [
        {
          header: "确认",
          id: "confirm",
          isOther: false,
          isSecret: false,
          options: [{ description: "继续", label: "Yes" }],
          question: "继续执行吗？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });
    await Promise.resolve();

    expect(events).toEqual([]);
    expect(rpc.serverErrors).toEqual([
      {
        error: {
          code: -32602,
          data: { method: "item/tool/requestUserInput" },
          message: "Invalid params",
        },
        id: "missing-blocking",
      },
    ]);
  });

  it("maps, restores, and resolves approval server requests", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ status: { type: "active" } }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();

    rpc.emitServerRequest(7, "item/commandExecution/requestApproval", {
      availableDecisions: ["accept", "acceptForSession", "decline"],
      command: "pnpm check",
      cwd: "/workspace/Codexly",
      itemId: "command-1",
      kind: "command",
      networkApprovalContext: { host: "api.example.com", protocol: "https" },
      reason: "需要执行检查",
      startedAtMs: 1_753_228_800_000,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const snapshot = await provider.readTask("task-1");
    const request = snapshot?.pendingRequests[0];
    expect(request).toMatchObject({
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      itemId: "command-1",
      kind: "command",
      networkAccess: { host: "api.example.com", protocol: "https" },
      projectId: "codexly",
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval",
    });
    if (request?.type !== "command_approval") {
      throw new Error("Expected a pending command approval");
    }

    await expect(
      provider.resolvePendingRequest({
        itemId: request.itemId,
        projectId: request.projectId,
        requestId: request.requestId,
        resolution: { decision: "allow_for_session" },
        taskId: request.taskId,
        turnId: request.turnId,
        type: request.type,
      }),
    ).resolves.toMatchObject({ requestId: "number:7", status: "resolved" });
    expect(rpc.serverResponses).toEqual([{ id: 7, result: { decision: "acceptForSession" } }]);
    await expect(
      provider.resolvePendingRequest({
        itemId: request.itemId,
        projectId: request.projectId,
        requestId: request.requestId,
        resolution: { decision: "deny" },
        taskId: request.taskId,
        turnId: request.turnId,
        type: request.type,
      }),
    ).rejects.toMatchObject({ code: "resolved" } satisfies Partial<PendingRequestResolutionError>);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "pending_request.created" });
    expect(events[1]).toMatchObject({
      payload: { request: { status: "resolved" } },
      type: "pending_request.resolved",
    });
  });

  it("maps and resolves MCP form and URL elicitation requests", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: unknown[] = [];
    provider.subscribeEvents((event) => {
      if (event.type === "pending_request.created") requests.push(event.payload.request);
    });
    await provider.listTasks();

    rpc.emitServerRequest("elicitation-form", "mcpServer/elicitation/request", {
      message: "Configure deployment",
      mode: "form",
      requestedSchema: {
        properties: {
          confirmed: {
            default: true,
            description: "Allow deployment",
            title: "Confirm",
            type: "boolean",
          },
          environment: {
            default: "staging",
            oneOf: [
              { const: "staging", title: "Staging" },
              { const: "production", title: "Production" },
            ],
            title: "Environment",
            type: "string",
          },
          replicas: { maximum: 10, minimum: 1, title: "Replicas", type: "integer" },
        },
        required: ["confirmed", "environment"],
        type: "object",
      },
      serverName: "deploy",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitServerRequest("elicitation-url", "mcpServer/elicitation/request", {
      elicitationId: "oauth-1",
      message: "Authorize GitHub",
      mode: "url",
      serverName: "github",
      threadId: "task-1",
      turnId: null,
      url: "https://github.com/login/oauth/authorize",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        fields: [
          expect.objectContaining({ id: "confirmed", required: true, type: "boolean" }),
          expect.objectContaining({ id: "environment", required: true, type: "select" }),
          expect.objectContaining({ id: "replicas", required: false, type: "integer" }),
        ],
        message: "Configure deployment",
        mode: "form",
        serverName: "deploy",
        type: "mcp_elicitation",
      }),
      expect.objectContaining({
        message: "Authorize GitHub",
        mode: "url",
        serverName: "github",
        type: "mcp_elicitation",
        url: "https://github.com/login/oauth/authorize",
      }),
    ]);

    const form = requests[0] as Extract<PendingRequest, { type: "mcp_elicitation" }>;
    await expect(
      provider.resolvePendingRequest({
        itemId: form.itemId,
        projectId: form.projectId,
        requestId: form.requestId,
        resolution: { action: "accept", content: { environment: "invalid", replicas: 2 } },
        taskId: form.taskId,
        turnId: form.turnId,
        type: form.type,
      }),
    ).rejects.toMatchObject({ code: "mismatch" } satisfies Partial<PendingRequestResolutionError>);
    expect(rpc.serverResponses).toEqual([]);
    await provider.resolvePendingRequest({
      itemId: form.itemId,
      projectId: form.projectId,
      requestId: form.requestId,
      resolution: {
        action: "accept",
        content: { confirmed: true, environment: "staging", replicas: 2 },
      },
      taskId: form.taskId,
      turnId: form.turnId,
      type: form.type,
    });
    const url = requests[1] as typeof form;
    await provider.resolvePendingRequest({
      itemId: url.itemId,
      projectId: url.projectId,
      requestId: url.requestId,
      resolution: { action: "accept", content: {} },
      taskId: url.taskId,
      turnId: url.turnId,
      type: url.type,
    });

    expect(rpc.serverResponses).toEqual([
      {
        id: "elicitation-form",
        result: {
          action: "accept",
          content: { confirmed: true, environment: "staging", replicas: 2 },
        },
      },
      { id: "elicitation-url", result: { action: "accept", content: {} } },
    ]);
  });

  it("declines an OpenAI extended MCP form that was not negotiated", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: Extract<PendingRequest, { type: "mcp_elicitation" }>[] = [];
    provider.subscribeEvents((event) => {
      if (
        event.type === "pending_request.created" &&
        event.payload.request.type === "mcp_elicitation"
      ) {
        requests.push(event.payload.request);
      }
    });
    await provider.listTasks();

    rpc.emitServerRequest("openai-form", "mcpServer/elicitation/request", {
      message: "Select a template",
      mode: "openai/form",
      requestedSchema: { component: "custom-template-picker" },
      serverName: "templates",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitServerRequest("openai-form-alias", "mcpServer/elicitation/request", {
      message: "Select another template",
      mode: "openaiForm",
      requestedSchema: { component: "custom-template-picker" },
      serverName: "templates",
      threadId: "task-1",
      turnId: "turn-1",
    });
    expect(requests).toEqual([
      expect.objectContaining({ mode: "unsupported", type: "mcp_elicitation" }),
      expect.objectContaining({ mode: "unsupported", type: "mcp_elicitation" }),
    ]);
    const request = requests[0];
    if (request === undefined) {
      throw new Error("Expected an MCP elicitation request");
    }

    await expect(
      provider.resolvePendingRequest({
        itemId: request.itemId,
        projectId: request.projectId,
        requestId: request.requestId,
        resolution: { action: "accept", content: {} },
        taskId: request.taskId,
        turnId: request.turnId,
        type: request.type,
      }),
    ).rejects.toMatchObject({ code: "mismatch" } satisfies Partial<PendingRequestResolutionError>);
    await provider.resolvePendingRequest({
      itemId: request.itemId,
      projectId: request.projectId,
      requestId: request.requestId,
      resolution: { action: "decline", content: null },
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    });
    const aliasRequest = requests[1];
    if (aliasRequest === undefined) {
      throw new Error("Expected an aliased MCP elicitation request");
    }
    await provider.resolvePendingRequest({
      itemId: aliasRequest.itemId,
      projectId: aliasRequest.projectId,
      requestId: aliasRequest.requestId,
      resolution: { action: "decline", content: null },
      taskId: aliasRequest.taskId,
      turnId: aliasRequest.turnId,
      type: aliasRequest.type,
    });

    expect(rpc.serverErrors).toEqual([]);
    expect(rpc.serverResponses).toEqual([
      { id: "openai-form", result: { action: "decline", content: null } },
      { id: "openai-form-alias", result: { action: "decline", content: null } },
    ]);
  });

  it("grants a requested permission subset for the Codex session", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ status: { type: "active" } }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    rpc.emitServerRequest("permissions-1", "item/permissions/requestApproval", {
      cwd: "/workspace/Codexly",
      environmentId: "local",
      itemId: "permission-item-1",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { path: "/workspace/Codexly/.cache", type: "path" },
            },
          ],
          globScanMaxDepth: 4,
          read: null,
          write: null,
        },
        network: { enabled: true },
      },
      reason: "需要访问网络并写入缓存",
      startedAtMs: 1_776_643_200_000,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const request = (await provider.readTask("task-1"))?.pendingRequests[0];
    expect(request).toMatchObject({
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "path", value: "/workspace/Codexly/.cache" },
            },
          ],
          globScanMaxDepth: 4,
          read: null,
          write: null,
        },
        network: { enabled: true },
      },
      requestId: "string:permissions-1",
      type: "permissions_approval",
    });
    if (request?.type !== "permissions_approval") {
      throw new Error("Expected a pending permission approval");
    }

    await provider.resolvePendingRequest({
      itemId: request.itemId,
      projectId: request.projectId,
      requestId: request.requestId,
      resolution: { grantedPermissions: ["network"], scope: "session" },
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    });

    expect(rpc.serverResponses).toEqual([
      {
        id: "permissions-1",
        result: { permissions: { network: { enabled: true } }, scope: "session" },
      },
    ]);
  });
});
