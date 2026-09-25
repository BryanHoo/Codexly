import { Type, type Static } from "@sinclair/typebox";

export const GlobalInstructionsSchema = Type.Object({
  content: Type.String(),
  path: Type.String(),
  overrideActive: Type.Boolean(),
});
export const MemorySettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  allowExternalContext: Type.Boolean(),
});
export type GlobalInstructions = Static<typeof GlobalInstructionsSchema>;
export type MemorySettings = Static<typeof MemorySettingsSchema>;
export type MemorySettingsUpdate = Partial<MemorySettings>;
