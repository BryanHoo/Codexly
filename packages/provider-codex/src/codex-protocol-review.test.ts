import { describe, expect, it } from "vitest";
import { mapAgentTurn, mapAgentTurns } from "./codex-protocol-mapping.js";
import "./codex-protocol-mapping.test-support.js";

describe("Codex review protocol mapping", () => {
  it("projects a completed Codex review to one request and one authoritative result", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "review-turn",
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
          {
            id: "review-result",
            review: "- [P1] 修复消息顺序。",
            type: "exitedReviewMode",
          },
          {
            delivery: null,
            id: "review-agent-result",
            phase: "final_answer",
            text: "- [P1] 修复消息顺序。",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      }),
    ).toMatchObject({
      items: [
        { id: "review-mode-review-turn", type: "review" },
        {
          id: "review-result",
          role: "assistant",
          text: "- [P1] 修复消息顺序。",
          type: "message",
        },
      ],
    });
  });

  it("uses one terminal agent message when an interrupted review has no review text", () => {
    expect(
      mapAgentTurn({
        completedAt: 1_753_228_830,
        error: null,
        id: "interrupted-review-turn",
        items: [
          { id: "review-mode", review: "current changes", type: "enteredReviewMode" },
          {
            delivery: null,
            id: "review-commentary",
            phase: "commentary",
            text: "正在审查。",
            type: "agentMessage",
          },
          { id: "review-exit", review: null, type: "exitedReviewMode" },
          {
            delivery: null,
            id: "review-interrupted",
            phase: null,
            text: "Review was interrupted.",
            type: "agentMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "interrupted",
      }),
    ).toMatchObject({
      items: [
        { type: "review" },
        {
          id: "review-interrupted",
          role: "assistant",
          text: "Review was interrupted.",
          type: "message",
        },
      ],
      status: "interrupted",
    });
  });

  it("folds the persisted reviewer worker into one running review turn", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: null,
          error: null,
          id: "review-outer-turn",
          items: [{ id: "review-entered", review: "current changes", type: "enteredReviewMode" }],
          startedAt: null,
          status: "completed",
        },
        {
          completedAt: null,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt-1",
              type: "userMessage",
            },
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt-2",
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
        },
      ]),
    ).toMatchObject([
      {
        completedAt: null,
        id: "review-outer-turn",
        items: [
          { id: "review-mode-review-outer-turn", type: "review" },
          { id: "review-command", type: "command" },
        ],
        startedAt: "2025-07-23T00:00:00.000Z",
        status: "running",
      },
    ]);
  });

  it("keeps only the worker interruption when both review turns terminate", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: 1_753_228_830,
          error: null,
          id: "review-outer-turn",
          items: [
            { id: "review-entered", review: "current changes", type: "enteredReviewMode" },
            {
              id: "review-failed",
              review: "Reviewer failed to output a response.",
              type: "exitedReviewMode",
            },
          ],
          startedAt: null,
          status: "interrupted",
        },
        {
          completedAt: null,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt",
              type: "userMessage",
            },
            {
              delivery: null,
              id: "review-interrupted",
              phase: null,
              text: "Review was interrupted. Please re-run /review and wait for it to complete.",
              type: "agentMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "interrupted",
        },
      ]),
    ).toMatchObject([
      {
        completedAt: "2025-07-23T00:00:30.000Z",
        id: "review-outer-turn",
        items: [
          { type: "review" },
          {
            text: "Review was interrupted. Please re-run /review and wait for it to complete.",
            type: "message",
          },
        ],
        status: "interrupted",
      },
    ]);
  });

  it("keeps a persisted review running until the outer turn exits review mode", () => {
    expect(
      mapAgentTurns([
        {
          completedAt: null,
          error: null,
          id: "review-outer-turn",
          items: [{ id: "review-entered", review: "current changes", type: "enteredReviewMode" }],
          startedAt: null,
          status: "completed",
        },
        {
          completedAt: 1_753_228_810,
          error: null,
          id: "review-worker-turn",
          items: [
            {
              content: [
                {
                  text: "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
                  type: "text",
                },
              ],
              id: "review-prompt",
              type: "userMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "completed",
        },
      ]),
    ).toMatchObject([
      {
        completedAt: null,
        id: "review-outer-turn",
        status: "running",
      },
    ]);
  });
});
