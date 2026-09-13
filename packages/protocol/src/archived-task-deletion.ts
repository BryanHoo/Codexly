import { Type, type Static } from "@sinclair/typebox";

export const DeleteArchivedTasksRequestSchema = Type.Object(
  {},
  { additionalProperties: false, maxProperties: 0 },
);
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
