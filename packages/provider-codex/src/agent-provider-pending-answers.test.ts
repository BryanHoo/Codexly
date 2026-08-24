import { describe, expect, it } from "vitest";
import type { PendingRequestResolutionError } from "@codexly/core";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider pending request answers", () => {
  it("maps file denial and semantic user input answers", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: unknown[] = [];
    provider.subscribeEvents((event) => {
      if (event.type === "pending_request.created") {
        requests.push(event.payload.request);
      }
    });
    await provider.listTasks();

    rpc.emitServerRequest("file-1", "item/fileChange/requestApproval", {
      grantRoot: "/workspace/Codexly",
      itemId: "file-item",
      reason: null,
      startedAtMs: 1_753_228_801_000,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitServerRequest("input-1", "item/tool/requestUserInput", {
      autoResolutionMs: 30_000,
      isBlocking: false,
      itemId: "input-item",
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
        {
          header: "说明",
          id: "note",
          isOther: false,
          isSecret: false,
          options: null,
          question: "补充说明",
        },
        {
          header: "替代方案",
          id: "alternative",
          isOther: true,
          isSecret: false,
          options: [
            { description: "继续", label: "Yes" },
            { description: "停止", label: "No" },
          ],
          question: "是否采用预设方案？",
        },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(requests).toEqual([
      expect.objectContaining({ requestId: "string:file-1", type: "file_change_approval" }),
      expect.objectContaining({
        questions: [
          expect.objectContaining({ id: "confirm", type: "confirmation" }),
          expect.objectContaining({ id: "note", type: "short_text" }),
          expect.objectContaining({ id: "alternative", isOther: true, type: "choice" }),
        ],
        requestId: "string:input-1",
        type: "user_input",
      }),
    ]);
    const fileRequest = requests[0] as {
      itemId: string;
      projectId: string;
      requestId: string;
      taskId: string;
      turnId: string;
      type: "file_change_approval";
    };
    await provider.resolvePendingRequest({
      itemId: fileRequest.itemId,
      projectId: fileRequest.projectId,
      requestId: fileRequest.requestId,
      resolution: { decision: "deny" },
      taskId: fileRequest.taskId,
      turnId: fileRequest.turnId,
      type: fileRequest.type,
    });
    const inputRequest = requests[1] as {
      itemId: string;
      projectId: string;
      requestId: string;
      taskId: string;
      turnId: string;
      type: "user_input";
    };
    await provider.resolvePendingRequest({
      itemId: inputRequest.itemId,
      projectId: inputRequest.projectId,
      requestId: inputRequest.requestId,
      resolution: {
        answers: { alternative: ["自定义方案"], confirm: ["Yes"], note: ["继续"] },
      },
      taskId: inputRequest.taskId,
      turnId: inputRequest.turnId,
      type: inputRequest.type,
    });

    expect(rpc.serverResponses).toEqual([
      { id: "file-1", result: { decision: "decline" } },
      {
        id: "input-1",
        result: {
          answers: {
            alternative: { answers: ["自定义方案"] },
            confirm: { answers: ["Yes"] },
            note: { answers: ["继续"] },
          },
        },
      },
    ]);
  });

  it("applies Codex defaults to optional user input fields", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const requests: unknown[] = [];
    provider.subscribeEvents((event) => {
      if (event.type === "pending_request.created") {
        requests.push(event.payload.request);
      }
    });
    await provider.listTasks();

    rpc.emitServerRequest("input-defaults", "item/tool/requestUserInput", {
      isBlocking: true,
      itemId: "input-defaults-item",
      questions: [{ header: "说明", id: "note", question: "补充说明" }],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        expiresAt: null,
        questions: [
          {
            header: "说明",
            id: "note",
            isOther: false,
            isSecret: false,
            options: [],
            prompt: "补充说明",
            type: "short_text",
          },
        ],
        requestId: "string:input-defaults",
        type: "user_input",
      }),
    ]);
  });

  it("rejects answers outside fixed user input options", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.listTasks();
    rpc.emitServerRequest("input-fixed", "item/tool/requestUserInput", {
      autoResolutionMs: null,
      isBlocking: true,
      itemId: "input-fixed-item",
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
      turnId: "turn-1",
    });

    await expect(
      provider.resolvePendingRequest({
        itemId: "input-fixed-item",
        projectId: project.id,
        requestId: "string:input-fixed",
        resolution: { answers: { confirm: ["INVALID"] } },
        taskId: "task-1",
        turnId: "turn-1",
        type: "user_input",
      }),
    ).rejects.toMatchObject({ code: "mismatch" } satisfies Partial<PendingRequestResolutionError>);
    expect(rpc.serverResponses).toEqual([]);
  });

  it("expires requests once when Codex clears them or their turn ends", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();
    const emitApproval = (id: number, itemId: string, turnId: string) => {
      rpc.emitServerRequest(id, "item/fileChange/requestApproval", {
        itemId,
        startedAtMs: 1_753_228_801_000,
        threadId: "task-1",
        turnId,
      });
    };
    emitApproval(1, "file-1", "turn-1");
    rpc.emitNotification("serverRequest/resolved", { requestId: 1, threadId: "task-1" });
    rpc.emitNotification("serverRequest/resolved", { requestId: 1, threadId: "task-1" });
    emitApproval(2, "file-2", "turn-2");
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        completedAt: 1_753_228_802,
        error: null,
        id: "turn-2",
        items: [],
        startedAt: 1_753_228_800,
        status: "interrupted",
      },
    });

    expect(
      events.filter((event) => (event as { type: string }).type === "pending_request.expired"),
    ).toHaveLength(2);
    expect(rpc.serverResponses).toEqual([]);
  });
});
