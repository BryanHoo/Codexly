import { Type, type Static } from "@sinclair/typebox";
import { AgentTaskSchema } from "./agent-attachments.js";

export const TaskCatalogQuerySchema = Type.Object(
  { pinned: Type.Optional(Type.Literal(true)) },
  { additionalProperties: false },
);
export const AgentTaskCatalogSchema = Type.Object(
  { data: Type.Array(AgentTaskSchema, { maxItems: 10000 }) },
  { additionalProperties: false },
);
export type AgentTaskCatalog = Readonly<Static<typeof AgentTaskCatalogSchema>>;
