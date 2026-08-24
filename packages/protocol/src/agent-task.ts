import { Type, type Static } from "@sinclair/typebox";

import {
  AgentAttachmentKindSchema,
  AgentAttachmentMediaTypeSchema,
  AgentCommandItemSchema,
  AgentItemStatusSchema,
  AgentMessageAttachmentSchema,
  AgentMessageItemSchema,
  AgentReasoningItemSchema,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_HISTORY_IMAGES,
} from "./agent-attachments.js";
import { NullableDateTimeSchema } from "./project-files.js";
import { AgentFileChangeSchema } from "./project-git.js";

export const AgentFileChangeItemSchema = Type.Object(
  {
    changes: Type.Array(AgentFileChangeSchema),
    id: Type.String({ minLength: 1 }),
    status: AgentItemStatusSchema,
    type: Type.Literal("file_change"),
  },
  { additionalProperties: false },
);

export const AgentToolItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    input: Type.Optional(Type.Unknown()),
    name: Type.String({ minLength: 1 }),
    output: Type.Optional(Type.Unknown()),
    progress: Type.Optional(Type.String({ maxLength: 8_192 })),
    status: AgentItemStatusSchema,
    type: Type.Literal("tool"),
  },
  { additionalProperties: false },
);

const AgentSafetyBufferingItemSchema = Type.Object(
  {
    fasterModel: Type.Optional(Type.String({ minLength: 1 })),
    id: Type.String({ minLength: 1 }),
    kind: Type.Literal("safety_buffering"),
    model: Type.String({ minLength: 1 }),
    status: AgentItemStatusSchema,
    type: Type.Literal("runtime_status"),
  },
  { additionalProperties: false },
);

const AgentModelReroutedItemSchema = Type.Object(
  {
    fromModel: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    kind: Type.Literal("model_rerouted"),
    status: Type.Literal("completed"),
    toModel: Type.String({ minLength: 1 }),
    type: Type.Literal("runtime_status"),
  },
  { additionalProperties: false },
);

const AgentHookStatusItemSchema = Type.Object(
  {
    detail: Type.Optional(Type.String({ maxLength: 8_192 })),
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
    eventName: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    kind: Type.Literal("hook"),
    status: AgentItemStatusSchema,
    type: Type.Literal("runtime_status"),
  },
  { additionalProperties: false },
);

export const AgentRuntimeStatusItemSchema = Type.Union([
  AgentSafetyBufferingItemSchema,
  AgentModelReroutedItemSchema,
  AgentHookStatusItemSchema,
]);

export const AgentPlanItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    text: Type.String(),
    type: Type.Literal("plan"),
  },
  { additionalProperties: false },
);

export const AgentActivityItemSchema = Type.Object(
  {
    detail: Type.Optional(Type.String()),
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
    status: Type.Optional(AgentItemStatusSchema),
    transient: Type.Optional(Type.Boolean()),
    type: Type.Literal("activity"),
  },
  { additionalProperties: false },
);

export const AgentApprovalReviewStatusSchema = Type.Union([
  Type.Literal("in_progress"),
  Type.Literal("approved"),
  Type.Literal("denied"),
  Type.Literal("timed_out"),
  Type.Literal("aborted"),
]);

export const AgentApprovalReviewActionSchema = Type.Object(
  {
    detail: Type.String(),
    type: Type.Union([
      Type.Literal("command"),
      Type.Literal("file_change"),
      Type.Literal("network_access"),
      Type.Literal("mcp_tool_call"),
      Type.Literal("permissions"),
    ]),
  },
  { additionalProperties: false },
);

export const AgentApprovalReviewItemSchema = Type.Object(
  {
    action: AgentApprovalReviewActionSchema,
    id: Type.String({ minLength: 1 }),
    rationale: Type.Optional(Type.String()),
    riskLevel: Type.Optional(
      Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("critical"),
      ]),
    ),
    status: AgentApprovalReviewStatusSchema,
    targetItemId: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Literal("approval_review"),
    userAuthorization: Type.Optional(
      Type.Union([
        Type.Literal("unknown"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const AgentReviewItemTargetSchema = Type.Union([
  Type.Object({ type: Type.Literal("uncommitted_changes") }, { additionalProperties: false }),
  Type.Object(
    { branch: Type.String({ minLength: 1 }), type: Type.Literal("base_branch") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      sha: Type.String({ minLength: 1 }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      type: Type.Literal("commit"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      instructions: Type.String({ minLength: 1 }),
      type: Type.Literal("custom"),
    },
    { additionalProperties: false },
  ),
]);

export const AgentReviewItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    // Fastify 响应序列化器要求判别 Union 直接展开，不能复用请求侧 Intersect Schema。
    target: AgentReviewItemTargetSchema,
    type: Type.Literal("review"),
  },
  { additionalProperties: false },
);

export const AgentItemSchema = Type.Union([
  AgentMessageItemSchema,
  AgentReasoningItemSchema,
  AgentCommandItemSchema,
  AgentFileChangeItemSchema,
  AgentToolItemSchema,
  AgentPlanItemSchema,
  AgentActivityItemSchema,
  AgentApprovalReviewItemSchema,
  AgentReviewItemSchema,
  AgentRuntimeStatusItemSchema,
]);

export type AgentItem = Readonly<Static<typeof AgentItemSchema>>;

export const AgentTurnStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
]);

export const AgentTurnSchema = Type.Object(
  {
    completedAt: NullableDateTimeSchema,
    error: Type.Union([Type.String(), Type.Null()]),
    id: Type.String({ minLength: 1 }),
    items: Type.Array(AgentItemSchema),
    startedAt: NullableDateTimeSchema,
    status: AgentTurnStatusSchema,
  },
  { additionalProperties: false },
);

export type AgentTurn = Readonly<Static<typeof AgentTurnSchema>>;

export const AgentAttachmentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: AgentAttachmentKindSchema,
    mediaType: AgentAttachmentMediaTypeSchema,
    name: Type.String({ maxLength: 255, minLength: 1 }),
    size: Type.Integer({ maximum: MAX_AGENT_ATTACHMENT_BYTES, minimum: 1 }),
  },
  { additionalProperties: false },
);

