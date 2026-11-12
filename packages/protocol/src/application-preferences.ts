import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ProjectOpenAppIdSchema } from "./project-files.js";
import { AgentEngineSchema } from "./agent-engine.js";

/** 应用偏好不包含模型运行参数；null 模型表示沿用 ACP agent 当前默认值。 */
export const ApplicationPreferencesSchema = Type.Object(
  {
    defaultAgent: AgentEngineSchema,
    defaultModel: Type.Union([Type.String({ minLength: 1, maxLength: 16384 }), Type.Null()]),
    commitMessagePrompt: Type.String({ maxLength: 4000 }),
    taskTitlePrompt: Type.String({ maxLength: 4000 }),
    promptOptimizationPrompt: Type.String({ maxLength: 4000 }),
    defaultOpenAppId: Type.Union([
      Type.Exclude(ProjectOpenAppIdSchema, Type.Literal("system-default")),
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
