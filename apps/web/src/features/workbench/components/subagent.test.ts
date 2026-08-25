import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { collectSubagents } from "./subagent.js";

const snapshot: RuntimeTaskSnapshot = {
  contextUsage: null,
  goal: null,
  plan: null,
  id: "parent-task",
  pendingRequests: [],
  pinned: false,
  projectId: "codexly",
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "running",
  title: "父任务",
  turns: [
    {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [
        {
          id: "spawn",
          input: {
            model: "gpt-5.6-sol",
            prompt: "检查前端实现",
            reasoningEffort: "high",
          },
          name: "agent/spawn",
          output: {
            agents: [
              {
                nickname: "frontend_analysis",
                status: "running",
                taskId: "child-frontend",
              },
            ],
          },
          status: "running",
          type: "tool",
        },
        {
          id: "wait",
          input: {},
          name: "agent/wait",
          output: {
            agents: [
              { status: "completed", taskId: "child-frontend" },
              { status: "running", taskId: "child-tests" },
            ],
          },
          status: "running",
          type: "tool",
        },
      ],
      startedAt: "2026-07-27T00:00:00.000Z",
      status: "running",
    },
  ],
  turnsNextCursor: null,
  updatedAt: "2026-07-27T00:01:00.000Z",
};

describe("collectSubagents", () => {
  it("deduplicates child tasks while preserving spawn metadata and latest status", () => {
    expect(collectSubagents(snapshot)).toEqual([
      {
        model: "gpt-5.6-sol",
        nickname: "frontend_analysis",
        reasoningEffort: "high",
        status: "completed",
        taskId: "child-frontend",
      },
      {
        nickname: "子代理 2",
        status: "running",
        taskId: "child-tests",
      },
    ]);
  });

  it("keeps completed subagents until an explicit close operation removes them", () => {
    const completedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "idle",
      turns: snapshot.turns.map((turn) => ({
        ...turn,
        completedAt: snapshot.updatedAt,
        status: "completed",
      })),
    };
    expect(collectSubagents(completedSnapshot).map((subagent) => subagent.nickname)).toEqual([
      "frontend_analysis",
      "子代理 2",
    ]);

    const closedSnapshot: RuntimeTaskSnapshot = {
      ...completedSnapshot,
      turns: [
        ...completedSnapshot.turns,
        {
          completedAt: snapshot.updatedAt,
          error: null,
          id: "turn-close",
          items: [
            {
              id: "close",
              input: {},
              name: "agent/close",
              output: {
                agents: [{ status: "completed", taskId: "child-frontend" }],
              },
              status: "completed",
              type: "tool",
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "completed",
        },
      ],
    };

    expect(collectSubagents(closedSnapshot)).toEqual([
      { nickname: "子代理 2", status: "running", taskId: "child-tests" },
    ]);
  });
});
