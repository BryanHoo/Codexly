import { Type } from "@sinclair/typebox";

export const AcpFileChangeDetailsSchema = Type.Object(
  {
    operation: Type.Union([
      Type.Literal("add"),
      Type.Literal("modify"),
      Type.Literal("delete"),
      Type.Literal("move"),
      Type.Literal("copy"),
    ]),
    oldPath: Type.Optional(Type.String({ minLength: 1 })),
    fileType: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
