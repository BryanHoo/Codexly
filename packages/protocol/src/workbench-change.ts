import { Type, type Static } from "@sinclair/typebox";

// 工作区只广播资源身份；正文、问题答案与附件仍通过已鉴权的读取接口取得。
export const WorkbenchChangeSchema = Type.Union([
  Type.Object({ type: Type.Literal("workbench.ready") }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal("project-todos.changed"),
      projectId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("async-questions.changed"),
      projectId: Type.String({ minLength: 1 }),
      taskId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);
export type WorkbenchChange = Readonly<Static<typeof WorkbenchChangeSchema>>;
