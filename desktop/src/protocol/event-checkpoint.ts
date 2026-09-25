import { Type, type Static } from "@sinclair/typebox";

export const EventCheckpointSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 0 }),
    sessionId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type EventCheckpoint = Readonly<Static<typeof EventCheckpointSchema>>;
