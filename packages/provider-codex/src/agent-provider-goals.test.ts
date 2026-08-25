import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider goals and operations", () => {
  it("maps goal lifecycle notifications and controls the persisted goal", async () => {
    const activeGoal = {
      createdAt: 1_754_396_400,
      objective: "完成 Goal 协议适配",
      status: "active",
      threadId: "task-1",
      timeUsedSeconds: 12,
      tokenBudget: 20_000,
      tokensUsed: 1_024,
      updatedAt: 1_754_396_412,
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { goal: activeGoal },
      { goal: { ...activeGoal, status: "paused" } },
      { cleared: true },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    await expect(provider.readGoal("task-1")).resolves.toMatchObject({
      objective: "完成 Goal 协议适配",
      status: "active",
      tokenBudget: 20_000,
      tokensUsed: 1_024,
    });
    await expect(provider.updateGoal("task-1", { status: "paused" })).resolves.toMatchObject({
      status: "paused",
    });
    await expect(provider.clearGoal("task-1")).resolves.toBeUndefined();

    rpc.emitNotification("thread/goal/updated", {
      goal: { ...activeGoal, status: "budgetLimited" },
      threadId: "task-1",
      turnId: null,
    });
    rpc.emitNotification("thread/goal/cleared", { threadId: "task-1" });

    expect(rpc.calls.slice(1)).toEqual([
      { method: "thread/goal/get", params: { threadId: "task-1" } },
      {
        method: "thread/goal/set",
        params: { status: "paused", threadId: "task-1" },
      },
      { method: "thread/goal/clear", params: { threadId: "task-1" } },
    ]);
    expect(events).toMatchObject([
      {
        payload: { goal: { objective: "完成 Goal 协议适配", status: "budget_limited" } },
        taskId: "task-1",
        type: "goal.updated",
      },
      { payload: {}, taskId: "task-1", type: "goal.cleared" },
    ]);
  });

  it("rejects structured Goal input instead of silently dropping it", async () => {
    const rpc = new FakeRpcClient([{ thread: nativeThread() }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();

    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [{ mediaType: "text/plain", name: "notes.txt", path: "/tmp/notes.txt" }],
          images: [],
          skills: [],
          text: "完成 Goal 协议适配",
          textAttachments: [],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          goalMode: true,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).rejects.toThrow("Codex goals do not support structured attachments or skills");
    expect(rpc.calls).toHaveLength(1);
  });

  it("sets a persistent goal before starting the first goal turn", async () => {
    const runningGoalTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-goal",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_754_396_400,
      status: "inProgress",
    };
    const goalResponse = {
      goal: {
        createdAt: 1_754_396_400,
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
        timeUsedSeconds: 0,
        tokenBudget: null,
        tokensUsed: 0,
        updatedAt: 1_754_396_400,
      },
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {},
      () => {
        rpc.emitNotification("turn/started", {
          threadId: "task-1",
          turn: runningGoalTurn,
        });
        return goalResponse;
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();
    await expect(
      provider.startTurn(
        "task-1",
        {
          files: [],
          images: [],
          skills: [],
          text: "  完成 Goal 协议适配  ",
          textAttachments: [],
        },
        {
          approvalPolicy: {
            granular: {
              mcp_elicitations: false,
              request_permissions: true,
              rules: false,
              sandbox_approval: true,
              skill_approval: false,
            },
          },
          approvalsReviewer: "auto_review",
          goalMode: true,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-goal", status: "running" });

    expect(rpc.calls.map(({ method }) => method)).toEqual([
      "thread/start",
      "thread/settings/update",
      "thread/goal/set",
    ]);
    expect(rpc.calls[1]).toEqual({
      method: "thread/settings/update",
      params: {
        approvalPolicy: {
          granular: {
            mcp_elicitations: false,
            request_permissions: true,
            rules: false,
            sandbox_approval: true,
            skill_approval: false,
          },
        },
        approvalsReviewer: "auto_review",
        collaborationMode: {
          mode: "default",
          settings: {
            developer_instructions: null,
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
          },
        },
        effort: "high",
        model: "gpt-5.6-sol",
        sandboxPolicy: {
          excludeSlashTmp: false,
          excludeTmpdirEnvVar: false,
          networkAccess: false,
          type: "workspaceWrite",
          writableRoots: [],
        },
        serviceTier: null,
        threadId: "task-1",
      },
    });
    expect(rpc.calls[2]).toEqual({
      method: "thread/goal/set",
      params: {
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
      },
    });
  });

  it("streams automatic approval review lifecycle as timeline items", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexRuntimeProvider({ client: rpc }).forProject(project);
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    const action = {
      command: "/bin/zsh -lc pwd",
      cwd: "/workspace/Codexly",
      source: "shell",
      type: "command",
    };
    rpc.emitNotification("item/autoApprovalReview/started", {
      action,
      review: {
        rationale: null,
        riskLevel: null,
        status: "inProgress",
        userAuthorization: null,
      },
      reviewId: "review-1",
      startedAtMs: 1_753_228_800_000,
      targetItemId: "command-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/autoApprovalReview/completed", {
      action,
      completedAtMs: 1_753_228_802_000,
      decisionSource: "agent",
      review: {
        rationale: "The user explicitly requested this read-only command.",
        riskLevel: "low",
        status: "approved",
        userAuthorization: "high",
      },
      reviewId: "review-1",
      startedAtMs: 1_753_228_800_000,
      targetItemId: "command-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toMatchObject([
      {
        itemId: "auto-approval-review-review-1",
        payload: {
          item: {
            action: { detail: "/bin/zsh -lc pwd", type: "command" },
            id: "auto-approval-review-review-1",
            status: "in_progress",
            targetItemId: "command-1",
            type: "approval_review",
          },
        },
        type: "item.started",
      },
      {
        itemId: "auto-approval-review-review-1",
        payload: {
          item: {
            action: { detail: "/bin/zsh -lc pwd", type: "command" },
            rationale: "The user explicitly requested this read-only command.",
            riskLevel: "low",
            status: "approved",
            type: "approval_review",
            userAuthorization: "high",
          },
        },
        type: "item.completed",
      },
    ]);
  });

  it("lists and terminates background terminals through the experimental thread API", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      {
        data: [
          {
            command: "pnpm dev",
            cpuPercent: 1.5,
            cwd: "/workspace/Codexly",
            itemId: "command-1",
            osPid: 2345,
            processId: "terminal-1",
            rssKb: 4096,
          },
        ],
        nextCursor: null,
      },
      { terminated: true },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/Codexly",
          id: "terminal-1",
          itemId: "command-1",
        },
      ],
    });
    await expect(provider.terminateBackgroundTerminal("task-1", "terminal-1")).resolves.toBe(true);
    expect(rpc.calls.slice(3)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      {
        method: "thread/backgroundTerminals/terminate",
        params: { processId: "terminal-1", threadId: "task-1" },
      },
    ]);
  });

  it("returns no background terminals when the historical thread is not loaded", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      new RpcResponseError({
        code: -32600,
        data: null,
        message: "thread not found: task-1",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.listBackgroundTerminals("task-1")).resolves.toEqual({ data: [] });
    expect(rpc.calls.slice(3)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
    ]);
  });

  it("unsubscribes an idle task and releases provider task state", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ turns: [] }) },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.readTask("task-1");

    await expect(provider.unsubscribeTask("task-1")).resolves.toBe("unsubscribed");
    await expect(provider.unsubscribeTask("task-1")).resolves.toBe("notLoaded");

    expect(rpc.calls.slice(3)).toEqual([
      {
        method: "thread/backgroundTerminals/list",
        params: { limit: 100, threadId: "task-1" },
      },
      { method: "thread/unsubscribe", params: { threadId: "task-1" } },
    ]);
  });

  it("preserves structured subagent details from Codex collaboration items", async () => {
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_228_860,
              error: null,
              id: "turn-collaboration",
              items: [
                {
                  agentsStates: {
                    "child-frontend": { message: "前端分析完成", status: "completed" },
                  },
                  id: "collaboration-spawn",
                  model: "gpt-5.6-sol",
                  prompt: "理解前端项目",
                  reasoningEffort: "high",
                  receiverThreadIds: ["child-frontend"],
                  senderThreadId: "task-1",
                  status: "completed",
                  tool: "spawnAgent",
                  type: "collabAgentToolCall",
                },
                {
                  agentPath: "/root/frontend_analysis",
                  agentThreadId: "child-frontend",
                  id: "subagent-started",
                  kind: "started",
                  type: "subAgentActivity",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.turns[0]?.items).toEqual([
      {
        id: "collaboration-spawn",
        input: {
          model: "gpt-5.6-sol",
          prompt: "理解前端项目",
          reasoningEffort: "high",
          receiverTaskIds: ["child-frontend"],
          senderTaskId: "task-1",
        },
        name: "agent/spawn",
        output: {
          agents: [
            {
              message: "前端分析完成",
              nickname: "frontend_analysis",
              status: "completed",
              taskId: "child-frontend",
            },
          ],
        },
        status: "completed",
        type: "tool",
      },
      {
        detail: "已启动",
        id: "subagent-started",
        label: "子代理 frontend_analysis",
        status: "completed",
        type: "activity",
      },
    ]);
  });
});
