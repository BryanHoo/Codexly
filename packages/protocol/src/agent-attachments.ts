import { Type, type Static } from "@sinclair/typebox";

import { DateTimeSchema } from "./project-files.js";

export const AgentThreadConfigurationSchema = Type.Object(
  {
    model: Type.Union([Type.String(), Type.Null()]),
    reasoningEffort: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const AgentTaskSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
    threadConfiguration: Type.Optional(AgentThreadConfigurationSchema),
    title: Type.String({ minLength: 1 }),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export type AgentTask = Readonly<Static<typeof AgentTaskSchema>>;

export const AgentItemStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("declined"),
  Type.Literal("interrupted"),
]);

export type AgentItemStatus = Static<typeof AgentItemStatusSchema>;

const AgentReviewTargetFieldsSchema = Type.Object(
  {
    branch: Type.Optional(Type.String({ minLength: 1 })),
    instructions: Type.Optional(Type.String({ minLength: 1 })),
    sha: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Union([
      Type.Literal("uncommitted_changes"),
      Type.Literal("base_branch"),
      Type.Literal("commit"),
      Type.Literal("custom"),
    ]),
  },
  { additionalProperties: false },
);

// 分支只声明条件必填字段；字段白名单由前一个 Schema 统一控制，避免 Ajv 删除其他分支字段。
export const AgentReviewTargetSchema = Type.Intersect([
  AgentReviewTargetFieldsSchema,
  Type.Union([
    Type.Object({ type: Type.Literal("uncommitted_changes") }),
    Type.Object({ branch: Type.String({ minLength: 1 }), type: Type.Literal("base_branch") }),
    Type.Object({ sha: Type.String({ minLength: 1 }), type: Type.Literal("commit") }),
    Type.Object({
      instructions: Type.String({ minLength: 1 }),
      type: Type.Literal("custom"),
    }),
  ]),
]);
export type AgentReviewTarget = Readonly<Static<typeof AgentReviewTargetSchema>>;

export const MAX_AGENT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_FILE_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_IMAGES = 20;
export const MAX_AGENT_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_TEXT_BYTES = 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_BYTES = Math.max(MAX_AGENT_FILE_BYTES, MAX_AGENT_IMAGE_BYTES);
export const MAX_AGENT_HISTORY_IMAGES = 1_500;
export const MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES = 512 * 1024 * 1024;

export const AGENT_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
// 空 accept 允许选择任意普通文件；Provider 对非原生输入统一传递本地路径。
export const AGENT_FILE_ACCEPT = "";

export const AgentImageMediaTypeSchema = Type.Union([
  Type.Literal("image/gif"),
  Type.Literal("image/jpeg"),
  Type.Literal("image/png"),
  Type.Literal("image/webp"),
]);

export type AgentImageMediaType = Readonly<Static<typeof AgentImageMediaTypeSchema>>;

export const AgentAttachmentMediaTypeSchema = Type.String({ maxLength: 255, minLength: 1 });

export type AgentAttachmentMediaType = Readonly<Static<typeof AgentAttachmentMediaTypeSchema>>;

export const AgentAttachmentKindSchema = Type.Union([
  Type.Literal("file"),
  Type.Literal("image"),
  Type.Literal("text"),
]);

export type AgentAttachmentKind = Readonly<Static<typeof AgentAttachmentKindSchema>>;

