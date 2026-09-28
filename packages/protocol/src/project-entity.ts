import { FormatRegistry, Type, type Static } from "@sinclair/typebox";

import { ProjectRootsSchema, type ProjectRoots } from "./project-root.js";

if (!FormatRegistry.Has("date-time")) {
  // HTTP 边界统一使用可解析的 ISO 时间，避免各层重复实现时间格式校验。
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}

export const DateTimeSchema = Type.String({ format: "date-time" });
export const NullableDateTimeSchema = Type.Union([DateTimeSchema, Type.Null()]);

export const ProjectSchema = Type.Object(
  {
    createdAt: DateTimeSchema,
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    roots: ProjectRootsSchema,
  },
  { additionalProperties: false },
);

type ProjectValue = Static<typeof ProjectSchema>;
export type Project = Readonly<Omit<ProjectValue, "roots"> & { roots: ProjectRoots }>;
