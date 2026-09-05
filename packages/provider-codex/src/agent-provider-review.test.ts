import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider review", () => {
  it("keeps live review prompts hidden behind one stable review item", async () => {
    const reviewPrompt = {
      content: [
        {
          text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
          type: "text",
        },
      ],
      id: "review-prompt",
      type: "userMessage",
    };
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-live-turn",
      items: [reviewPrompt],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: runningTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("turn/started", { threadId: "task-1", turn: runningTurn });
    rpc.emitNotification("item/completed", {
      item: reviewPrompt,
      threadId: "task-1",
      turnId: "review-live-turn",
    });
    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-live-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 修复消息顺序。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-live-turn",
    });

    expect(events).toMatchObject([
      {
        payload: {
          turn: {
            items: [
              {
                id: "review-mode-review-live-turn",
                target: { type: "uncommitted_changes" },
                type: "review",
              },
            ],
          },
        },
        type: "turn.started",
      },
      {
        itemId: "review-mode-review-live-turn",
        payload: { item: { type: "review" } },
        type: "item.started",
      },
      {
        itemId: "review-result",
        payload: {
          item: {
            role: "assistant",
            text: "- [P1] 修复消息顺序。",
            type: "message",
          },
        },
        type: "item.completed",
      },
    ]);
  });

  it("projects live reviewer operations into one outer review turn", async () => {
    const outerTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const nestedTurn = {
      ...outerTurn,
      id: "reviewer-nested-turn",
      items: [
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files).",
              type: "text",
            },
          ],
          id: "nested-review-prompt",
          type: "userMessage",
        },
      ],
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    rpc.emitNotification("turn/started", { threadId: "reviewer-thread", turn: nestedTurn });
    rpc.emitNotification("item/completed", {
      item: {
        delivery: null,
        questions: null,
        id: "review-commentary",
        phase: "commentary",
        text: "正在检查变更。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        aggregatedOutput: "diff --git a/a.ts b/a.ts",
        command: "git diff",
        cwd: "/workspace",
        exitCode: 0,
        id: "review-command",
        status: "completed",
        type: "commandExecution",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-failed-placeholder",
        review: "Reviewer failed to output a response.",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        delivery: null,
        questions: null,
        id: "worker-review-result",
        phase: "final_answer",
        text: "- [P1] 修复消息顺序。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "reviewer-nested-turn",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "reviewer-thread",
      turn: { ...nestedTurn, completedAt: 1_753_228_810, status: "completed" },
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 修复消息顺序。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        delivery: null,
        questions: null,
        id: "duplicate-review-result",
        phase: "final_answer",
        text: "- [P1] 修复消息顺序。",
        type: "agentMessage",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        ...outerTurn,
        completedAt: 1_753_228_820,
        items: [
          { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
          {
            id: "review-result",
            review: "- [P1] 修复消息顺序。",
            type: "exitedReviewMode",
          },
          {
            delivery: null,
            questions: null,
            id: "duplicate-review-result",
            phase: "final_answer",
            text: "- [P1] 修复消息顺序。",
            type: "agentMessage",
          },
        ],
        status: "completed",
      },
    });

    expect(events.map((event) => [event.type, "turnId" in event ? event.turnId : null])).toEqual([
      ["item.started", "review-outer-turn"],
      ["turn.started", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["item.started", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["item.completed", "review-outer-turn"],
      ["turn.completed", "review-outer-turn"],
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        turn: {
          id: "review-outer-turn",
          items: [{ id: "review-mode-review-outer-turn", type: "review" }],
          status: "running",
        },
      },
    });
    expect(events[4]).toMatchObject({ payload: { item: { id: "review-command" } } });
    expect(events[5]).toMatchObject({
      payload: {
        item: {
          id: "worker-review-result",
          text: "- [P1] 修复消息顺序。",
          type: "message",
        },
      },
    });
    expect(events[6]).toMatchObject({
      payload: {
        turn: {
          id: "review-outer-turn",
          items: [{ id: "review-mode-review-outer-turn", type: "review" }],
          status: "completed",
        },
      },
    });
  });

  it("restores a running review worker from its child thread", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [{ id: "review-mode", review: "current changes", type: "enteredReviewMode" }],
      startedAt: null,
      status: "completed",
    };
    const workerTurn = {
      completedAt: null,
      error: null,
      id: "review-worker-turn",
      items: [
        {
          content: [
            {
              text: "Review the current code changes (staged, unstaged, and untracked files).",
              type: "text",
            },
          ],
          id: "review-prompt",
          type: "userMessage",
        },
        {
          aggregatedOutput: "diff --git a/a.ts b/a.ts",
          command: "git diff",
          cwd: "/workspace",
          exitCode: 0,
          id: "review-command",
          status: "completed",
          type: "commandExecution",
        },
      ],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({ status: { type: "active" }, turns: [outerTurn] }),
      },
      {
        data: [
          nativeThread({
            id: "reviewer-thread",
            parentThreadId: "task-1",
            source: { subAgent: "review" },
          }),
        ],
        nextCursor: null,
      },
      { backwardsCursor: null, data: [workerTurn], nextCursor: null },
      {},
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      status: "running",
      turns: [
        {
          id: "review-outer-turn",
          items: [{ type: "review" }, { id: "review-command", type: "command" }],
          status: "running",
        },
      ],
    });
    await expect(provider.interruptTurn("task-1", "review-outer-turn")).resolves.toBeUndefined();
    expect(rpc.calls).toEqual([
      { method: "thread/read", params: { includeTurns: false, threadId: "task-1" } },
      { method: "thread/goal/get", params: { threadId: "task-1" } },
      {
        method: "thread/turns/list",
        params: {
          itemsView: "full",
          limit: 10,
          sortDirection: "desc",
          threadId: "task-1",
        },
      },
      {
        method: "thread/list",
        params: {
          limit: 1,
          parentThreadId: "task-1",
          sortDirection: "desc",
          sortKey: "created_at",
          sourceKinds: ["subAgentReview"],
          useStateDbOnly: true,
        },
      },
      {
        method: "thread/turns/list",
        params: {
          itemsView: "full",
          limit: 10,
          sortDirection: "desc",
          threadId: "reviewer-thread",
        },
      },
      {
        method: "turn/interrupt",
        params: { threadId: "reviewer-thread", turnId: "review-worker-turn" },
      },
    ]);
  });

  it("keeps the outer review result when the worker has no final message", async () => {
    const outerTurn = {
      completedAt: null,
      error: null,
      id: "review-outer-turn",
      items: [],
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { reviewThreadId: "task-1", turn: outerTurn },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    await provider.startReview("task-1", { type: "uncommitted_changes" });

    rpc.emitNotification("item/started", {
      item: { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("thread/started", {
      thread: {
        id: "reviewer-thread",
        parentThreadId: "task-1",
        source: { subAgent: "review" },
      },
    });
    rpc.emitNotification("item/completed", {
      item: {
        delivery: null,
        questions: null,
        id: "review-commentary",
        phase: "commentary",
        text: "正在检查变更。",
        type: "agentMessage",
      },
      threadId: "reviewer-thread",
      turnId: "review-worker-turn",
    });
    rpc.emitNotification("item/started", {
      item: {
        command: "git diff",
        cwd: "/workspace",
        id: "outer-review-command",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });
    rpc.emitNotification("item/completed", {
      item: {
        id: "review-result",
        review: "- [P1] 保留外层审查结论。",
        type: "exitedReviewMode",
      },
      threadId: "task-1",
      turnId: "review-outer-turn",
    });

    expect(events.at(-1)).toMatchObject({
      payload: {
        item: {
          id: "review-result",
          text: "- [P1] 保留外层审查结论。",
          type: "message",
        },
      },
      turnId: "review-outer-turn",
      type: "item.completed",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        itemId: "outer-review-command",
        turnId: "review-outer-turn",
        type: "item.started",
      }),
    );
  });
});
