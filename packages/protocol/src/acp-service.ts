import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AgentEngineSchema } from "./agent-engine.js";
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
/** 界面只呈现当前支持的标准选项；未来未知控件不转换成已有厂商设置。 */
export function isAcpConfigOption(value: unknown): value is AcpConfigOption {
  return Value.Check(AcpConfigOptionSchema, value);
}
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
