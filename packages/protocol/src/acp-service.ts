import { Type, type Static } from "@sinclair/typebox";
import { AgentEngineSchema } from "./agent-engine.js";
import { ProjectRootPathSchema } from "./project-root.js";
export * from "./acp-providers.js";

const Text = Type.String({ maxLength: 16384 });
const NullableText = Type.Optional(Type.Union([Text, Type.Null()]));
const Meta = Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]));
const Choice = Type.Object({ value: Text, name: Text, description: NullableText, _meta: Meta });
const Group = Type.Object({ group: Text, name: Text, options: Type.Array(Choice), _meta: Meta });
const Common = {
  id: Text,
  name: Text,
  description: NullableText,
  category: NullableText,
  _meta: Meta,
};
/** 保留 ACP 原始标识、分组和扩展元数据；界面不能根据 category 猜测权限语义。 */
export const AcpConfigOptionSchema = Type.Union([
  Type.Object({
    ...Common,
    type: Type.Literal("select"),
    currentValue: Text,
    options: Type.Union([Type.Array(Choice), Type.Array(Group)]),
  }),
  Type.Object({ ...Common, type: Type.Literal("boolean"), currentValue: Type.Boolean() }),
]);
export const AcpConfigValuesSchema = Type.Record(
  Type.String({ minLength: 1, maxLength: 256 }),
  Type.Union([Text, Type.Boolean()]),
);

const Revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const AcpScheduledConfigSchema = Type.Object(
  { engine: AgentEngineSchema, values: AcpConfigValuesSchema, revision: Revision },
  { additionalProperties: false },
);
export const AcpScheduledConfigViewSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1, maxLength: 128 }),
    canEdit: Type.Boolean(),
    config: Type.Union([AcpScheduledConfigSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const SetAcpScheduledConfigSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1, maxLength: 128 }),
    engine: AgentEngineSchema,
    values: AcpConfigValuesSchema,
    expectedRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    confirmMigration: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type AcpScheduledConfigView = Static<typeof AcpScheduledConfigViewSchema>;
export type SetAcpScheduledConfig = Static<typeof SetAcpScheduledConfigSchema>;
export const AcpDefaultsRequestSchema = Type.Object(
  { values: AcpConfigValuesSchema },
  { additionalProperties: false },
);
export const AcpDefaultsSchema = Type.Object(
  {
    configOptions: Type.Array(AcpConfigOptionSchema),
    defaults: AcpConfigValuesSchema,
    unmappedLegacy: Type.Array(Type.String()),
    invalidDefaults: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export const AcpAgentProfileSchema = Type.Object(
  {
    engine: AgentEngineSchema,
    protocolVersion: Type.Integer(),
    providerConfiguration: Type.Optional(Type.Literal(true)),
    agentInfo: Type.Optional(Type.Object({ name: Text, version: Text, title: NullableText })),
    authMethods: Type.Array(
      Type.Object({
        id: Text,
        name: Text,
        description: NullableText,
        type: Type.Optional(Type.Literal("terminal")),
      }),
    ),
  },
  { additionalProperties: false },
);
export const AcpAuthenticateRequestSchema = Type.Object(
  { methodId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
export const AcpAuthenticateResponseSchema = Type.Object({}, { additionalProperties: false });
export type AcpConfigOption = Static<typeof AcpConfigOptionSchema>;
export type AcpConfigValues = Static<typeof AcpConfigValuesSchema>;
export type AcpDefaults = Static<typeof AcpDefaultsSchema>;
export type AcpAgentProfile = Static<typeof AcpAgentProfileSchema>;
export const AcpSessionConfigSchema = Type.Array(AcpConfigOptionSchema);
export const AcpSessionConfigRequestSchema = Type.Object(
  {
    configId: Type.String({ minLength: 1, maxLength: 256 }),
    value: Type.Union([Text, Type.Boolean()]),
  },
  { additionalProperties: false },
);

/** 草稿值独立于全局默认设置；本次改动单独提交以处理模型依赖变化。 */
export const AcpConfigPreviewRequestSchema = Type.Object(
  {
    values: AcpConfigValuesSchema,
    workspacePath: Type.Optional(ProjectRootPathSchema),
    change: Type.Optional(AcpSessionConfigRequestSchema),
  },
  { additionalProperties: false },
);
export const AcpConfigPreviewSchema = Type.Object(
  { configOptions: AcpSessionConfigSchema, values: AcpConfigValuesSchema },
  { additionalProperties: false },
);
export type AcpConfigPreviewRequest = Static<typeof AcpConfigPreviewRequestSchema>;
export type AcpConfigPreview = Static<typeof AcpConfigPreviewSchema>;
