import { Type, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import {
  AgentEventEnvelopeProperties,
  CommandOutputDeltaEventSchema as SharedCommandOutputDeltaEventSchema,
  GoalClearedEventSchema as SharedGoalClearedEventSchema,
  MessageDeltaEventSchema as SharedMessageDeltaEventSchema,
  PlanDeltaEventSchema as SharedPlanDeltaEventSchema,
  ProjectGitMetadataChangedEventSchema as SharedProjectGitMetadataChangedEventSchema,
  ProviderErrorEventSchema as SharedProviderErrorEventSchema,
  QueueChangedEventSchema as SharedQueueChangedEventSchema,
  SkillsChangedEventSchema as SharedSkillsChangedEventSchema,
  TaskNoticeEventSchema as SharedTaskNoticeEventSchema,
  TaskRemovedEventSchema as SharedTaskRemovedEventSchema,
  TaskStatusUpdatedEventSchema as SharedTaskStatusUpdatedEventSchema,
  ToolProgressEventSchema as SharedToolProgressEventSchema,
} from "@codexly/protocol/event-common";

import { EventCheckpointSchema } from "./event-checkpoint.js";
export { EventCheckpointSchema, type EventCheckpoint } from "./event-checkpoint.js";

import {
  ActivePendingRequestSchema,
  AgentContextUsageSchema,
  AgentGoalSchema,
  AgentFileChangeSchema,
  AgentItemSchema,
  AgentMessageSkillSchema,
  AgentMcpServerFailureReasonSchema,
  AgentMcpServerStartupStatusSchema,
  AgentPlanSchema,
  AgentTaskSnapshotSchema,
  AgentTurnSchema,
  ExpiredPendingRequestSchema,
  ResolvedPendingRequestSchema,
} from "./project.js";

const SessionIdSchema = AgentEventEnvelopeProperties.sessionId;
const SequenceSchema = AgentEventEnvelopeProperties.sequence;

export const MAX_REALTIME_DIFF_BYTES = 512 * 1_024;
export const MAX_REALTIME_FILE_CHANGES = 100;

const realtimeDiffMetadataProperties = {
  originalByteLength: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
};

const receivedAtUnixMsSchema = Type.Optional(Type.Number({ minimum: 0 }));
const eventEnvelopeProperties = {
  ...AgentEventEnvelopeProperties,
  // 原生事件到达 WebView 的时间只属于桌面传输协议。
  receivedAtUnixMs: receivedAtUnixMsSchema,
};

function createEventSchema<T extends TProperties>(properties: T) {
  return Type.Object(
    { ...eventEnvelopeProperties, ...properties },
    { additionalProperties: false },
  );
}

function extendSharedEventSchema<T extends TProperties>(schema: TObject<T>) {
  return Type.Object(
    { ...schema.properties, receivedAtUnixMs: receivedAtUnixMsSchema },
    { additionalProperties: false },
  );
}

export const TurnStartedEventSchema = createEventSchema({
  payload: Type.Object({ turn: AgentTurnSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("turn.started"),
});

export const MessageDeltaEventSchema = extendSharedEventSchema(SharedMessageDeltaEventSchema);

export const ReasoningDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ delta: Type.String() }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("reasoning.delta"),
});

export const MessageSkillsUpdatedEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1, maxLength: 1_024 }),
  payload: Type.Object({
    text: Type.String({ maxLength: 1_100_000 }),
    skills: Type.Array(AgentMessageSkillSchema, { maxItems: 128 }),
  }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("message.skills_updated"),
});

export const PlanDeltaEventSchema = extendSharedEventSchema(SharedPlanDeltaEventSchema);

export const ToolProgressEventSchema = extendSharedEventSchema(SharedToolProgressEventSchema);

export const FileChangeUpdatedEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object(
    {
      changes: Type.Array(AgentFileChangeSchema, { maxItems: MAX_REALTIME_FILE_CHANGES }),
      ...realtimeDiffMetadataProperties,
    },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("file_change.updated"),
});

export const TaskNoticeEventSchema = extendSharedEventSchema(SharedTaskNoticeEventSchema);

export const McpServerStatusUpdatedEventSchema = createEventSchema({
  payload: Type.Object(
    {
      error: Type.Union([Type.String({ maxLength: 8_192 }), Type.Null()]),
      failureReason: Type.Union([AgentMcpServerFailureReasonSchema, Type.Null()]),
      name: Type.String({ minLength: 1 }),
      status: AgentMcpServerStartupStatusSchema,
    },
    { additionalProperties: false },
  ),
  type: Type.Literal("mcp_server.status_updated"),
});

export const TaskStatusUpdatedEventSchema = extendSharedEventSchema(
  SharedTaskStatusUpdatedEventSchema,
);

export const TaskMetadataChangedEventSchema = createEventSchema({
  payload: Type.Object(
    { title: Type.Optional(Type.String({ maxLength: 512, minLength: 1 })) },
    { additionalProperties: false },
  ),
  type: Type.Literal("task.metadata_changed"),
});

export const TaskRemovedEventSchema = extendSharedEventSchema(SharedTaskRemovedEventSchema);

export const SkillsChangedEventSchema = extendSharedEventSchema(SharedSkillsChangedEventSchema);

export const QueueChangedEventSchema = extendSharedEventSchema(SharedQueueChangedEventSchema);

