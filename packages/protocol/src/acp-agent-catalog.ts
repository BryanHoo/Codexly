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
export const AcpAgentCatalogPageSchema = Type.Object(
  {
    agents: Type.Array(
      Type.Object(
        {
          engine: AgentEngineSchema,
          name: Type.String(),
          description: Type.String(),
          version: Type.Optional(Type.String()),
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
