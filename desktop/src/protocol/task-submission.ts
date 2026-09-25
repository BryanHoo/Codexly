import { Type, type TSchema } from "@sinclair/typebox";
import { AgentTaskSchema, type AgentTask } from "./agent-attachments.js";

export function taskSubmissionResponseSchema<T extends TSchema>(result: T) {
  return Type.Object({
    createdTask: Type.Union([AgentTaskSchema, Type.Null()]),
    outcome: Type.Union([
      Type.Object({ type: Type.Literal("started"), result }, { additionalProperties: false }),
      Type.Object({ type: Type.Literal("failed"), error: Type.Unknown() }, { additionalProperties: false }),
    ]),
  }, { additionalProperties: false });
}

export type TaskSubmissionResponse<T> = Readonly<{
  createdTask: AgentTask | null;
  outcome: { type: "started"; result: T } | { type: "failed"; error: unknown };
}>;
