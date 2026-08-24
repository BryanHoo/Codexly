import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent, PendingRequestResolutionError } from "@code-agent/core";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider pending request lifecycle", () => {
  it("reuses matching concurrent resolutions and rejects conflicting decisions", async () => {
    let releaseResponse: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const rpc = new FakeRpcClient(
      [
        { data: [nativeThread()], nextCursor: null },
        { thread: nativeThread({ status: { type: "active" } }) },
      ],
      responseGate,
    );
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    rpc.emitServerRequest(7, "item/commandExecution/requestApproval", {
      availableDecisions: ["accept", "decline"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      itemId: "command-1",
      reason: null,
      startedAtMs: 1_753_228_800_000,
      threadId: "task-1",
      turnId: "turn-1",
    });
    const request = (await provider.readTask("task-1"))?.pendingRequests[0];
    if (request?.type !== "command_approval") {
      throw new Error("Expected a pending command approval");
    }
    const input = {
      itemId: request.itemId,
      projectId: request.projectId,
      requestId: request.requestId,
      taskId: request.taskId,
      turnId: request.turnId,
      type: request.type,
    } as const;

    const first = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "allow" },
    });
    const repeated = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "allow" },
    });
    const conflicting = provider.resolvePendingRequest({
      ...input,
      resolution: { decision: "deny" },
    });
    await Promise.resolve();
    releaseResponse();
    await expect(Promise.all([first, repeated])).resolves.toEqual([
      expect.objectContaining({ status: "resolved" }),
      expect.objectContaining({ status: "resolved" }),
    ]);
    await expect(conflicting).rejects.toMatchObject({
      code: "resolved",
    } satisfies Partial<PendingRequestResolutionError>);

    expect(rpc.serverResponses).toEqual([{ id: 7, result: { decision: "accept" } }]);
  });

  it("keeps a local resolution resolved when Codex confirms it before the write callback", async () => {
    let releaseResponse: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], responseGate);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    rpc.emitServerRequest("approval-race", "item/fileChange/requestApproval", {
      grantRoot: "/workspace/CodeAgent",
      itemId: "approval-race-item",
      reason: null,
      startedAtMs: 1_753_228_801_000,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const resolution = provider.resolvePendingRequest({
      itemId: "approval-race-item",
      projectId: project.id,
      requestId: "string:approval-race",
      resolution: { decision: "allow" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "file_change_approval",
    });
    await Promise.resolve();
    rpc.emitNotification("serverRequest/resolved", {
      requestId: "approval-race",
      threadId: "task-1",
    });
    releaseResponse();

    await expect(resolution).resolves.toMatchObject({ status: "resolved" });
    expect(events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.resolved",
    ]);
  });

  it("auto-resolves timed user input and rejects answers after expiry", async () => {
    vi.useFakeTimers();
    try {
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        isBlocking: false,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [
              { description: "继续", label: "Yes" },
              { description: "停止", label: "No" },
            ],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(rpc.serverResponses).toEqual([{ id: "timed-input", result: { answers: {} } }]);
      expect(events.some((event) => event.type === "pending_request.expired")).toBe(true);
      await expect(
        provider.resolvePendingRequest({
          itemId: "timed-input-item",
          projectId: project.id,
          requestId: "string:timed-input",
          resolution: { answers: { confirm: ["Yes"] } },
          taskId: "task-1",
          turnId: "turn-timed",
          type: "user_input",
        }),
      ).rejects.toMatchObject({ code: "expired" } satisfies Partial<PendingRequestResolutionError>);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps auto-expiration expired when Codex confirms it before the write callback", async () => {
    vi.useFakeTimers();
    try {
      let releaseResponse: () => void = () => undefined;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], responseGate);
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("expiry-race", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        isBlocking: false,
        itemId: "expiry-race-item",
        questions: [
          {
            header: "说明",
            id: "note",
            isOther: false,
            isSecret: false,
            options: null,
            question: "补充说明",
          },
        ],
        threadId: "task-1",
        turnId: "turn-1",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      rpc.emitNotification("serverRequest/resolved", {
        requestId: "expiry-race",
        threadId: "task-1",
      });
      releaseResponse();
      await Promise.resolve();

      expect(events.map((event) => event.type)).toEqual([
        "pending_request.created",
        "pending_request.expired",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps timed user input expiry active after a failed manual response", async () => {
    vi.useFakeTimers();
    try {
      let responseAttempt = 0;
      const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }], () => {
        responseAttempt += 1;
        return responseAttempt === 1
          ? Promise.reject(new Error("RPC write failed"))
          : Promise.resolve();
      });
      const provider = createCodexAgentProvider({ client: rpc, project });
      const events: AgentProviderEvent[] = [];
      provider.subscribeEvents((event) => events.push(event));
      await provider.listTasks();
      rpc.emitServerRequest("timed-input", "item/tool/requestUserInput", {
        autoResolutionMs: 1_000,
        isBlocking: false,
        itemId: "timed-input-item",
        questions: [
          {
            header: "确认",
            id: "confirm",
            isOther: false,
            isSecret: false,
            options: [
              { description: "继续", label: "Yes" },
              { description: "停止", label: "No" },
            ],
            question: "继续执行吗？",
          },
        ],
        threadId: "task-1",
        turnId: "turn-timed",
      });

      await expect(
        provider.resolvePendingRequest({
          itemId: "timed-input-item",
          projectId: project.id,
          requestId: "string:timed-input",
          resolution: { answers: { confirm: ["Yes"] } },
          taskId: "task-1",
          turnId: "turn-timed",
          type: "user_input",
        }),
      ).rejects.toThrow("RPC write failed");

      await vi.advanceTimersByTimeAsync(1_000);

      expect(rpc.serverResponses).toEqual([
        { id: "timed-input", result: { answers: { confirm: { answers: ["Yes"] } } } },
        { id: "timed-input", result: { answers: {} } },
      ]);
      expect(events.at(-1)).toMatchObject({
        payload: { request: { status: "expired" } },
        type: "pending_request.expired",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
