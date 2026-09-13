import { Type, type Static } from "@sinclair/typebox";
import { AgentTaskSchema } from "./agent-attachments.js";

const CompletedTasksCursorSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
  { maxProperties: 100 },
);
export const CompletedTasksQuerySchema = Type.Object(
  {
    projectIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 100,
      uniqueItems: true,
    }),
    cursor: Type.Optional(CompletedTasksCursorSchema),
  },
  { additionalProperties: false },
);
export const CompletedTasksPageSchema = Type.Object(
  {
    data: Type.Array(AgentTaskSchema, { maxItems: 100 }),
    nextCursor: Type.Union([CompletedTasksCursorSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type CompletedTasksCursor = Readonly<Static<typeof CompletedTasksCursorSchema>>;
export type CompletedTasksQuery = Readonly<
  Omit<Static<typeof CompletedTasksQuerySchema>, "projectIds"> & { projectIds: readonly string[] }
>;
export type CompletedTasksPage = Readonly<Static<typeof CompletedTasksPageSchema>>;
