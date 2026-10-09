import { Value } from "@sinclair/typebox/value";
import {
  AgentTaskBaseSchema,
  AgentMessagePhaseSchema as SharedMessagePhaseSchema,
  AgentEventEnvelopeProperties,
  MessageDeltaEventSchema as SharedMessageDeltaEventSchema,
  ProviderErrorEventSchema as SharedProviderErrorEventSchema,
  ProjectRootSchema as SharedProjectRootSchema,
  ProjectSchema as SharedProjectSchema,
} from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import { AgentTaskSchema, AgentMessagePhaseSchema } from "./agent-attachments.js";
import {
  MessageDeltaEventSchema,
  ProviderErrorEventSchema,
  TurnStartedEventSchema,
} from "./agent-event.js";
import { ProjectSchema } from "./project-files.js";
import { ProjectRootSchema } from "./project-root.js";

describe("共享契约与桌面扩展", () => {
  it("两端共用消息阶段，并接受非终态的部分答案", () => {
    expect(AgentMessagePhaseSchema).toBe(SharedMessagePhaseSchema);
    expect(Value.Check(AgentMessagePhaseSchema, "partial_answer")).toBe(true);
  });
  it("项目实体和根目录引用同一共享 Schema", () => {
    expect(ProjectSchema).toBe(SharedProjectSchema);
    expect(ProjectRootSchema).toBe(SharedProjectRootSchema);
  });

  it("任务复用公共字段，同时桌面任务不要求服务端扩展字段", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "project-1",
      title: "Task",
      updatedAt: "2026-09-27T00:00:00.000Z",
    };

    expect(Value.Check(AgentTaskBaseSchema, task)).toBe(true);
    expect(Value.Check(AgentTaskSchema, task)).toBe(true);
    expect(AgentTaskSchema.properties.id).toBe(AgentTaskBaseSchema.properties.id);
    expect(AgentTaskSchema.properties.updatedAt).toBe(AgentTaskBaseSchema.properties.updatedAt);
  });

  it("事件沿用公共信封，并在桌面扩展接收时间", () => {
    expect(TurnStartedEventSchema.properties.sequence).toBe(AgentEventEnvelopeProperties.sequence);
    expect(TurnStartedEventSchema.properties.receivedAtUnixMs).toMatchObject({
      minimum: 0,
    });
    expect(MessageDeltaEventSchema.properties.payload).toBe(
      SharedMessageDeltaEventSchema.properties.payload,
    );
    expect(ProviderErrorEventSchema.properties.payload).toBe(
      SharedProviderErrorEventSchema.properties.payload,
    );
    const event = {
      itemId: "item-1",
      payload: { delta: "text" },
      provider: "codex",
      receivedAtUnixMs: 1,
      sequence: 1,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-27T00:00:00.000Z",
      turnId: "turn-1",
      type: "message.delta",
      version: 2,
    };
    expect(Value.Check(MessageDeltaEventSchema, event)).toBe(true);
    expect(Value.Check(SharedMessageDeltaEventSchema, event)).toBe(false);
  });
});
