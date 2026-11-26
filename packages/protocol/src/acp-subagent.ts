import { Type, type Static } from "@sinclair/typebox";

export const AcpSubagentIdentitySchema = Type.Object(
  {
    sessionId: Type.String({ minLength: 1, maxLength: 1024 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);

export type AcpSubagentIdentity = Static<typeof AcpSubagentIdentitySchema>;

export const AcpSubagentItemSchema = Type.Object(
  {
    ...AcpSubagentIdentitySchema.properties,
    id: Type.String({ minLength: 1 }),
    type: Type.Literal("acp_subagent"),
    parentSessionId: Type.String({ minLength: 1, maxLength: 1024 }),
    description: Type.Optional(Type.String({ maxLength: 2048 })),
    state: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);

/** ACP 原生 ID 只在会话内唯一，前缀将条目和审批固定到同一个会话。 */
export function acpSubagentItemPrefix(sessionId: string): string {
  return "acp:child:" + encodeURIComponent(sessionId) + ":";
}
