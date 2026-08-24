import { describe, expect, it } from "vitest";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider mutations", () => {
  it("maps task and turn mutations to Codex App Server RPC", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-1",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, { turn: runningTurn }, {}]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.startTask()).resolves.toMatchObject({
      id: "task-1",
      projectId: "codexly",
    });
    await expect(
      provider.startTurn(
        "task-1",
        {
          images: [
            {
              mediaType: "image/png",
              url: "data:image/png;base64,aW1hZ2U=",
            },
          ],
          files: [
            {
              mediaType: "application/pdf",
              name: "specification.pdf",
              path: "/tmp/specification.pdf",
            },
          ],
          outputSchema: {
            additionalProperties: false,
            properties: { message: { type: "string" } },
            required: ["message"],
            type: "object",
          },
          skills: [],
          text: "实现写入闭环",
          textAttachments: [{ name: "Pasted text.txt", text: "第一行\n你好" }],
        },
        {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      ),
    ).resolves.toMatchObject({ id: "turn-1", status: "running" });
    await expect(provider.interruptTurn("task-1", "turn-1")).resolves.toBeUndefined();

    expect(rpc.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/workspace/Codexly",
          historyMode: "paginated",
          projectId: project.id,
          runtimeWorkspaceRoots: [projectRootPath],
        },
      },
      {
        method: "turn/start",
        params: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          collaborationMode: {
            mode: "default",
            settings: {
              developer_instructions: null,
              model: "gpt-5.6-sol",
              reasoning_effort: "high",
            },
          },
          input: [
            { text: "实现写入闭环", text_elements: [], type: "text" },
            {
              text: "第一行\n你好",
              text_elements: [
                {
                  byteRange: { end: 16, start: 0 },
                  placeholder: "Pasted text.txt",
                },
              ],
              type: "text",
            },
            {
              text: "/tmp/specification.pdf",
              text_elements: [
                {
                  byteRange: { end: 22, start: 0 },
                  placeholder:
                    "codexly-file:eyJtZWRpYVR5cGUiOiJhcHBsaWNhdGlvbi9wZGYiLCJuYW1lIjoic3BlY2lmaWNhdGlvbi5wZGYifQ",
                },
              ],
              type: "text",
            },
            { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
          ],
          model: "gpt-5.6-sol",
          outputSchema: {
            additionalProperties: false,
            properties: { message: { type: "string" } },
            required: ["message"],
            type: "object",
          },
          effort: "high",
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
      },
      { method: "turn/interrupt", params: { threadId: "task-1", turnId: "turn-1" } },
    ]);
  });

  it("maps restricted and full-access sandbox policies", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-1",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { turn: runningTurn },
      { turn: { ...runningTurn, id: "turn-2" } },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();

    await provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "只读检查", textAttachments: [] },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
    );
    await provider.startTurn(
      "task-1",
      { files: [], images: [], skills: [], text: "完全访问", textAttachments: [] },
      {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "danger-full-access",
      },
    );

    expect(rpc.calls[1]).toMatchObject({
      params: { sandboxPolicy: { networkAccess: false, type: "readOnly" } },
    });
    expect(rpc.calls[2]).toMatchObject({
      params: { sandboxPolicy: { type: "dangerFullAccess" } },
    });
  });

  it("maps task commands to Codex App Server RPC", async () => {
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "review-turn",
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
          id: "review-mode",
          review: "current changes",
          type: "enteredReviewMode",
        },
      ],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      {},
      {},
      { reviewThreadId: "task-1", turn: runningTurn },
      {},
      { thread: nativeThread({ id: "task-2", preview: "续接任务" }) },
      { threadId: "task-1" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();

    await expect(provider.renameTask("task-1", "新的任务名称")).resolves.toBeUndefined();
    await expect(provider.archiveTask("task-1")).resolves.toBeUndefined();
    await expect(
      provider.startReview("task-1", { type: "base_branch", branch: "main" }),
    ).resolves.toMatchObject({
      id: "review-turn",
      items: [
        {
          id: "review-mode-review-turn",
          target: { branch: "main", type: "base_branch" },
          type: "review",
        },
      ],
      status: "running",
    });
    await expect(provider.compactTask("task-1")).resolves.toBeUndefined();
    await expect(provider.forkTask("task-1", "turn-1")).resolves.toMatchObject({ id: "task-2" });
    await expect(
      provider.uploadFeedback("task-1", {
        classification: "other",
        includeLogs: true,
        reason: "体验反馈",
      }),
    ).resolves.toBeUndefined();

    expect(rpc.calls.slice(1)).toEqual([
      {
        method: "thread/name/set",
        params: { name: "新的任务名称", threadId: "task-1" },
      },
      { method: "thread/archive", params: { threadId: "task-1" } },
      {
        method: "review/start",
        params: {
          delivery: "inline",
          target: { type: "baseBranch", branch: "main" },
          threadId: "task-1",
        },
      },
      { method: "thread/compact/start", params: { threadId: "task-1" } },
      {
        method: "thread/fork",
        params: {
          lastTurnId: "turn-1",
          runtimeWorkspaceRoots: [projectRootPath],
          threadId: "task-1",
        },
      },
      {
        method: "feedback/upload",
        params: {
          classification: "other",
          includeLogs: true,
          reason: "体验反馈",
          threadId: "task-1",
        },
      },
    ]);
  });
});
