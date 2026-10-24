import { Type, type Static } from "@sinclair/typebox";

export const DeleteArchivedTasksRequestSchema = Type.Object(
  { updatedBefore: Type.Optional(Type.String({ format: "date-time" })) },
  { additionalProperties: false },
);
export type DeleteArchivedTasksRequest = Readonly<Static<typeof DeleteArchivedTasksRequestSchema>>;
export const DeleteArchivedTasksResponseSchema = Type.Object(
  {
    deletedCount: Type.Integer({ minimum: 0 }),
    failedCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type DeleteArchivedTasksResponse = Readonly<
  Static<typeof DeleteArchivedTasksResponseSchema>
>;
