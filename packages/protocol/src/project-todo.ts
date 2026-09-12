import { Type, type Static } from "@sinclair/typebox";
import { AgentMessageAttachmentSchema } from "./agent-attachments.js";
import { AgentSkillSchema } from "./agent-task.js";
import { ProjectFileSearchEntrySchema } from "./project-files.js";

export const PromptDocumentPartSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("text"), text: Type.String({ maxLength: 200000 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("skill"), skill: AgentSkillSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("file"), file: ProjectFileSearchEntrySchema },
    { additionalProperties: false },
  ),
]);
export type PromptDocumentPart = Readonly<Static<typeof PromptDocumentPartSchema>>;
export const ProjectTodoDraftSchema = Type.Object(
  {
    content: Type.Array(PromptDocumentPartSchema, { maxItems: 2000 }),
    attachments: Type.Array(AgentMessageAttachmentSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type ProjectTodoDraft = Readonly<Static<typeof ProjectTodoDraftSchema>>;
export const ProjectTodoSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    version: Type.Integer({ minimum: 1 }),
    draft: ProjectTodoDraftSchema,
  },
  { additionalProperties: false },
);
export type ProjectTodo = Readonly<Static<typeof ProjectTodoSchema>>;
export const ProjectTodoPageSchema = Type.Object(
  { data: Type.Array(ProjectTodoSchema) },
  { additionalProperties: false },
);
export const ProjectTodoResponseSchema = Type.Object(
  { todo: ProjectTodoSchema },
  { additionalProperties: false },
);
export const SaveProjectTodoRequestSchema = Type.Object(
  {
    draft: ProjectTodoDraftSchema,
    expectedVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type SaveProjectTodoRequest = Readonly<Static<typeof SaveProjectTodoRequestSchema>>;
export const DeleteProjectTodoRequestSchema = Type.Object(
  { expectedVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const DeleteProjectTodoResponseSchema = Type.Object(
  { deleted: Type.Boolean() },
  { additionalProperties: false },
);
