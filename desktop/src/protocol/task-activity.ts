import { Type, type Static } from "@sinclair/typebox";

import { DateTimeSchema } from "./project-files.js";

export const TaskActivitySnapshotSchema = Type.Object(
  {
    projectId: Type.String({ maxLength: 128, minLength: 1 }),
    requiresApproval: Type.Boolean(),
    rootPath: Type.Optional(Type.String({ maxLength: 4096, minLength: 1 })),
    startedAt: Type.Optional(DateTimeSchema),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("running"),
      Type.Literal("waiting"),
    ]),
    taskId: Type.String({ maxLength: 128, minLength: 1 }),
    taskName: Type.String({ maxLength: 512, minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TaskActivitySnapshot = Readonly<Static<typeof TaskActivitySnapshotSchema>>;
