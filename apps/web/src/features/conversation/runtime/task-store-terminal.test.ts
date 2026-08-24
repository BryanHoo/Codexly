import { describe, expect, it } from "vitest";
import { createTaskStore } from "./task-store.js";
import {
  timestamp,
  readTurnItemIds,
  createResponse,
  eventEnvelope,
} from "./task-store.test-support.js";

describe("task store terminal state", () => {
  it("keeps streamed reviewer operations when the terminal review projection arrives", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "review-mode-turn-running",
        payload: {
          item: {
            id: "review-mode-turn-running",
            target: { type: "uncommitted_changes" },
            type: "review",
          },
        },
        turnId: "turn-running",
        type: "item.started",
      },
      {
        ...eventEnvelope(12),
        itemId: "review-command",
        payload: {
          item: {
            command: "git diff",
            cwd: "/workspace",
            id: "review-command",
            outputTruncated: false,
            status: "completed",
            type: "command",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
      {
        ...eventEnvelope(13),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [
              {
                id: "review-mode-turn-running",
                target: { type: "uncommitted_changes" },
                type: "review",
              },
              {
                id: "review-result",
                role: "assistant",
                text: "审查完成。",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().reconstructSnapshot()?.turns[1]).toMatchObject({
      completedAt: "2026-07-28T00:00:02.000Z",
      items: [
        { role: "assistant", text: "开始", type: "message" },
        { type: "review" },
        { id: "review-command", type: "command" },
        { role: "assistant", text: "审查完成。", type: "message" },
      ],
      status: "completed",
    });
  });

  it("clears a retrying provider error after the turn resumes output", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { message: "连接暂时中断", willRetry: true },
        turnId: "turn-running",
        type: "provider.error",
      },
    ]);
    expect(store.getState().turnsById["turn-running"]?.error).toBe("连接暂时中断");

    store.getState().applyEvents([
      {
        ...eventEnvelope(12),
        itemId: "message-running",
        payload: { delta: "，连接恢复后继续输出" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);

    expect(store.getState().turnsById["turn-running"]).toMatchObject({
      error: null,
      status: "running",
    });
    expect(store.getState().getItem("message-running", "turn-running")).toMatchObject({
      text: "开始，连接恢复后继续输出",
    });
  });

  it("preserves streamed assistant content when an interrupted terminal payload is partial", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "message-running",
        payload: { delta: "，但保留这段回复" },
        turnId: "turn-running",
        type: "message.delta",
      },
      {
        ...eventEnvelope(12),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [],
            startedAt: timestamp,
            status: "interrupted",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().reconstructSnapshot()?.turns[1]).toMatchObject({
      items: [{ id: "message-running", text: "开始，但保留这段回复" }],
      status: "interrupted",
    });
  });

  it("preserves completed tools when the terminal turn payload omits them", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "tool-read-file",
        payload: {
          item: {
            id: "tool-read-file",
            input: { path: "package.json" },
            name: "read_file",
            output: { content: "Codexly" },
            status: "completed",
            type: "tool",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
      {
        ...eventEnvelope(12),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [
              {
                id: "message-running",
                role: "assistant",
                text: "执行完成",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().reconstructSnapshot()?.turns[1]).toMatchObject({
      items: [
        { id: "message-running", text: "执行完成" },
        { id: "tool-read-file", name: "read_file", status: "completed" },
      ],
      status: "completed",
    });
  });

  it("uses terminal item order while replacing the submitted user placeholder", () => {
    const submittedUserItemId = "submitted-user-turn-running";
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              {
                id: submittedUserItemId,
                role: "user",
                text: "执行检查",
                type: "message",
              },
              {
                id: "message-running",
                role: "assistant",
                text: "正在处理",
                type: "message",
              },
              {
                detail: "读取配置",
                id: "activity-running",
                label: "分析项目",
                status: "completed",
                type: "activity",
              },
              {
                id: "tool-read-file",
                input: { path: "package.json" },
                name: "read_file",
                output: { content: "Codexly" },
                status: "completed",
                type: "tool",
              },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          turn: {
            completedAt: "2026-07-28T00:00:02.000Z",
            error: null,
            id: "turn-running",
            items: [
              {
                id: "provider-user-item",
                role: "user",
                text: "执行检查",
                type: "message",
              },
              {
                id: "message-running",
                role: "assistant",
                text: "正在处理",
                type: "message",
              },
              {
                id: "message-completed",
                role: "assistant",
                text: "执行完成",
                type: "message",
              },
              {
                id: "tool-read-file",
                input: { path: "package.json" },
                name: "read_file",
                output: { content: "Codexly" },
                status: "completed",
                type: "tool",
              },
            ],
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(readTurnItemIds(store, "turn-running")).toEqual([
      "provider-user-item",
      "message-running",
      "activity-running",
      "message-completed",
      "tool-read-file",
    ]);
    expect(store.getState().getItem(submittedUserItemId, "turn-running")).toBeUndefined();
  });

  it("replaces a submitted user placeholder when the provider item starts", () => {
    const submittedUserItemId = "submitted-user-turn-running";
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              {
                id: submittedUserItemId,
                role: "user",
                text: "执行检查",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "provider-user-item",
        payload: {
          item: {
            id: "provider-user-item",
            role: "user",
            text: "执行检查",
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.started",
      },
    ]);

    expect(readTurnItemIds(store, "turn-running")).toEqual(["provider-user-item"]);
    expect(store.getState().getItem(submittedUserItemId, "turn-running")).toBeUndefined();
  });

  it("merges a realtime expanded skill into the provider user message", () => {
    const submittedUserItemId = "submitted-user-turn-running";
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              {
                id: submittedUserItemId,
                role: "user",
                skills: [{ name: "superwork:superwork-init" }],
                text: "",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "provider-user-item",
        payload: {
          item: {
            id: "provider-user-item",
            role: "user",
            text: ["$superwork:superwork-init", "$superwork:superwork-init", "继续执行检查"].join(
              "\n",
            ),
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
      {
        ...eventEnvelope(12),
        itemId: "provider-skill-item",
        payload: {
          item: {
            id: "provider-skill-item",
            role: "user",
            skills: [{ name: "superwork:superwork-init" }],
            text: "",
            type: "message",
          },
        },
        turnId: "turn-running",
        type: "item.completed",
      },
    ]);

    expect(readTurnItemIds(store, "turn-running")).toEqual(["provider-user-item"]);
    expect(store.getState().getItem("provider-user-item", "turn-running")).toMatchObject({
      skills: [{ name: "superwork:superwork-init" }],
      text: "继续执行检查",
    });
    expect(store.getState().getItem("provider-skill-item", "turn-running")).toBeUndefined();
  });
});
