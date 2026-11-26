import { AgentMessageAttachmentSchema } from "./agent-attachments.js";
import { Type, type Static } from "@sinclair/typebox";
import { AcpScheduledPlanDefinitionSchema } from "./acp-scheduled-plan.js";

const Revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
/** 调用方只提交定义、私有资源令牌和双修订；授权目录与下次执行时间由应用计算。 */
export const SaveAcpPlanSchema = Type.Object(
  {
    definition: AcpScheduledPlanDefinitionSchema,
    resources: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 1500,
      uniqueItems: true,
    }),
    expectedRevision: Revision,
    expectedStateRevision: Revision,
  },
  { additionalProperties: false },
);
export type SaveAcpPlan = Static<typeof SaveAcpPlanSchema>;

const Id = Type.String({ minLength: 1, maxLength: 256 });
const Positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const Time = Type.Union([
  Type.Integer({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
  Type.Null(),
]);
const Source = Type.Union([Type.Literal("web"), Type.Literal("desktop")]);
export const ListAcpPlansSchema = Type.Object(
  {
    after: Type.Optional(Type.String({ maxLength: 256 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type ListAcpPlans = Static<typeof ListAcpPlansSchema>;
export const DeleteAcpPlanSchema = Type.Object(
  { expectedRevision: Positive },
  { additionalProperties: false },
);
export const DeleteAcpPlanResponseSchema = Type.Object(
  { deleted: Type.Boolean() },
  { additionalProperties: false },
);
export const StageAcpPlanResourceSchema = Type.Object(
  { projectId: Type.String({ minLength: 1, maxLength: 128 }), uploadId: Id },
  { additionalProperties: false },
);
export type StageAcpPlanResource = Static<typeof StageAcpPlanResourceSchema>;
export const AcpPlanResourceSchema = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 128 }),
    attachment: AgentMessageAttachmentSchema,
    digest: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
    written: Type.Integer({ minimum: 0, maximum: 52428800 }),
    boundRevision: Type.Union([Positive, Type.Null()]),
  },
  { additionalProperties: false },
);
export const AcpPlanViewSchema = Type.Object(
  {
    source: Source,
    scheduleId: Id,
    revision: Positive,
    definition: AcpScheduledPlanDefinitionSchema,
    state: Type.Union([
      Type.Object(
        { revision: Positive, definitionRevision: Positive, nextRunAt: Time },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    canEdit: Type.Boolean(),
    resources: Type.Array(AcpPlanResourceSchema, { maxItems: 1500 }),
  },
  { additionalProperties: false },
);
export type AcpPlanView = Static<typeof AcpPlanViewSchema>;
const definition = AcpScheduledPlanDefinitionSchema.properties;
export const AcpPlanPageSchema = Type.Object(
  {
    data: Type.Array(
      Type.Object(
        {
          source: Source,
          scheduleId: Id,
          revision: Positive,
          name: definition.name,
          projectId: definition.projectId,
          engine: definition.engine,
          enabled: definition.enabled,
          schedule: definition.schedule,
          stateRevision: Type.Union([Positive, Type.Null()]),
          scheduledRevision: Type.Union([Positive, Type.Null()]),
          nextRunAt: Time,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    nextCursor: Type.Union([Id, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AcpPlanPage = Static<typeof AcpPlanPageSchema>;

/** 阶段只描述启动交付；started 不能作为聊天任务已经完成的证据。 */
export const AcpPlanRunSummarySchema = Type.Object(
  {
    runId: Id,
    status: Type.Union([
      Type.Literal("claimed"),
      Type.Literal("unknown"),
      Type.Literal("started"),
      Type.Literal("failed"),
    ]),
    claimedAt: Type.Integer({
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    definitionRevision: Positive,
    taskId: Type.Union([Id, Type.Null()]),
    error: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AcpPlanRunSummary = Static<typeof AcpPlanRunSummarySchema>;
export const AcpPlanHistorySchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1, maxLength: 128 }),
    data: Type.Array(AcpPlanRunSummarySchema, { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type AcpPlanHistory = Static<typeof AcpPlanHistorySchema>;
/** 独立于旧工作台事件，避免旧客户端接收到它无法解码的新联合成员。 */
export const AcpPlanChangeSchema = Type.Object(
  { type: Type.Literal("acp-plans.changed") },
  { additionalProperties: false },
);
