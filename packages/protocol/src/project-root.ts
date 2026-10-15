import { Type, type Static } from "@sinclair/typebox";

export const ProjectRootPathSchema = Type.String({
  maxLength: 32_768,
  minLength: 1,
  pattern: "^(?!.*[\\u0000\\r\\n])(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\[^\\\\/]+[\\\\/][^\\\\/]+).*$",
});

export type ProjectRootPath = Static<typeof ProjectRootPathSchema>;

export const ProjectRootIdSchema = Type.String({ maxLength: 64, minLength: 1 });

export type ProjectRootId = Static<typeof ProjectRootIdSchema>;

export const ProjectRootInputSchema = Type.Object(
  { path: ProjectRootPathSchema },
  { additionalProperties: false },
);

export type ProjectRootInput = Readonly<Static<typeof ProjectRootInputSchema>>;

export const ProjectRootSchema = Type.Object(
  { id: ProjectRootIdSchema, path: ProjectRootPathSchema },
  { additionalProperties: false },
);

export type ProjectRoot = Readonly<Static<typeof ProjectRootSchema>>;

// 保留 roots 的传输形状以减少两端联动成本，但领域上严格限定一个磁盘文件夹。
export const ProjectRootsSchema = Type.Readonly(
  Type.Array(ProjectRootSchema, {
    minItems: 1,
    maxItems: 1,
    uniqueItems: true,
  }),
);

export type ProjectRoots = readonly ProjectRoot[];

export const ProjectRootInputsSchema = Type.Readonly(
  Type.Array(ProjectRootInputSchema, {
    minItems: 1,
    maxItems: 1,
    uniqueItems: true,
  }),
);

export type ProjectRootInputs = readonly ProjectRootInput[];

export const ProjectRootQuerySchema = Type.Object(
  { rootPath: ProjectRootPathSchema },
  { additionalProperties: false },
);

export type ProjectRootQuery = Readonly<Static<typeof ProjectRootQuerySchema>>;
