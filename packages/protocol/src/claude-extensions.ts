import { Type, type Static } from "@sinclair/typebox";

export const ClaudeExtensionKindSchema = Type.Union([
  Type.Literal("skills"),
  Type.Literal("mcp"),
  Type.Literal("plugins"),
]);
export type ClaudeExtensionKind = Static<typeof ClaudeExtensionKindSchema>;
export const ClaudeExtensionScopeSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("project"),
  Type.Literal("local"),
]);
export type ClaudeExtensionScope = Static<typeof ClaudeExtensionScopeSchema>;
export const ClaudeExtensionSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String(),
    scope: Type.String(),
    enabled: Type.Boolean(),
    installed: Type.Boolean(),
    mutable: Type.Boolean(),
    path: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type ClaudeExtension = Readonly<Static<typeof ClaudeExtensionSchema>>;
export const ClaudeExtensionPageSchema = Type.Object(
  { data: Type.Array(ClaudeExtensionSchema) },
  { additionalProperties: false },
);
export type ClaudeExtensionPage = Readonly<Static<typeof ClaudeExtensionPageSchema>>;
export const ClaudeExtensionMutationSchema = Type.Object(
  {
    kind: ClaudeExtensionKindSchema,
    action: Type.Union(
      (["enable", "disable", "install", "uninstall", "update", "remove", "sync"] as const).map(
        (value) => Type.Literal(value),
      ),
    ),
    id: Type.String({ minLength: 1, maxLength: 200 }),
    scope: ClaudeExtensionScopeSchema,
  },
  { additionalProperties: false },
);
export type ClaudeExtensionMutation = Readonly<Static<typeof ClaudeExtensionMutationSchema>>;
export interface ClaudeExtensionClient {
  listClaudeExtensions(kind: ClaudeExtensionKind, projectId?: string): Promise<ClaudeExtensionPage>;
  mutateClaudeExtension(
    input: ClaudeExtensionMutation,
    projectId?: string,
  ): Promise<ClaudeExtensionPage>;
}
