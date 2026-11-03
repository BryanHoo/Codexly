import { Type, type Static } from "@sinclair/typebox";

export const SavedPromptSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 80 }),
    content: Type.String({ minLength: 1, maxLength: 20000 }),
    projectId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export const SavedPromptsSchema = Type.Array(SavedPromptSchema);

// 在最外层声明所有字段，避免 AJV 校验 anyOf 时先删除其他分支的合法数据。
export const SavedPromptsRequestSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("list"),
      Type.Literal("save"),
      Type.Literal("remove"),
      Type.Literal("import"),
    ]),
    prompt: Type.Optional(SavedPromptSchema),
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    prompts: Type.Optional(Type.Array(SavedPromptSchema, { maxItems: 1000 })),
  },
  {
    additionalProperties: false,
    anyOf: [
      { properties: { action: { const: "list" } } },
      { properties: { action: { const: "save" } }, required: ["prompt"] },
      { properties: { action: { const: "remove" } }, required: ["id"] },
      { properties: { action: { const: "import" } }, required: ["prompts"] },
    ],
  },
);
export type SharedSavedPrompt = Static<typeof SavedPromptSchema>;
export type SavedPromptsRequest =
  | { action: "list" }
  | { action: "save"; prompt: SharedSavedPrompt }
  | { action: "remove"; id: string }
  | { action: "import"; prompts: readonly SharedSavedPrompt[] };
