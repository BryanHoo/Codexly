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
