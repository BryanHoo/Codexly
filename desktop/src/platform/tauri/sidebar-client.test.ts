import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, PendingRequest } from "@/protocol/index.js";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";
import type { AgentEventSubscription, NativeResyncRequired } from "./runtime.js";

describe("TauriSidebarClient", () => {
  it("maps sidebar reads and project creation to direct Tauri commands", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_projects") return { data: [], nextCursor: null };
      if (command === "list_tasks") return { data: [], nextCursor: null };
      if (command === "list_completed_tasks") return { data: [], nextCursor: null };
      return {
        project: {
          createdAt: "2025-01-01T00:00:00Z",
          id: "project-a",
          name: "a",
          roots: [{ id: "root-a", path: "/work/a" }],
        },
      };
    });
    const client = new TauriSidebarClient({
      ensureRuntime,
      invoke: invoke as InvokeImplementation,
    });

    await client.listProjects();
    await client.listTasks("project-a", {
      archived: true,
      cursor: "cursor-a",
      limit: 20,
      pinned: true,
      searchTerm: "fix",
    });
    await client.listCompletedTasks({ cursor: "cursor-b", limit: 10, projectId: "project-a" });
    await client.addProject(["/work/a", "/work/shared"]);

    expect(ensureRuntime).toHaveBeenCalledTimes(4);
    expect(invoke).toHaveBeenNthCalledWith(1, "list_projects");
    expect(invoke).toHaveBeenNthCalledWith(2, "list_tasks", {
      input: {
        archived: true,
        cursor: "cursor-a",
        limit: 20,
        pinned: true,
        projectId: "project-a",
        searchTerm: "fix",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "list_completed_tasks", {
      input: { cursor: "cursor-b", limit: 10, projectId: "project-a" },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "add_project", {
      rootPaths: ["/work/a", "/work/shared"],
    });
  });

  it("returns the snapshot produced by the Rust read_task command", async () => {
    const snapshot = {
      checkpoint: { sequence: 7, sessionId: "runtime-a" },
      snapshot: {
        contextUsage: null,
        goal: null,
        id: "thread-a",
        pendingRequests: [],
        pinned: false,
        plan: null,
        projectId: "project-a",
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        status: "idle",
        title: "真实会话",
        turns: [],
        turnsNextCursor: null,
        updatedAt: "2025-01-01T00:00:00Z",
      },
    } as const;
    const invoke = vi.fn(async () => snapshot);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.readTask("project-a", "thread-a")).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("read_task", {
      cursor: null,
      projectId: "project-a",
      taskId: "thread-a",
    });
  });

  it("passes the queued item and retry key to native steer", async () => {
    const invoke = vi.fn(async () => ({ status: "accepted" }));
    const client = new TauriSidebarClient({ ensureRuntime: vi.fn(async () => undefined), invoke: invoke as InvokeImplementation });
    const input = { attachments: [], skills: [], text: "hello", type: "prompt" as const };
    await client.steerTurn("project", "task", "turn", input, { idempotencyKey: "retry", queuedSubmissionId: "queue" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("steer_turn", {
      projectId: "project", taskId: "task", turnId: "turn", input, idempotencyKey: "retry", queuedSubmissionId: "queue",
    });
  });

  it("routes task and turn lifecycle mutations through Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_task") {
        return { task: { id: "thread-a" } };
      }
      if (command === "start_turn") {
        return { checkpoint: { sequence: 2, sessionId: "runtime-a" }, taskId: "thread-a" };
      }
      return { status: command === "steer_turn" ? "accepted" : "interrupting" };
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const input = { attachments: [], skills: [], text: "修复测试", type: "prompt" as const };
    const options = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await client.startTask("project-a", { idempotencyKey: "create-a" });
    await client.startTurn("project-a", "thread-a", input, options, { idempotencyKey: "turn-a" });
    await client.steerTurn("project-a", "thread-a", "turn-a", input, { idempotencyKey: "steer-a" });
    await client.interruptTurn("project-a", "thread-a", "turn-a");
    await expect(client.releaseTaskSubscription("project-a", "thread-a")).resolves.toBeUndefined();
    await expect(client.retainTaskSubscription("project-a", "thread-a")).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, "start_task", { projectId: "project-a", idempotencyKey: "create-a" });
    expect(invoke).toHaveBeenNthCalledWith(2, "start_turn", {
      idempotencyKey: "turn-a",
      input,
      options,
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "steer_turn", {
      idempotencyKey: "steer-a",
      input,
      projectId: "project-a",
      taskId: "thread-a",
      turnId: "turn-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "interrupt_turn", {
      taskId: "thread-a",
      turnId: "turn-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "release_task_subscription", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "retain_task_subscription", {
      projectId: "project-a",
      taskId: "thread-a",
    });

    await expect(client.getCapabilities()).resolves.toMatchObject({
      tasks: { start: true },
      turns: { interrupt: true, start: true, steer: true },
    });
  });

  it("routes queued submissions through native Tauri commands", async () => {
    const invoke = vi.fn(async () => ({ data: [] }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const input = { attachments: [], skills: [], text: "继续修复", type: "prompt" as const };

    await client.listQueuedSubmissions("project-a", "thread-a");
    await client.addQueuedSubmission("project-a", "thread-a", input, "message-a", { idempotencyKey: "queue-add-a" });
    await client.deleteQueuedSubmission("project-a", "thread-a", "queue-a");
    await client.moveQueuedSubmission("project-a", "thread-a", "queue-b", -1);
    await client.startQueuedSubmission("project-a", "thread-a", "queue-a", { idempotencyKey: "queue-start-a" });

    expect(invoke).toHaveBeenNthCalledWith(1, "list_queued_submissions", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "add_queued_submission", {
      idempotencyKey: "queue-add-a",
      clientUserMessageId: "message-a",
      input,
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "delete_queued_submission", {
      projectId: "project-a",
      queuedSubmissionId: "queue-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "move_queued_submission", {
      projectId: "project-a",
      queuedSubmissionId: "queue-b",
      offset: -1,
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "start_queued_submission", {
      idempotencyKey: "queue-start-a",
      projectId: "project-a",
      queuedSubmissionId: "queue-a",
      taskId: "thread-a",
    });
  });

  it("replays buffered Tauri events only to their owning project", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    const subscribeAgentEvents = vi.fn(
      (options: Readonly<{ afterSequence: number; onEvent: (event: AgentEvent) => void }>) => {
        emit = options.onEvent;
        return () => undefined;
      },
    );
    const invoke = vi.fn(async () => ({
      data: [
        {
          id: "thread-a",
          pinned: false,
          projectId: "project-a",
          title: "任务",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
      nextCursor: null,
    }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
      subscribeAgentEvents,
    });
    await client.listTasks("project-a");
    const onEvent = vi.fn();
    const cleanup = client.subscribeEvents({
      afterSequence: 2,
      onEvent,
      onResyncRequired: vi.fn(),
      projectId: "project-a",
      sessionId: "codeagent-runtime",
    });
    const event = {
      itemId: "item-a",
      payload: { delta: "ok" },
      provider: "codex",
      sequence: 3,
      sessionId: "codeagent-runtime",
      taskId: "thread-a",
      timestamp: "2025-01-01T00:00:00Z",
      turnId: "turn-a",
      type: "message.delta",
      version: 2,
    } as AgentEvent;
    emit?.(event);
    emit?.({ ...event, sequence: 4, taskId: "thread-b" });

    expect(subscribeAgentEvents).toHaveBeenCalledWith(
      expect.objectContaining({ afterSequence: 2 }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
    cleanup();
  });

  it("forwards native retention overflow as a project resync request", async () => {
    let emitResync: ((message: NativeResyncRequired) => void) | undefined;
    const subscribeAgentEvents = vi.fn((options: AgentEventSubscription) => {
      emitResync = options.onResyncRequired;
      return () => undefined;
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: vi.fn() as InvokeImplementation,
      subscribeAgentEvents,
    });
    const onConnectionState = vi.fn();
    const onResyncRequired = vi.fn();
    client.subscribeEvents({
      afterSequence: 17,
      onConnectionState,
      onEvent: vi.fn(),
      onResyncRequired,
      projectId: "project-a",
      sessionId: "codeagent-runtime",
    });

    emitResync?.({
      latestSequence: 17,
      projectId: "project-a",
      reason: "event_retention_exceeded",
      sessionId: "codeagent-runtime",
      type: "resync.required",
      version: 3,
    });

    expect(onResyncRequired).toHaveBeenCalledWith({
      latestSequence: 17,
      reason: "event_retention_exceeded",
      sessionId: "codeagent-runtime",
      type: "resync.required",
      version: 3,
    });
    expect(onConnectionState).toHaveBeenLastCalledWith("closed");
  });

  it("resolves app-server approvals through the Tauri command", async () => {
    const request: PendingRequest = {
      additionalPermissions: null,
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2025-01-01T00:00:00Z",
      cwd: "/work/a",
      expiresAt: null,
      itemId: "item-a",
      networkAccess: null,
      projectId: "project-a",
      reason: null,
      requestId: "number:9",
      status: "pending",
      taskId: "thread-a",
      turnId: "turn-a",
      type: "command_approval",
    };
    const response = { request: { ...request, status: "resolved" as const } };
    const invoke = vi.fn(async () => response);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.resolvePendingRequest(request, { decision: "allow" }, { idempotencyKey: "approval-key" })).resolves.toEqual(
      response,
    );
    expect(invoke).toHaveBeenCalledWith("resolve_pending_request", {
      request: {
        projectId: "project-a", taskId: "thread-a", turnId: "turn-a", itemId: "item-a",
        requestId: "number:9", createdAt: "2025-01-01T00:00:00Z",
      },
      idempotencyKey: "approval-key",
      resolution: { decision: "allow" },
    });
  });

  it("routes compact and fork through native Tauri commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "compact_task") return { status: "compacting", taskId: "thread-a" };
      if (command === "fork_task") {
        return {
          task: {
            id: "thread-b",
            pinned: false,
            projectId: "project-a",
            title: "分支任务",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        };
      }
      return {
        taskId: "thread-a",
        turn: {
          completedAt: null,
          error: null,
          id: "review-a",
          items: [],
          startedAt: "2025-01-01T00:00:00Z",
          status: "running",
        },
      };
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.compactTask("project-a", "thread-a");
    await client.forkTask("project-a", "thread-a", { lastTurnId: "turn-a" });
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;
    await client.getTaskSettings("project-a", "thread-a");
    await client.updateTaskSettings("project-a", "thread-a", settings);
    await client.updateTaskGoal("project-a", "thread-a", { status: "paused" });
    await client.clearTaskGoal("project-a", "thread-a");
    await client.listBackgroundTerminals("project-a", "thread-a");
    await client.terminateBackgroundTerminal("project-a", "thread-a", "42");

    expect(invoke).toHaveBeenNthCalledWith(1, "compact_task", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fork_task", {
      lastTurnId: "turn-a",
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "get_task_settings", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "update_task_settings", {
      projectId: "project-a",
      settings,
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "update_task_goal", {
      projectId: "project-a",
      status: "paused",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "clear_task_goal", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "list_background_terminals", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "terminate_background_terminal", {
      projectId: "project-a",
      taskId: "thread-a",
      terminalId: "42",
    });
    await expect(client.getCapabilities()).resolves.toMatchObject({
      goals: { clear: true, read: true, update: true },
    });
  });

  it("routes catalogs, settings, authentication, skills, and MCP through Tauri", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      commitMessageModel: "gpt-5.6-luna",
      commitMessagePrompt: "",
      defaultOpenAppId: null,
      fastMode: false,
      followUpBehavior: "queue",
      webSearch: "cached",
      modelVerbosity: null,
      model: "gpt-5.6-sol",
      pet: { enabled: false, selectedPetId: null },
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await client.listModels();
    await client.getProviderConnection();
    await client.startOfficialProviderLogin();
    await client.cancelProviderLogin("login-a");
    await client.configureCustomProvider({ baseUrl: "https://api.example/v1" });
    await client.logoutProvider();
    await client.getGlobalSettings();
    await client.updateGlobalSettings(settings);
    await client.listSkills("project-a");
    await client.listMcpServers("project-a", "thread-a");
    await client.retryMcpServers("project-a", "thread-a");

    expect(invoke.mock.calls).toEqual([
      ["list_models"],
      ["get_provider_connection"],
      ["start_official_provider_login"],
      ["cancel_provider_login", { loginId: "login-a" }],
      ["configure_custom_provider", { input: { baseUrl: "https://api.example/v1" } }],
      ["logout_provider"],
      ["get_global_settings"],
      ["update_global_settings", { settings }],
      ["list_skills", { forceReload: false, projectId: "project-a" }],
      ["list_mcp_servers", { projectId: "project-a", taskId: "thread-a" }],
      ["retry_mcp_servers", { projectId: "project-a", taskId: "thread-a" }],
    ]);
  });

});
