import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ProjectOpenAppIdSchema } from "./project-files.js";
import { AgentEngineSchema } from "./agent-engine.js";

import contract from "./application-preferences-sql.json" with { type: "json" };

export const legacyGlobalInstructions = contract.legacyInstructions;
export const MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH = legacyGlobalInstructions.maxLength;

/** 应用偏好不包含模型运行参数；null 模型表示沿用 ACP agent 当前默认值。 */
export const ApplicationPreferencesSchema = Type.Object(
  {
    defaultAgent: AgentEngineSchema,
    defaultModel: Type.Union([Type.String({ minLength: 1, maxLength: 16384 }), Type.Null()]),
    // 旧版已保存的应用快照可省略，空字符串表示主动清除。
    globalInstructions: Type.Optional(
      Type.String({ maxLength: MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH }),
    ),
    commitMessagePrompt: Type.String({ maxLength: 4000 }),
    taskTitlePrompt: Type.String({ maxLength: 4000 }),
    promptOptimizationPrompt: Type.String({ maxLength: 4000 }),
    defaultOpenAppId: Type.Union([
      Type.Exclude(ProjectOpenAppIdSchema, Type.Literal("system-default")),
      // 原生旧版本已有该应用；跨端私有偏好必须无损保留，实际打开仍核对宿主能力。
      Type.Literal("iterm2"),
      Type.Null(),
    ]),
    followUpBehavior: Type.Union([Type.Literal("queue"), Type.Literal("steer")]),
    pet: Type.Union([
      Type.Object(
        {
          enabled: Type.Literal(false),
          selectedPetId: Type.Union([Type.String({ maxLength: 16384 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          enabled: Type.Literal(true),
          selectedPetId: Type.String({ minLength: 1, maxLength: 16384 }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export type ApplicationPreferences = Static<typeof ApplicationPreferencesSchema>;

export const AgentInstructionsTargetsSchema = Type.Object({
  version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  files: Type.Array(
    Type.Object({
      agents: Type.Array(Type.String()),
      path: Type.String(),
      exists: Type.Boolean(),
    }),
  ),
  unsupported: Type.Array(Type.String()),
});
export type AgentInstructionsTargets = Static<typeof AgentInstructionsTargetsSchema>;
export const SaveAgentInstructionsSchema = Type.Object(
  {
    content: Type.String({ maxLength: MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH }),
    version: AgentInstructionsTargetsSchema.properties.version,
  },
  { additionalProperties: false },
);
export type SaveAgentInstructions = Static<typeof SaveAgentInstructionsSchema>;

// 引擎和模型必须作为一组修改，避免把旧引擎的原始模型 ID 绑定给新引擎。
export const ApplicationPreferencesPatchSchema = Type.Union([
  Type.Partial(Type.Omit(ApplicationPreferencesSchema, ["defaultAgent", "defaultModel"]), {
    additionalProperties: false,
    minProperties: 1,
  }),
  Type.Object(
    {
      ...Type.Partial(Type.Omit(ApplicationPreferencesSchema, ["defaultAgent", "defaultModel"]))
        .properties,
      defaultAgent: ApplicationPreferencesSchema.properties.defaultAgent,
      defaultModel: ApplicationPreferencesSchema.properties.defaultModel,
    },
    { additionalProperties: false },
  ),
]);
export type ApplicationPreferencesPatch = Static<typeof ApplicationPreferencesPatchSchema>;
export const isApplicationPreferences = (value: unknown): value is ApplicationPreferences =>
  Value.Check(ApplicationPreferencesSchema, value);
export const isApplicationPreferencesPatch = (
  value: unknown,
): value is ApplicationPreferencesPatch => Value.Check(ApplicationPreferencesPatchSchema, value);