export const AgentMessageSkillSchema = Type.Object(
  { name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type AgentMessageSkill = Readonly<Static<typeof AgentMessageSkillSchema>>;

export function stripLeadingAgentSkillReferences(
  text: string,
  skills: readonly Pick<AgentMessageSkill, "name">[],
): string {
  const skillNames = new Set(skills.map((skill) => skill.name));
  let remainingText = text;
  let removedReference = false;

  while (remainingText.length > 0) {
    const reference = /^\s*\$([^\s$]+)/u.exec(remainingText);
    const skillName = reference?.[1];
    if (reference === null || skillName === undefined || !skillNames.has(skillName)) {
      break;
    }

    // Codex 可能把结构化 Skill 复制成开头的 `$name` 文本；逐个移除后只保留真实正文。
    remainingText = remainingText.slice(reference[0].length);
    removedReference = true;
  }

  return removedReference ? remainingText.trimStart() : text;
}

// Snapshot 只保存可授权读取的附件元数据，避免历史二进制随消息缓存复制。
export const AgentMessageAttachmentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: AgentAttachmentKindSchema,
    mediaType: AgentAttachmentMediaTypeSchema,
    name: Type.String({ maxLength: 255, minLength: 1 }),
    size: Type.Integer({ maximum: MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES, minimum: 1 }),
  },
  { additionalProperties: false },
);

export type AgentMessageAttachment = Readonly<Static<typeof AgentMessageAttachmentSchema>>;

export const OpenAgentTaskAttachmentRequestSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export type OpenAgentTaskAttachmentRequest = Readonly<
  Static<typeof OpenAgentTaskAttachmentRequestSchema>
>;

export const OpenAgentTaskAttachmentResponseSchema = Type.Object(
  {
    attachmentId: Type.String({ minLength: 1 }),
    status: Type.Literal("opened"),
  },
  { additionalProperties: false },
);

export type OpenAgentTaskAttachmentResponse = Readonly<
  Static<typeof OpenAgentTaskAttachmentResponseSchema>
>;

export const AgentMessagePhaseSchema = Type.Union([
  Type.Literal("commentary"),
  Type.Literal("final_answer"),
]);

export type AgentMessagePhase = Readonly<Static<typeof AgentMessagePhaseSchema>>;

export const AgentMessageItemSchema = Type.Object(
  {
    attachments: Type.Optional(
      Type.Array(AgentMessageAttachmentSchema, { maxItems: MAX_AGENT_HISTORY_IMAGES }),
    ),
    id: Type.String({ minLength: 1 }),
    phase: Type.Optional(AgentMessagePhaseSchema),
    questions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            title: Type.String(),
            options: Type.Union([Type.Array(Type.String()), Type.Null()]),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    skills: Type.Optional(Type.Array(AgentMessageSkillSchema)),
    text: Type.String(),
    type: Type.Literal("message"),
  },
  { additionalProperties: false },
);

export const AgentReasoningItemSchema = Type.Object(
  {
    content: Type.String(),
    id: Type.String({ minLength: 1 }),
    summary: Type.String(),
    type: Type.Literal("reasoning"),
  },
  { additionalProperties: false },
);

export const AgentCommandOutputOmissionSchema = Type.Object(
  {
    bytes: Type.Integer({ minimum: 0 }),
    lines: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentCommandOutputOmission = Readonly<Static<typeof AgentCommandOutputOmissionSchema>>;

export const AgentCommandItemSchema = Type.Object(
  {
    command: Type.String(),
    cwd: Type.String(),
    exitCode: Type.Optional(Type.Integer()),
    id: Type.String({ minLength: 1 }),
    output: Type.Optional(Type.String()),
    outputOmitted: AgentCommandOutputOmissionSchema,
    status: AgentItemStatusSchema,
    type: Type.Literal("command"),
  },
  { additionalProperties: false },
);

export const AgentBackgroundTerminalSchema = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    itemId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentBackgroundTerminal = Readonly<Static<typeof AgentBackgroundTerminalSchema>>;

export const AgentBackgroundTerminalPageSchema = Type.Object(
  { data: Type.Array(AgentBackgroundTerminalSchema) },
  { additionalProperties: false },
);

export type AgentBackgroundTerminalPage = Readonly<
  Static<typeof AgentBackgroundTerminalPageSchema>
>;

export const TerminateAgentBackgroundTerminalResponseSchema = Type.Object(
  {
    status: Type.Literal("terminated"),
    terminalId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TerminateAgentBackgroundTerminalResponse = Readonly<
  Static<typeof TerminateAgentBackgroundTerminalResponseSchema>
>;
