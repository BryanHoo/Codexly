import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentEventSchema,
  AgentTaskSnapshotResponseSchema,
  ConnectionReadySchema,
  EventBatchSchema,
  EventStreamMessageSchema,
  MAX_EVENT_BATCH_SIZE,
  ResyncRequiredSchema,
} from "./agent-event.js";

const messageItem = {
  id: "item-1",
  role: "assistant",
  text: "完成",
  type: "message",
} as const;

const completedTurn = {
  completedAt: "2026-07-23T00:00:01.000Z",
  error: null,
  id: "turn-1",
  items: [messageItem],
  startedAt: "2026-07-23T00:00:00.000Z",
  status: "completed",
} as const;

const baseEvent = {
  provider: "codex",
  sequence: 1,
  sessionId: "runtime-1",
  taskId: "task-1",
  timestamp: "2026-07-23T00:00:00.000Z",
  version: 2,
} as const;

const pendingRequest = {
  availableDecisions: ["allow", "deny"],
  command: "pnpm check",
  createdAt: "2026-07-23T00:00:00.000Z",
  cwd: "/workspace/Codexly",
  expiresAt: null,
  itemId: "item-approval",
  networkAccess: null,
  projectId: "codexly",
  reason: null,
  requestId: "number:7",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "command_approval",
} as const;