export type AgentAttachment = Readonly<Static<typeof AgentAttachmentSchema>>;

export const AgentAttachmentUploadResponseSchema = Type.Object(
  { attachment: AgentAttachmentSchema },
  { additionalProperties: false },
);

export type AgentAttachmentUploadResponse = Readonly<
  Static<typeof AgentAttachmentUploadResponseSchema>
>;

export const AgentSkillScopeSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("repo"),
  Type.Literal("system"),
  Type.Literal("admin"),
]);

export const AgentSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    scope: AgentSkillScopeSchema,
  },
  { additionalProperties: false },
);

export type AgentSkill = Readonly<Static<typeof AgentSkillSchema>>;

export const AgentMcpServerStatusSchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("ready"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export type AgentMcpServerStatus = Readonly<Static<typeof AgentMcpServerStatusSchema>>;

export const AgentMcpAuthStatusSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("unsupported"),
  Type.Literal("notLoggedIn"),
  Type.Literal("bearerToken"),
  Type.Literal("oAuth"),
]);

export type AgentMcpAuthStatus = Readonly<Static<typeof AgentMcpAuthStatusSchema>>;

export const AgentMcpServerFailureReasonSchema = Type.Literal("reauthenticationRequired");

export type AgentMcpServerFailureReason = Readonly<
  Static<typeof AgentMcpServerFailureReasonSchema>
>;

export const AgentMcpServerSchema = Type.Object(
  {
    authStatus: Type.Union([AgentMcpAuthStatusSchema, Type.Null()]),
    description: Type.Union([Type.String(), Type.Null()]),
    error: Type.Union([Type.String({ maxLength: 8_192 }), Type.Null()]),
    failureReason: Type.Union([AgentMcpServerFailureReasonSchema, Type.Null()]),
    name: Type.String({ minLength: 1 }),
    status: AgentMcpServerStatusSchema,
    title: Type.Union([Type.String(), Type.Null()]),
    toolCount: Type.Integer({ minimum: 0 }),
    version: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export type AgentMcpServer = Readonly<Static<typeof AgentMcpServerSchema>>;

export const AgentMcpServerPageSchema = Type.Object(
  { data: Type.Array(AgentMcpServerSchema, { uniqueItems: true }) },
  { additionalProperties: false },
);

export type AgentMcpServerPage = Readonly<Static<typeof AgentMcpServerPageSchema>>;

export const AgentSkillReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentSkillReference = Readonly<Static<typeof AgentSkillReferenceSchema>>;

const AgentAttachmentReferenceSchema = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

const AgentPromptInputProperties = {
  attachments: Type.Array(AgentAttachmentReferenceSchema),
  skills: Type.Array(AgentSkillReferenceSchema),
  text: Type.String({ maxLength: 100_000 }),
  type: Type.Literal("prompt"),
};

export const AgentPromptInputSchema = Type.Union([
  Type.Object(
    {
      ...AgentPromptInputProperties,
      text: Type.String({ maxLength: 100_000, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...AgentPromptInputProperties,
      attachments: Type.Array(AgentAttachmentReferenceSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...AgentPromptInputProperties,
      skills: Type.Array(AgentSkillReferenceSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export type AgentPromptInput = Readonly<Static<typeof AgentPromptInputSchema>>;

export const AgentQueuedSubmissionSchema = Type.Object(
  {
    attachments: Type.Array(AgentMessageAttachmentSchema, {
      maxItems: MAX_AGENT_HISTORY_IMAGES,
    }),
    clientUserMessageId: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    skills: Type.Array(AgentSkillReferenceSchema),
    text: Type.String({ maxLength: 100_000 }),
  },
  { additionalProperties: false },
);

export type AgentQueuedSubmission = Readonly<Static<typeof AgentQueuedSubmissionSchema>>;

export const AgentQueuedSubmissionPageSchema = Type.Object(
  {
    data: Type.Array(AgentQueuedSubmissionSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type AgentQueuedSubmissionPage = Readonly<Static<typeof AgentQueuedSubmissionPageSchema>>;
