import { Type, type Static } from "@sinclair/typebox";
import { ProjectRelativePathSchema } from "./project-files.js";
import { ProjectFileTreeSchema } from "./project-git.js";
import { projectFileCreationNamePattern } from "./project-file-creation-name.js";

// 创建协议独立成模块，避免不使用该能力的桌面首屏承担 Schema 初始化与包体。
export const CreateProjectFileRequestSchema = Type.Object(
  {
    parentPath: Type.Union([ProjectRelativePathSchema, Type.Null()]),
    name: Type.String({ minLength: 1, maxLength: 255, pattern: projectFileCreationNamePattern }),
    type: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
  },
  { additionalProperties: false },
);
export type CreateProjectFileRequest = Readonly<Static<typeof CreateProjectFileRequestSchema>>;
export const CreateProjectFileResponseSchema = Type.Object(
  { path: ProjectRelativePathSchema, tree: ProjectFileTreeSchema },
  { additionalProperties: false },
);
export type CreateProjectFileResponse = Readonly<Static<typeof CreateProjectFileResponseSchema>>;