describe("Agent Event v2 protocol", () => {
  it("validates every supported event variant", () => {
    const events = [
      {
        ...baseEvent,
        payload: {
          turn: { ...completedTurn, completedAt: null, items: [], status: "running" },
        },
        turnId: "turn-1",
        type: "turn.started",
      },
      {
        ...baseEvent,
        payload: {},
        type: "queue.changed",
      },
      {
        ...baseEvent,
        payload: { rootPath: "/workspace/Codexly" },
        taskId: "codexly",
        type: "project.git_metadata_changed",
      },
      {
        ...baseEvent,
        itemId: "item-1",
        payload: { delta: "流式文本" },
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        ...baseEvent,
        itemId: "item-2",
        payload: { delta: "推理", field: "summary" },
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        ...baseEvent,
        itemId: "item-3",
        payload: { delta: "Done\n" },
        turnId: "turn-1",
        type: "command.output_delta",
      },
      {
        ...baseEvent,
        itemId: "plan-1",
        payload: { delta: "## 实施计划" },
        turnId: "turn-1",
        type: "plan.delta",
      },
      {
        ...baseEvent,
        itemId: "reasoning-1",
        payload: { delta: "核对协议", field: "summary", sectionIndex: 1 },
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        ...baseEvent,
        itemId: "mcp-1",
        payload: { message: "正在读取资源" },
        turnId: "turn-1",
        type: "tool.progress",
      },
      {
        ...baseEvent,
        itemId: "patch-1",
        payload: {
          changes: [{ diff: "+const ready = true;", kind: "update", path: "src/app.ts" }],
          originalByteLength: 20,
          truncated: false,
        },
        turnId: "turn-1",
        type: "file_change.updated",
      },
      {
        ...baseEvent,
        payload: {
          code: "model_verification",
          level: "warning",
          message: "需要完成模型访问验证",
        },
        type: "task.notice",
      },
      {
        ...baseEvent,
        payload: {
          code: "strict_review_required",
          level: "warning",
          message: "严格审核已启用",
        },
        type: "task.notice",
      },
      {
        ...baseEvent,
        payload: {
          error: null,
          failureReason: null,
          name: "context7",
          status: "starting",
        },
        type: "mcp_server.status_updated",
      },
      {
        ...baseEvent,
        itemId: "item-1",
        payload: { item: messageItem },
        turnId: "turn-1",
        type: "item.started",
      },
      {
        ...baseEvent,
        itemId: "item-1",
        payload: { item: messageItem },
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        ...baseEvent,
        payload: { turn: completedTurn },
        turnId: "turn-1",
        type: "turn.completed",
      },
      {
        ...baseEvent,
        payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
        turnId: "turn-1",
        type: "usage.updated",
      },
      {
        ...baseEvent,
        payload: {
          plan: {
            explanation: "先打通协议，再完成界面。",
            steps: [
              { status: "completed", text: "定义协议" },
              { status: "in_progress", text: "接入右栏" },
              { status: "pending", text: "完成验证" },
            ],
          },
        },
        turnId: "turn-1",
        type: "plan.updated",
      },
      {
        ...baseEvent,
        payload: {
          code: "usage_limit_exceeded",
          httpStatusCode: 429,
          message: "模型服务不可用",
          willRetry: false,
        },
        turnId: "turn-1",
        type: "provider.error",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: pendingRequest },
        turnId: pendingRequest.turnId,
        type: "pending_request.created",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: { ...pendingRequest, status: "resolved" } },
        turnId: pendingRequest.turnId,
        type: "pending_request.resolved",
      },
      {
        ...baseEvent,
        itemId: pendingRequest.itemId,
        payload: { request: { ...pendingRequest, status: "expired" } },
        turnId: pendingRequest.turnId,
        type: "pending_request.expired",
      },
    ];

    expect(events.every((event) => Value.Check(AgentEventSchema, event))).toBe(true);
  });

  it("validates strict Project Git metadata invalidation payloads", () => {
    const event = {
      ...baseEvent,
      payload: { rootPath: "/workspace/Codexly" },
      taskId: "codexly",
      type: "project.git_metadata_changed",
    };

    expect(Value.Check(AgentEventSchema, event)).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...event,
        payload: { ...event.payload, changedPaths: ["/workspace/Codexly/.git/HEAD"] },
      }),
    ).toBe(false);
  });

  it("requires bounded realtime diff metadata and limits file change counts", () => {
    const fileChangeEvent = {
      ...baseEvent,
      itemId: "patch-1",
      payload: {
        changes: [{ diff: "+updated", kind: "update", path: "src/app.ts" }],
        originalByteLength: 8,
        truncated: false,
      },
      turnId: "turn-1",
      type: "file_change.updated",
    };
    expect(Value.Check(AgentEventSchema, fileChangeEvent)).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...fileChangeEvent,
        payload: { changes: fileChangeEvent.payload.changes },
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentEventSchema, {
        ...fileChangeEvent,
        payload: {
          ...fileChangeEvent.payload,
          changes: Array.from({ length: 101 }, (_, index) => ({
            diff: `+${String(index)}`,
            kind: "update",
            path: `src/${String(index)}.ts`,
          })),
        },
      }),
    ).toBe(false);
  });

  it("validates structured runtime status items", () => {
    const events = [
      {
        ...baseEvent,
        itemId: "runtime-safety-turn-1",
        payload: {
          item: {
            fasterModel: "gpt-5.6-mini",
            id: "runtime-safety-turn-1",
            kind: "safety_buffering",
            model: "gpt-5.6-sol",
            status: "running",
            type: "runtime_status",
          },
        },
        turnId: "turn-1",
        type: "item.started",
      },
      {
        ...baseEvent,
        itemId: "runtime-reroute-turn-1",
        payload: {
          item: {
            fromModel: "gpt-5.6-sol",
            id: "runtime-reroute-turn-1",
            kind: "model_rerouted",
            status: "completed",
            toModel: "gpt-5.6-mini",
            type: "runtime_status",
          },
        },
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        ...baseEvent,
        itemId: "hook-hook-1",
        payload: {
          item: {
            detail: "检查未通过",
            durationMs: 120,
            eventName: "afterToolUse",
            id: "hook-hook-1",
            kind: "hook",
            status: "failed",
            type: "runtime_status",
          },
        },
        turnId: "turn-1",
        type: "item.completed",
      },
    ];

    expect(events.every((event) => Value.Check(AgentEventSchema, event))).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...events[0],
        payload: { item: { ...events[0]?.payload.item, sourcePath: "/Users/example/hook.ts" } },
      }),
    ).toBe(false);
  });

  it("validates connection control frames and snapshot checkpoints", () => {
    const ready = {
      latestSequence: 7,
      sessionId: "runtime-1",
      type: "connection.ready",
      version: 3,
    };
    const resync = {
      latestSequence: 7,
      reason: "event_retention_exceeded",
      sessionId: "runtime-1",
      type: "resync.required",
      version: 3,
    };
    const response = {
      checkpoint: { sequence: 7, sessionId: "runtime-1" },
      snapshot: {
        contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
        goal: null,
        id: "task-1",
        plan: {
          explanation: null,
          steps: [{ status: "completed", text: "定义协议" }],
        },
        pinned: false,
        pendingRequests: [pendingRequest],
        projectId: "codexly",
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        status: "idle",
        title: "实时链路",
        turns: [],
        turnsNextCursor: "older-turns",
        updatedAt: "2026-07-23T00:00:00.000Z",
      },
    };

    expect(Value.Check(ConnectionReadySchema, ready)).toBe(true);
    expect(Value.Check(ResyncRequiredSchema, resync)).toBe(true);
    expect(Value.Check(EventStreamMessageSchema, ready)).toBe(true);
    expect(Value.Check(EventStreamMessageSchema, resync)).toBe(true);
    expect(Value.Check(AgentTaskSnapshotResponseSchema, response)).toBe(true);
    expect(
      Value.Check(AgentTaskSnapshotResponseSchema, {
        ...response,
        snapshot: {
          ...response.snapshot,
          pendingRequests: [{ ...pendingRequest, status: "resolved" }],
        },
      }),
    ).toBe(false);
  });

  it("validates bounded version 3 event batches", () => {
    const event = {
      ...baseEvent,
      itemId: "item-1",
      payload: { delta: "text" },
      turnId: "turn-1",
      type: "message.delta",
    };
    const batch = {
      events: Array.from({ length: MAX_EVENT_BATCH_SIZE }, () => event),
      type: "events.batch",
      version: 3,
    };

    expect(Value.Check(EventBatchSchema, batch)).toBe(true);
    expect(Value.Check(EventStreamMessageSchema, batch)).toBe(true);
    expect(Value.Check(EventBatchSchema, { ...batch, events: [] })).toBe(false);
    expect(Value.Check(EventBatchSchema, { ...batch, events: [...batch.events, event] })).toBe(
      false,
    );
    expect(Value.Check(EventBatchSchema, { ...batch, extra: true })).toBe(false);
    expect(Value.Check(EventStreamMessageSchema, event)).toBe(false);
  });

  it("rejects pending request lifecycle events with contradictory statuses", () => {
    const event = {
      ...baseEvent,
      itemId: pendingRequest.itemId,
      payload: { request: pendingRequest },
      turnId: pendingRequest.turnId,
    };

    expect(Value.Check(AgentEventSchema, { ...event, type: "pending_request.created" })).toBe(true);
    expect(Value.Check(AgentEventSchema, { ...event, type: "pending_request.resolved" })).toBe(
      false,
    );
    expect(
      Value.Check(AgentEventSchema, {
        ...event,
        payload: { request: { ...pendingRequest, status: "expired" } },
        type: "pending_request.expired",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentEventSchema, {
        ...event,
        payload: { request: { ...pendingRequest, status: "resolved" } },
        type: "pending_request.expired",
      }),
    ).toBe(false);
  });

  it("rejects invalid versions, sequences, discriminants, and extra fields", () => {
    const valid = {
      ...baseEvent,
      itemId: "item-1",
      payload: { delta: "text" },
      turnId: "turn-1",
      type: "message.delta",
    };

    expect(Value.Check(AgentEventSchema, { ...valid, sequence: -1 })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, version: 1 })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, type: "native.delta" })).toBe(false);
    expect(Value.Check(AgentEventSchema, { ...valid, nativeItem: {} })).toBe(false);
    expect(
      Value.Check(ResyncRequiredSchema, {
        latestSequence: 1,
        reason: "unknown",
        sessionId: "runtime-1",
        type: "resync.required",
        version: 3,
      }),
    ).toBe(false);
  });
});
