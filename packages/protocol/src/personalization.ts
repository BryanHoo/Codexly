import { Type, type Static } from "@sinclair/typebox";

export const GlobalInstructionsSchema = Type.Object(
  { content: Type.String(), path: Type.String(), overrideActive: Type.Boolean() },
  { additionalProperties: false },
);
export const SaveGlobalInstructionsSchema = Type.Object(
  {
    content: Type.String({ maxLength: 1_000_000 }),
    expectedContent: Type.String({ maxLength: 1_000_000 }),
  },
  { additionalProperties: false },
);
export const MemorySettingsSchema = Type.Object(
  { enabled: Type.Boolean(), allowExternalContext: Type.Boolean() },
  { additionalProperties: false },
);
export const MemorySettingsUpdateSchema = Type.Partial(MemorySettingsSchema);
export const AgentPreferencesSchema = Type.Object(
  {
    webSearch: Type.Union([Type.Literal("disabled"), Type.Literal("cached"), Type.Literal("live")]),
    modelVerbosity: Type.Union([
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const PersonalizationResetSchema = Type.Object(
  { success: Type.Boolean() },
  { additionalProperties: false },
);
export type GlobalInstructions = Static<typeof GlobalInstructionsSchema>;
export type SaveGlobalInstructions = Static<typeof SaveGlobalInstructionsSchema>;
export type MemorySettings = Static<typeof MemorySettingsSchema>;
export type MemorySettingsUpdate = Static<typeof MemorySettingsUpdateSchema>;
export type AgentPreferences = Static<typeof AgentPreferencesSchema>;
