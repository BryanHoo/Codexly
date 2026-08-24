import { AgentAttachmentKindSchema, HostFileKindSchema } from "@codexly/protocol";

export const ProjectParamsSchema = {
  additionalProperties: false,
  properties: { projectId: { minLength: 1, type: "string" } },
  required: ["projectId"],
  type: "object",
} as const;

export const ProjectAttachmentParamsSchema = {
  additionalProperties: false,
  properties: {
    kind: AgentAttachmentKindSchema,
    projectId: { minLength: 1, type: "string" },
  },
  required: ["kind", "projectId"],
  type: "object",
} as const;

export const ProjectHostAttachmentParamsSchema = {
  additionalProperties: false,
  properties: {
    kind: HostFileKindSchema,
    projectId: { minLength: 1, type: "string" },
  },
  required: ["kind", "projectId"],
  type: "object",
} as const;

export const ProjectStoredAttachmentParamsSchema = {
  additionalProperties: false,
  properties: {
    attachmentId: { minLength: 1, type: "string" },
    projectId: { minLength: 1, type: "string" },
  },
  required: ["attachmentId", "projectId"],
  type: "object",
} as const;

export const ProjectTaskParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId"],
  type: "object",
} as const;

export const ProjectTaskTurnParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
    turnId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "turnId"],
  type: "object",
} as const;

export const ProjectTaskQueueParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    queuedSubmissionId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "queuedSubmissionId"],
  type: "object",
} as const;

export const ProjectTaskTerminalParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
    terminalId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "terminalId"],
  type: "object",
} as const;

export const ProjectTaskAttachmentParamsSchema = {
  additionalProperties: false,
  properties: {
    attachmentId: { minLength: 1, type: "string" },
    projectId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["attachmentId", "projectId", "taskId"],
  type: "object",
} as const;

export const ProjectTaskPendingRequestParamsSchema = {
  additionalProperties: false,
  properties: {
    projectId: { minLength: 1, type: "string" },
    requestId: { minLength: 1, type: "string" },
    taskId: { minLength: 1, type: "string" },
  },
  required: ["projectId", "taskId", "requestId"],
  type: "object",
} as const;

export const IdempotencyHeadersSchema = {
  properties: { "idempotency-key": { minLength: 1, type: "string" } },
  required: ["idempotency-key"],
  type: "object",
} as const;

export const TaskPageQuerySchema = {
  additionalProperties: false,
  properties: {
    archived: { const: true, type: "boolean" },
    cursor: { minLength: 1, type: "string" },
    limit: { maximum: 100, minimum: 1, type: "integer" },
    pinned: { const: true, type: "boolean" },
    searchTerm: { maxLength: 200, minLength: 1, type: "string" },
  },
  type: "object",
} as const;

export const TaskSnapshotQuerySchema = {
  additionalProperties: false,
  properties: { cursor: { maxLength: 8_192, minLength: 1, type: "string" } },
  type: "object",
} as const;

export const QueuePageQuerySchema = {
  additionalProperties: false,
  properties: {
    cursor: { minLength: 1, type: "string" },
    limit: { maximum: 100, minimum: 1, type: "integer" },
  },
  type: "object",
} as const;

export const SourceFileQuerySchema = {
  additionalProperties: false,
  properties: { path: { minLength: 1, type: "string" } },
  required: ["path"],
  type: "object",
} as const;

export const EventQuerySchema = {
  additionalProperties: false,
  properties: { afterSequence: { minimum: 0, type: "integer" } },
  required: ["afterSequence"],
  type: "object",
} as const;

export const ErrorResponseSchema = {
  additionalProperties: false,
  properties: {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  required: ["code", "message"],
  type: "object",
} as const;
