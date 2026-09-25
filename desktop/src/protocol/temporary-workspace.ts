import { Type, type Static } from "@sinclair/typebox";

export const TemporaryWorkspaceSettingsSchema = Type.Object({
  rootPath: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type TemporaryWorkspaceSettings = Readonly<Static<typeof TemporaryWorkspaceSettingsSchema>>;
