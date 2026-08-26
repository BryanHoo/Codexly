import { Type, type Static } from "@sinclair/typebox";

import { ProjectOpenAppIdSchema } from "./project-files.js";
import { WorkbenchPetSettingsSchema } from "./workbench-pets.js";

export const DEFAULT_COMMIT_MESSAGE_MODEL = "gpt-5.6-luna";

export const AgentGranularApprovalConfigSchema = Type.Object(
  {
    mcp_elicitations: Type.Boolean(),
    request_permissions: Type.Boolean(),
    rules: Type.Boolean(),
    sandbox_approval: Type.Boolean(),
    skill_approval: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type AgentGranularApprovalConfig = Readonly<
  Static<typeof AgentGranularApprovalConfigSchema>
>;

export const AgentGranularApprovalPolicySchema = Type.Object(
  { granular: AgentGranularApprovalConfigSchema },
  { additionalProperties: false },
);

export type AgentGranularApprovalPolicy = Readonly<
  Static<typeof AgentGranularApprovalPolicySchema>
>;

export const DEFAULT_AGENT_GRANULAR_APPROVAL_POLICY: AgentGranularApprovalPolicy = {
  granular: {
    mcp_elicitations: true,
    request_permissions: true,
    rules: true,
    sandbox_approval: true,
    skill_approval: true,
  },
};

// Codex 0.149 的全局配置不接受 untrusted；该值仅属于 App Server 的 per-turn 协议。
export const AgentGlobalApprovalPolicySchema = Type.Union([
  Type.Literal("on-request"),
  AgentGranularApprovalPolicySchema,
  Type.Literal("never"),
]);

export type AgentGlobalApprovalPolicy = Readonly<Static<typeof AgentGlobalApprovalPolicySchema>>;

export const AgentTurnApprovalPolicySchema = Type.Union([
  Type.Literal("untrusted"),
  Type.Literal("on-request"),
  AgentGranularApprovalPolicySchema,
  Type.Literal("never"),
]);

export type AgentTurnApprovalPolicy = Readonly<Static<typeof AgentTurnApprovalPolicySchema>>;

export const AgentApprovalsReviewerSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("auto_review"),
]);

export type AgentApprovalsReviewer = Readonly<Static<typeof AgentApprovalsReviewerSchema>>;

export const AgentSandboxModeSchema = Type.Union([
  Type.Literal("read-only"),
  Type.Literal("workspace-write"),
  Type.Literal("danger-full-access"),
]);

export type AgentSandboxMode = Readonly<Static<typeof AgentSandboxModeSchema>>;

const AgentTaskSettingProperties = {
  model: Type.String({ minLength: 1 }),
  reasoningEffort: Type.String({ minLength: 1 }),
  sandboxMode: AgentSandboxModeSchema,
};

export const AgentTaskSettingsSchema = Type.Object(
  {
    approvalPolicy: AgentTurnApprovalPolicySchema,
    approvalsReviewer: AgentApprovalsReviewerSchema,
    ...AgentTaskSettingProperties,
  },
  { additionalProperties: false },
);

export type AgentTaskSettings = Readonly<Static<typeof AgentTaskSettingsSchema>>;

export const AgentCollaborationModeSchema = Type.Literal("plan");
export type AgentCollaborationMode = Readonly<Static<typeof AgentCollaborationModeSchema>>;

const AgentGlobalSettingProperties = {
  commitMessageModel: Type.String({ minLength: 1 }),
  commitMessagePrompt: Type.String({ maxLength: 4_000 }),
  // 文件专用系统关联不能成为 Project 根目录的默认打开方式。
  defaultOpenAppId: Type.Union([
    Type.Exclude(ProjectOpenAppIdSchema, Type.Literal("system-default")),
    Type.Null(),
  ]),
  fastMode: Type.Boolean(),
  followUpBehavior: Type.Union([Type.Literal("queue"), Type.Literal("steer")]),
  pet: WorkbenchPetSettingsSchema,
  ...AgentTaskSettingProperties,
};

export const AgentGlobalSettingsSchema = Type.Object(
  {
    approvalPolicy: AgentGlobalApprovalPolicySchema,
    approvalsReviewer: AgentApprovalsReviewerSchema,
    ...AgentGlobalSettingProperties,
  },
  { additionalProperties: false },
);

export type AgentGlobalSettings = Readonly<Static<typeof AgentGlobalSettingsSchema>>;

export const AgentGlobalSettingsResponseSchema = Type.Object(
  { settings: AgentGlobalSettingsSchema },
  { additionalProperties: false },
);

export type AgentGlobalSettingsResponse = Readonly<
  Static<typeof AgentGlobalSettingsResponseSchema>
>;

export const AgentProjectDefaultsSchema = Type.Object(
  {
    approvalPolicy: AgentTurnApprovalPolicySchema,
    approvalsReviewer: AgentApprovalsReviewerSchema,
    fastMode: Type.Boolean(),
    ...AgentTaskSettingProperties,
  },
  { additionalProperties: false },
);

export type AgentProjectDefaults = Readonly<Static<typeof AgentProjectDefaultsSchema>>;

export const AgentProjectDefaultsResponseSchema = Type.Object(
  { settings: AgentProjectDefaultsSchema },
  { additionalProperties: false },
);

export type AgentProjectDefaultsResponse = Readonly<
  Static<typeof AgentProjectDefaultsResponseSchema>
>;

export const AgentTaskSettingsResponseSchema = Type.Object(
  { settings: AgentTaskSettingsSchema },
  { additionalProperties: false },
);

export type AgentTaskSettingsResponse = Readonly<Static<typeof AgentTaskSettingsResponseSchema>>;

const AgentTurnOptionProperties = {
  collaborationMode: Type.Optional(AgentCollaborationModeSchema),
  fastMode: Type.Optional(Type.Literal(true)),
  goalMode: Type.Optional(Type.Literal(true)),
  ...AgentTaskSettingProperties,
};

// Collaboration、Goal 与快速模式只控制当前 Turn，不得进入持久化 Task 设置。
export const AgentTurnOptionsSchema = Type.Object(
  {
    approvalPolicy: AgentTurnApprovalPolicySchema,
    approvalsReviewer: AgentApprovalsReviewerSchema,
    ...AgentTurnOptionProperties,
  },
  { additionalProperties: false },
);
export type AgentTurnOptions = Readonly<Static<typeof AgentTurnOptionsSchema>>;

export const AgentReasoningEffortOptionSchema = Type.Object(
  {
    description: Type.String(),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentReasoningEffortOption = Readonly<Static<typeof AgentReasoningEffortOptionSchema>>;

export const AgentModelSchema = Type.Object(
  {
    defaultReasoningEffort: Type.String({ minLength: 1 }),
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    isDefault: Type.Boolean(),
    supportedReasoningEfforts: Type.Array(AgentReasoningEffortOptionSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type AgentModel = Readonly<Static<typeof AgentModelSchema>>;

export const AgentContextUsageSchema = Type.Object(
  {
    contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    usedTokens: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentContextUsage = Readonly<Static<typeof AgentContextUsageSchema>>;
