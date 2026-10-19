import { Type } from "@sinclair/typebox";

import { DateTimeSchema } from "./project-entity.js";
import { AgentEngineSchema } from "./agent-engine.js";

// 任务列表的公共字段由两端共用，扩展字段由各自的传输协议组合。
export const AgentTaskBaseSchema = Type.Object(
  {
    engine: Type.Optional(AgentEngineSchema),
    id: Type.String({ minLength: 1 }),
    pinned: Type.Boolean(),
    projectId: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);
