import { Type, type Static } from "@sinclair/typebox";

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
export const ProjectTextFileSchema = Type.Object(
  {
    path: Type.String(),
    content: Type.String({ maxLength: MAX_TEXT_FILE_BYTES }),
    version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export type ProjectTextFile = Readonly<Static<typeof ProjectTextFileSchema>>;
export const SaveProjectTextFileRequestSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    content: Type.String({ maxLength: MAX_TEXT_FILE_BYTES }),
    expectedVersion: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export type SaveProjectTextFileRequest = Readonly<Static<typeof SaveProjectTextFileRequestSchema>>;
export const SaveProjectTextFileResponseSchema = Type.Object(
  {
    version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export type SaveProjectTextFileResponse = Readonly<
  Static<typeof SaveProjectTextFileResponseSchema>
>;
