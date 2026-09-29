import { Type, type TProperties } from "@sinclair/typebox";

import { DateTimeSchema } from "./project-entity.js";

// 公共信封由两端共用；桌面接收时间仅由桌面协议扩展。
export const AgentEventEnvelopeProperties = {
  provider: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 0 }),
  sessionId: Type.String({ minLength: 1 }),
  taskId: Type.String({ minLength: 1 }),
  timestamp: DateTimeSchema,
  version: Type.Literal(2),
};

function createEventSchema<T extends TProperties>(properties: T) {
  return Type.Object(
    { ...AgentEventEnvelopeProperties, ...properties },
    { additionalProperties: false },
  );
}

export const MessageDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("message.delta"),
});

export const PlanDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("plan.delta"),
});

export const ToolProgressEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object(
    { message: Type.String({ maxLength: 8_192 }) },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("tool.progress"),
});

export const TaskNoticeEventSchema = createEventSchema({
  payload: Type.Object(
    {
      code: Type.Union([
        Type.Literal("runtime_warning"),
        Type.Literal("guardian_warning"),
        Type.Literal("strict_review_required"),
        Type.Literal("model_verification"),
        Type.Literal("hook_status"),
      ]),
      level: Type.Union([Type.Literal("info"), Type.Literal("warning")]),
      message: Type.String({ maxLength: 8_192, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  type: Type.Literal("task.notice"),
});

export const TaskStatusUpdatedEventSchema = createEventSchema({
  payload: Type.Object(
    {
      status: Type.Union([Type.Literal("idle"), Type.Literal("running"), Type.Literal("failed")]),
    },
    { additionalProperties: false },
  ),
  type: Type.Literal("task.status_updated"),
});

export const TaskRemovedEventSchema = createEventSchema({
  payload: Type.Object(
    { reason: Type.Union([Type.Literal("archived"), Type.Literal("deleted")]) },
    { additionalProperties: false },
  ),
  type: Type.Literal("task.removed"),
});

export const SkillsChangedEventSchema = createEventSchema({
  payload: Type.Object({}, { additionalProperties: false }),
  type: Type.Literal("skills.changed"),
});

export const QueueChangedEventSchema = createEventSchema({
  payload: Type.Object({}, { additionalProperties: false }),
  type: Type.Literal("queue.changed"),
});

export const ProjectGitMetadataChangedEventSchema = createEventSchema({
  payload: Type.Object(
    { rootPath: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  type: Type.Literal("project.git_metadata_changed"),
});

export const CommandOutputDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("command.output_delta"),
});

export const ProviderErrorEventSchema = createEventSchema({
  payload: Type.Object(
    {
      code: Type.Optional(
        Type.Union([
          Type.Literal("context_window_exceeded"),
          Type.Literal("session_budget_exceeded"),
          Type.Literal("usage_limit_exceeded"),
          Type.Literal("rate_limit_exceeded"),
          Type.Literal("flex_unavailable"),
          Type.Literal("server_overloaded"),
          Type.Literal("policy_blocked"),
          Type.Literal("connection_failed"),
          Type.Literal("internal_error"),
          Type.Literal("unauthorized"),
          Type.Literal("bad_request"),
          Type.Literal("sandbox_error"),
          Type.Literal("other"),
        ]),
      ),
      httpStatusCode: Type.Optional(Type.Integer({ maximum: 599, minimum: 100 })),
      message: Type.String({ minLength: 1 }),
      willRetry: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("provider.error"),
});

export const GoalClearedEventSchema = createEventSchema({
  payload: Type.Object({}, { additionalProperties: false }),
  type: Type.Literal("goal.cleared"),
});
