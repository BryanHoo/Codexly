import { Type, type Static } from "@sinclair/typebox";
import { AgentEngineSchema } from "./agent-engine.js";
const Text = Type.String({ minLength: 1, maxLength: 16384, pattern: "^[^\\u0000\\r\\n]+$" });
export const AcpAgentRegistrationSchema = Type.Object(
  {
    engine: AgentEngineSchema,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    command: Text,
    args: Type.Array(Type.String({ maxLength: 16384, pattern: "^[^\\u0000]+$" }), {
      maxItems: 128,
    }),
    // 环境变量仅显式替换时写入；公开列表只返回名称，绝不回显密钥。
    env: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
        Type.String({ maxLength: 16384, pattern: "^[^\\u0000]+$" }),
        { maxProperties: 128 },
      ),
    ),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AcpAgentRegistration = Static<typeof AcpAgentRegistrationSchema>;
const ByteCount = Type.Integer({ minimum: 0, maximum: 512 * 1024 * 1024 });
const InstallationStage = Type.Union([
  Type.Object(
    { stage: Type.Literal("downloading"), received: ByteCount, total: Type.Optional(ByteCount) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      stage: Type.Union([
        Type.Literal("preparing"),
        Type.Literal("checking"),
        Type.Literal("installing"),
        Type.Literal("verifying"),
        Type.Literal("extracting"),
        Type.Literal("publishing"),
        Type.Literal("removing"),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type AcpAgentInstallationStage = Static<typeof InstallationStage>;
const AgentOperation = Type.Object(
  {
    engine: AgentEngineSchema,
    name: Type.String({ maxLength: 128 }),
    action: Type.Union([
      Type.Literal("automatic"),
      Type.Literal("install"),
      Type.Literal("update"),
      Type.Literal("remove"),
    ]),
    progress: InstallationStage,
  },
  { additionalProperties: false },
);
export type AcpAgentOperation = Static<typeof AgentOperation>;
export const AcpAgentCatalogProgressSchema = Type.Object(
  {
    discovery: Type.Optional(
      Type.Object(
        {
          checked: Type.Integer({ minimum: 0 }),
          total: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    operations: Type.Array(AgentOperation, { maxItems: 256 }),
  },
  { additionalProperties: false },
);
export type AcpAgentCatalogProgress = Static<typeof AcpAgentCatalogProgressSchema>;
export const AcpAgentCatalogPageSchema = Type.Object(
  {
    agents: Type.Array(
      Type.Object(
        {
          engine: AgentEngineSchema,
          name: Type.String(),
          description: Type.String(),
          version: Type.Optional(Type.String()),
          installedVersion: Type.Optional(Type.String()),
          canUpdate: Type.Optional(Type.Boolean()),
          installed: Type.Boolean(),
          enabled: Type.Boolean(),
          detected: Type.Boolean(),
          command: Type.Optional(Type.String()),
          args: Type.Optional(Type.Array(Type.String())),
          environmentKeys: Type.Array(Type.String()),
          error: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
  },
  { additionalProperties: false },
);
export type AcpAgentCatalogPage = Static<typeof AcpAgentCatalogPageSchema>;
