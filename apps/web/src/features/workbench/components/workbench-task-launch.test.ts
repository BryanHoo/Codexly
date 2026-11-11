import { expect, test } from "vitest";
import { createTaskLaunchSnapshot } from "./workbench-task-launch.js";

test("ACP 首屏接管保留读取边界内的正文且不补造旧设置", () => {
  const turn = {
    id: "turn",
    status: "running" as const,
    items: [],
    startedAt: null,
    completedAt: null,
    error: null,
  };
  const task = {
    id: "t",
    projectId: "p",
    title: "首发",
    engine: "codex" as const,
    pinned: false,
    updatedAt: "2026-11-10T00:00:00Z",
  };
  const snapshot = {
    ...task,
    runtime: "acp" as const,
    status: "running" as const,
    goal: null,
    plan: null,
    contextUsage: null,
    pendingRequests: [
      {
        type: "tool_approval" as const,
        requestId: "r",
        projectId: "p",
        taskId: "t",
        turnId: "turn",
        itemId: "tool",
        status: "pending" as const,
        createdAt: task.updatedAt,
        expiresAt: null,
        toolName: "读取",
        input: {},
        reason: null,
        availableDecisions: ["allow" as const],
        acpOptions: [{ optionId: "raw", name: "允许", kind: "allow_once" as const }],
      },
    ],
    turnsNextCursor: null,
    turns: [
      {
        ...turn,
        items: [
          {
            id: "reply",
            type: "message" as const,
            role: "assistant" as const,
            text: "已经收到的流式正文",
          },
        ],
      },
    ],
  };
  const result = createTaskLaunchSnapshot({
    runtime: "acp",
    snapshot,
    checkpoint: { sessionId: "s", sequence: 7 },
    task,
    turn,
    input: { type: "prompt", text: "新问题", attachments: [], skills: [] },
    messageAttachments: [],
  });
  expect(result).toMatchObject({
    runtime: "acp",
    turns: [
      {
        items: [
          { role: "user", text: "新问题" },
          { id: "reply", text: "已经收到的流式正文" },
        ],
      },
    ],
  });
  expect(result).not.toHaveProperty("settings");
  expect(result.pendingRequests).toEqual(snapshot.pendingRequests);
});
