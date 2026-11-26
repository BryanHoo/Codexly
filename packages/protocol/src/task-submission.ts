import { AcpConfigValuesSchema } from "./acp-service.js";
import { Type, type Static } from "@sinclair/typebox";
import { AgentReviewTargetSchema, AgentTaskSchema } from "./agent-attachments.js";
import { AgentPromptInputSchema, AgentTurnSchema } from "./agent-task.js";
import { AgentTurnOptionsSchema } from "./project-settings.js";
import { EventCheckpointSchema } from "./event-checkpoint.js";
import { ProjectRootPathSchema } from "./project-root.js";
import { AgentEngineSchema } from "./agent-engine.js";

export const SubmitTaskRequestSchema = Type.Union([
  // 预览配置仅用于创建任务的首发意图，不能覆盖已有任务的权威会话。
  Type.Object(
    {
      type: Type.Literal("acp-prompt"),
      engine: Type.Optional(AgentEngineSchema),
      workspacePath: Type.Optional(ProjectRootPathSchema),
      input: AgentPromptInputSchema,
      taskId: Type.Optional(Type.Never()),
      initialConfig: AcpConfigValuesSchema,
      recoveryKey: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    },
    { additionalProperties: false },
  ),
  // ACP 会话已通过 configOptions 配置；发送正文不得再覆盖旧厂商 Turn 设置。
  Type.Object(
    {
      type: Type.Literal("acp-prompt"),
      engine: Type.Optional(AgentEngineSchema),
      workspacePath: Type.Optional(ProjectRootPathSchema),
      taskId: Type.Optional(Type.String({ minLength: 1 })),
      input: AgentPromptInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("prompt"),
      engine: Type.Optional(AgentEngineSchema),
      workspacePath: Type.Optional(ProjectRootPathSchema),
      taskId: Type.Optional(Type.String({ minLength: 1 })),
      input: AgentPromptInputSchema,
      options: AgentTurnOptionsSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("review"),
      taskId: Type.Optional(Type.String({ minLength: 1 })),
      target: AgentReviewTargetSchema,
    },
    { additionalProperties: false },
  ),
]);
export type SubmitTaskRequest = Readonly<Static<typeof SubmitTaskRequestSchema>>;

export const SubmitTaskResponseSchema = Type.Object(
  {
    createdTask: Type.Optional(AgentTaskSchema),
    taskId: Type.String({ minLength: 1 }),
    turn: AgentTurnSchema,
    checkpoint: EventCheckpointSchema,
  },
  { additionalProperties: false },
);
export type SubmitTaskResponse = Readonly<Static<typeof SubmitTaskResponseSchema>>;
