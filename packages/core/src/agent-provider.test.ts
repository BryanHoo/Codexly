import { describe, expect, it } from "vitest";

import type {
  AgentFileSearchProvider,
  AgentProvider,
  AgentProviderEvent,
} from "./agent-provider.js";

describe("AgentFileSearchProvider", () => {
  it("defines reusable search sessions without making the capability mandatory", async () => {
    const fileSearch: AgentFileSearchProvider = {
      search(input) {
        expect(input).toMatchObject({
          projectId: "project-1",
          query: "agent",
          roots: ["/workspace/project"],
          sessionId: "search-1",
        });
        return Promise.resolve({
          data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: "/workspace/project" }],
        });
      },
      stop(projectId, sessionId) {
        expect([projectId, sessionId]).toEqual(["project-1", "search-1"]);
        return Promise.resolve();
      },
    };

    await expect(
      fileSearch.search({
        projectId: "project-1",
        query: "agent",
        roots: ["/workspace/project"],
        sessionId: "search-1",
      }),
    ).resolves.toEqual({
      data: [{ name: "agent.ts", path: "src/agent.ts", rootPath: "/workspace/project" }],
    });
    await expect(fileSearch.stop("project-1", "search-1")).resolves.toBeUndefined();
  });
});

describe("AgentProvider", () => {
  it("defines provider-independent read and mutation contracts", async () => {
    const listeners = new Set<(event: AgentProviderEvent) => void>();
    const provider: AgentProvider = {
      queue: {
        add(_taskId, input, clientUserMessageId) {
          return Promise.resolve({
            attachments: [],
            clientUserMessageId,
            id: "queue-1",
            skills: [...input.skills],
            status: "queued",
            text: input.text,
          });
        },
        delete() {
          return Promise.resolve(true);
        },
        list() {
          return Promise.resolve({ data: [], nextCursor: null });
        },
        reorder() {
          return Promise.resolve();
        },
        start(taskId) {
          return Promise.resolve({
            completedAt: null,
            error: null,
            id: `${taskId}-queued-turn`,
            items: [],
            startedAt: null,
            status: "running",
          });
        },
        update(_taskId, queuedSubmissionId, input) {
          return Promise.resolve({
            attachments: [],
            clientUserMessageId: "client-message-1",
            id: queuedSubmissionId,
            skills: [...input.skills],
            status: "queued",
            text: input.text,
          });
        },
      },
      archiveTask() {
        return Promise.resolve();
      },
      clearGoal() {
        return Promise.resolve();
      },
      readGoal() {
        return Promise.resolve(null);
      },
      updateGoal(_taskId, input) {
        return Promise.resolve({
          createdAt: "2026-07-25T00:00:00.000Z",
          objective: "验证统一 Goal 契约",
          status: input.status,
          timeUsedSeconds: 0,
          tokenBudget: null,
          tokensUsed: 0,
          updatedAt: "2026-07-25T00:00:00.000Z",
        });
      },
      getCapabilities() {
        return Promise.resolve({
          feedback: { upload: true },
          goals: { clear: true, read: true, update: true },
          provider: "fake",
          skills: { list: true, use: true },
          tasks: { fork: true, list: true, read: true, start: true },
          turns: {
            compact: true,
            interrupt: true,
            review: true,
            start: true,
            steer: true,
          },
        });
      },
      compactTask(taskId) {
        expect(taskId).toBe("task-1");
        return Promise.resolve();
      },
      deleteTask(taskId) {
        expect(taskId).toBe("task-1");
        return Promise.resolve();
      },
      forkTask(taskId) {
        return Promise.resolve({
          id: `${taskId}-fork`,
          pinned: false,
          projectId: "project-1",
          title: "续接任务",
          updatedAt: "2026-07-25T00:00:00.000Z",
        });
      },
      listTasks() {
        return Promise.resolve({ data: [], nextCursor: null });
      },
      listBackgroundTerminals() {
        return Promise.resolve({ data: [] });
      },
      listModels() {
        return Promise.resolve({
          data: [
            {
              defaultReasoningEffort: "high",
              description: "适合复杂编码任务",
              displayName: "GPT-5.6 Sol",
              id: "gpt-5.6-sol",
              isDefault: true,
              supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
            },
          ],
          nextCursor: null,
        });
      },
      listMcpServers(taskId) {
        expect(taskId).toBe("task-1");
        return Promise.resolve({
          data: [
            {
              displayName: "fast-context",
              name: "fast-context",
              status: "connected",
              toolCount: 2,
            },
          ],
        });
      },
      listSkills() {
        return Promise.resolve({
          data: [
            {
              description: "安全审查",
              displayName: "Security review",
              id: "skill-security",
              name: "review-security",
              scope: "system",
            },
          ],
          nextCursor: null,
        });
      },
      pinTask(taskId, pinned) {
        return Promise.resolve({
          id: taskId,
          pinned,
          projectId: "project-1",
          title: "续接任务",
          updatedAt: "2026-07-25T00:00:00.000Z",
        });
      },
      readSandboxMode() {
        return Promise.resolve("workspace-write");
      },
      readTaskAttachment(taskId, attachmentId) {
        if (taskId !== "task-1" || attachmentId !== "attachment-1") {
          return Promise.resolve(undefined);
        }
        return Promise.resolve({
          content: Uint8Array.from([137, 80, 78, 71]),
          kind: "image",
          mediaType: "image/png",
          name: "diagram.png",
          size: 4,
        });
      },
      readTask() {
        return Promise.resolve(undefined);
      },
      reloadMcpServers(taskId) {
        expect(taskId).toBe("task-1");
        return this.listMcpServers(taskId);
      },
      renameTask() {
        return Promise.resolve();
      },
      startReview(taskId, target) {
        expect(target).toEqual({ type: "uncommitted_changes" });
        return Promise.resolve({
          completedAt: null,
          error: null,
          id: `${taskId}-review`,
          items: [],
          startedAt: "2026-07-25T00:00:00.000Z",
          status: "running",
        });
      },
      resolvePendingRequest(input) {
        return Promise.resolve({
          availableDecisions: ["allow", "deny"],
          command: "pnpm check",
          createdAt: "2026-07-23T00:00:00.000Z",
          cwd: "/workspace/Codexly",
          expiresAt: null,
          itemId: input.itemId,
          kind: "command",
          networkAccess: null,
          projectId: input.projectId,
          reason: null,
          requestId: input.requestId,
          status: "resolved",
          taskId: input.taskId,
          turnId: input.turnId,
          type: "command_approval",
        });
      },
      startTask() {
        return Promise.resolve({
          id: "task-1",
          pinned: false,
          projectId: "project-1",
          title: "新任务",
          updatedAt: "2026-07-23T00:00:00.000Z",
        });
      },
      startTurn(taskId, input, options) {
        expect(input.outputSchema).toEqual({
          additionalProperties: false,
          properties: { message: { type: "string" } },
          required: ["message"],
          type: "object",
        });
        expect(options).toEqual({
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        });
        return Promise.resolve({
          completedAt: null,
          error: null,
          id: `${taskId}-turn`,
          items: [{ id: "input-1", role: "user", text: input.text, type: "message" }],
          startedAt: "2026-07-23T00:00:00.000Z",
          status: "running",
        });
      },
      steerTurn(taskId, turnId, input) {
        expect({ taskId, text: input.text, turnId }).toEqual({
          taskId: "task-1",
          text: "补充约束",
          turnId: "turn-1",
        });
        return Promise.resolve();
      },
      interruptTurn(taskId, turnId) {
        expect(taskId).toBe("task-1");
        expect(turnId).toBe("turn-1");
        return Promise.resolve();
      },
      uploadFeedback(taskId, input) {
        expect({ input, taskId }).toEqual({
          input: { classification: "other", includeLogs: true, reason: "体验反馈" },
          taskId: "task-1",
        });
        return Promise.resolve();
      },
      subscribeEvents(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      terminateBackgroundTerminal() {
        return Promise.resolve(true);
      },
      unarchiveTask(taskId) {
        return Promise.resolve({
          id: taskId,
          pinned: false,
          projectId: "project-1",
          title: "恢复任务",
          updatedAt: "2026-07-25T00:00:00.000Z",
        });
      },
      unsubscribeTask() {
        return Promise.resolve("unsubscribed");
      },
    };

    await expect(provider.getCapabilities()).resolves.toEqual({
      feedback: { upload: true },
      goals: { clear: true, read: true, update: true },
      provider: "fake",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    await expect(provider.listTasks({ limit: 25 })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    await expect(provider.listModels()).resolves.toMatchObject({
      data: [{ id: "gpt-5.6-sol", isDefault: true }],
    });
    await expect(provider.listMcpServers("task-1")).resolves.toEqual({
      data: [
        expect.objectContaining({
          name: "fast-context",
          status: "connected",
          toolCount: 2,
        }),
      ],
    });
    await expect(provider.reloadMcpServers("task-1")).resolves.toMatchObject({
      data: [{ name: "fast-context", status: "connected" }],
    });
    await expect(provider.listSkills()).resolves.toMatchObject({
      data: [{ id: "skill-security", name: "review-security" }],
    });
    await expect(provider.readSandboxMode()).resolves.toBe("workspace-write");
    await expect(provider.readTask("missing-task")).resolves.toBeUndefined();
    await expect(provider.readTaskAttachment("task-1", "attachment-1")).resolves.toMatchObject({
      mediaType: "image/png",
      name: "diagram.png",
      size: 4,
    });
    await expect(
      provider.resolvePendingRequest({
        itemId: "item-1",
        projectId: "project-1",
        requestId: "number:7",
        resolution: { decision: "allow" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      }),
    ).resolves.toMatchObject({ requestId: "number:7", status: "resolved" });
    await expect(provider.startTask()).resolves.toMatchObject({ id: "task-1" });
    await expect(
      provider.queue?.add(
        "task-1",
        { files: [], images: [], skills: [], text: "排队", textAttachments: [] },
        "client-message-1",
      ),
    ).resolves.toMatchObject({ id: "queue-1", text: "排队" });
    await expect(provider.pinTask("task-1", true)).resolves.toMatchObject({
      id: "task-1",
      pinned: true,
    });
    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [],
          images: [
            {
              detail: "auto",
              mediaType: "image/png",
              path: "/tmp/image.png",
            },
          ],
          outputSchema: {
            additionalProperties: false,
            properties: { message: { type: "string" } },
            required: ["message"],
            type: "object",
          },
          skills: [{ id: "skill-security", name: "review-security" }],
          text: "继续",
          textAttachments: [{ name: "Pasted text.txt", text: "附加说明" }],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "task-1-turn", status: "running" });
    await expect(
      provider.steerTurn("task-1", "turn-1", {
        files: [],
        images: [],
        skills: [],
        text: "补充约束",
        textAttachments: [],
      }),
    ).resolves.toBeUndefined();
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();
    await expect(provider.compactTask("task-1")).resolves.toBeUndefined();
    await expect(provider.deleteTask("task-1")).resolves.toBeUndefined();
    await expect(provider.unarchiveTask("task-1")).resolves.toMatchObject({ id: "task-1" });
    await expect(provider.forkTask("task-1")).resolves.toMatchObject({ id: "task-1-fork" });
    await expect(
      provider.startReview("task-1", { type: "uncommitted_changes" }),
    ).resolves.toMatchObject({ id: "task-1-review" });
    await expect(
      provider.uploadFeedback("task-1", {
        classification: "other",
        includeLogs: true,
        reason: "体验反馈",
      }),
    ).resolves.toBeUndefined();

    const received: AgentProviderEvent[] = [];
    const unsubscribe = provider.subscribeEvents((event) => {
      received.push(event);
    });
    const event: AgentProviderEvent = {
      itemId: "item-1",
      payload: { delta: "实时" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    };
    for (const listener of listeners) {
      listener(event);
    }
    unsubscribe();
    for (const listener of listeners) {
      listener(event);
    }

    expect(received).toEqual([event]);
  });
});