export const ProjectGitMetadataChangedEventSchema = extendSharedEventSchema(
  SharedProjectGitMetadataChangedEventSchema,
);

export const CommandOutputDeltaEventSchema = extendSharedEventSchema(
  SharedCommandOutputDeltaEventSchema,
);

export const ItemCompletedEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ item: AgentItemSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("item.completed"),
});

export const ItemStartedEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object({ item: AgentItemSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("item.started"),
});

export const TurnCompletedEventSchema = createEventSchema({
  payload: Type.Object({ turn: AgentTurnSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("turn.completed"),
});

export const ProviderErrorEventSchema = extendSharedEventSchema(SharedProviderErrorEventSchema);

export const UsageUpdatedEventSchema = createEventSchema({
  payload: Type.Object({ usage: AgentContextUsageSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("usage.updated"),
});

export const PlanUpdatedEventSchema = createEventSchema({
  payload: Type.Object({ plan: AgentPlanSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("plan.updated"),
});

export const GoalUpdatedEventSchema = createEventSchema({
  payload: Type.Object({ goal: AgentGoalSchema }, { additionalProperties: false }),
  type: Type.Literal("goal.updated"),
});

export const GoalClearedEventSchema = extendSharedEventSchema(SharedGoalClearedEventSchema);

function createPendingRequestEventSchema<TType extends string, TRequestSchema extends TSchema>(
  type: TType,
  requestSchema: TRequestSchema,
) {
  return createEventSchema({
    itemId: Type.String({ minLength: 1 }),
    payload: Type.Object({ request: requestSchema }, { additionalProperties: false }),
    turnId: Type.String({ minLength: 1 }),
    type: Type.Literal(type),
  });
}

export const PendingRequestCreatedEventSchema = createPendingRequestEventSchema(
  "pending_request.created",
  ActivePendingRequestSchema,
);
export const PendingRequestResolvedEventSchema = createPendingRequestEventSchema(
  "pending_request.resolved",
  ResolvedPendingRequestSchema,
);
export const PendingRequestExpiredEventSchema = createPendingRequestEventSchema(
  "pending_request.expired",
  ExpiredPendingRequestSchema,
);

export const AgentEventSchema = Type.Union([
  TurnStartedEventSchema,
  MessageDeltaEventSchema,
  ReasoningDeltaEventSchema,
  MessageSkillsUpdatedEventSchema,
  CommandOutputDeltaEventSchema,
  PlanDeltaEventSchema,
  ToolProgressEventSchema,
  FileChangeUpdatedEventSchema,
  ItemStartedEventSchema,
  ItemCompletedEventSchema,
  TurnCompletedEventSchema,
  UsageUpdatedEventSchema,
  PlanUpdatedEventSchema,
  GoalUpdatedEventSchema,
  GoalClearedEventSchema,
  ProviderErrorEventSchema,
  TaskNoticeEventSchema,
  McpServerStatusUpdatedEventSchema,
  TaskStatusUpdatedEventSchema,
  TaskMetadataChangedEventSchema,
  TaskRemovedEventSchema,
  SkillsChangedEventSchema,
  QueueChangedEventSchema,
  ProjectGitMetadataChangedEventSchema,
  PendingRequestCreatedEventSchema,
  PendingRequestResolvedEventSchema,
  PendingRequestExpiredEventSchema,
]);

export type AgentEvent = Readonly<Static<typeof AgentEventSchema>>;

export const MAX_EVENT_BATCH_SIZE = 64;

export const EventBatchSchema = Type.Object(
  {
    events: Type.Array(AgentEventSchema, {
      maxItems: MAX_EVENT_BATCH_SIZE,
      minItems: 1,
    }),
    type: Type.Literal("events.batch"),
    version: Type.Literal(3),
  },
  { additionalProperties: false },
);

export type EventBatch = Readonly<Static<typeof EventBatchSchema>>;

export const ConnectionReadySchema = Type.Object(
  {
    latestSequence: SequenceSchema,
    sessionId: SessionIdSchema,
    type: Type.Literal("connection.ready"),
    version: Type.Literal(3),
  },
  { additionalProperties: false },
);

export type ConnectionReady = Readonly<Static<typeof ConnectionReadySchema>>;

export const ResyncRequiredSchema = Type.Object(
  {
    latestSequence: SequenceSchema,
    reason: Type.Union([
      Type.Literal("event_retention_exceeded"),
      Type.Literal("session_changed"),
      Type.Literal("sequence_gap"),
    ]),
    sessionId: SessionIdSchema,
    type: Type.Literal("resync.required"),
    version: Type.Literal(3),
  },
  { additionalProperties: false },
);

export type ResyncRequired = Readonly<Static<typeof ResyncRequiredSchema>>;

export const EventStreamMessageSchema = Type.Union([
  ConnectionReadySchema,
  ResyncRequiredSchema,
  EventBatchSchema,
]);

export type EventStreamMessage = Readonly<Static<typeof EventStreamMessageSchema>>;

export const AgentTaskSnapshotResponseSchema = Type.Object(
  {
    checkpoint: EventCheckpointSchema,
    snapshot: AgentTaskSnapshotSchema,
  },
  { additionalProperties: false },
);

export type AgentTaskSnapshotResponse = Readonly<Static<typeof AgentTaskSnapshotResponseSchema>>;
