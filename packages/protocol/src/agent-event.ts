import { Type, type Static, type TProperties, type TSchema } from "@sinclair/typebox";

import { EventCheckpointSchema } from "./event-checkpoint.js";
export { EventCheckpointSchema, type EventCheckpoint } from "./event-checkpoint.js";
import {
  AgentEventEnvelopeProperties,
  CommandOutputDeltaEventSchema,
  GoalClearedEventSchema,
  MessageDeltaEventSchema,
  PlanDeltaEventSchema,
  ProjectGitMetadataChangedEventSchema,
  ProviderErrorEventSchema,
  QueueChangedEventSchema,
  SkillsChangedEventSchema,
  TaskNoticeEventSchema,
  TaskRemovedEventSchema,
  TaskStatusUpdatedEventSchema,
  ToolProgressEventSchema,
} from "./event-common.js";
export {
  AgentEventEnvelopeProperties,
  CommandOutputDeltaEventSchema,
  GoalClearedEventSchema,
  MessageDeltaEventSchema,
  PlanDeltaEventSchema,
  ProjectGitMetadataChangedEventSchema,
  ProviderErrorEventSchema,
  QueueChangedEventSchema,
  SkillsChangedEventSchema,
  TaskNoticeEventSchema,
  TaskRemovedEventSchema,
  TaskStatusUpdatedEventSchema,
  ToolProgressEventSchema,
} from "./event-common.js";

import {
  ActivePendingRequestSchema,
  AgentContextUsageSchema,
  AgentGoalSchema,
  AgentFileChangeSchema,
  AgentItemSchema,
  AgentMcpServerFailureReasonSchema,
  AgentMcpServerStartupStatusSchema,
  AgentPlanSchema,
  AgentTaskSnapshotSchema,
  AgentTurnSchema,
  ExpiredPendingRequestSchema,
  ResolvedPendingRequestSchema,
} from "./project.js";

const SessionIdSchema = Type.String({ minLength: 1 });
const SequenceSchema = Type.Integer({ minimum: 0 });

export const MAX_REALTIME_DIFF_BYTES = 512 * 1_024;
export const MAX_REALTIME_FILE_CHANGES = 100;

const realtimeDiffMetadataProperties = {
  originalByteLength: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
};

function createEventSchema<T extends TProperties>(properties: T) {
  return Type.Object(
    { ...AgentEventEnvelopeProperties, ...properties },
    { additionalProperties: false },
  );
}

export const TurnStartedEventSchema = createEventSchema({
  payload: Type.Object({ turn: AgentTurnSchema }, { additionalProperties: false }),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("turn.started"),
});

export const ReasoningDeltaEventSchema = createEventSchema({
  itemId: Type.String({ minLength: 1 }),
  payload: Type.Object(
    {
      delta: Type.String(),
      field: Type.Union([Type.Literal("content"), Type.Literal("summary")]),
      sectionIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  turnId: Type.String({ minLength: 1 }),
  type: Type.Literal("reasoning.delta"),
});

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

export const TaskMetadataChangedEventSchema = createEventSchema({
  payload: Type.Object({}, { additionalProperties: false }),
  type: Type.Literal("task.metadata_changed"),
});

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

export const NavigableAgentTaskResponseSchema = Type.Object(
  { task: Type.Union([AgentTaskSnapshotResponseSchema, Type.Null()]) },
  { additionalProperties: false },
);

export type NavigableAgentTaskResponse = Readonly<Static<typeof NavigableAgentTaskResponseSchema>>;
