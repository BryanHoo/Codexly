import { Type, type Static } from "@sinclair/typebox";
import { ProjectRootPathSchema } from "./project-root.js";

// 使用跨平台可移植的单层名称，避免分隔符、Windows 设备名和尾随空格改变目标路径。
export function isValidProjectDirectoryName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name === name.trim() &&
    !/[<>:"/\\|?*]/u.test(name) &&
    !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
    !/[. ]$/u.test(name) &&
    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
  );
}

export const CreateProjectDirectoryRequestSchema = Type.Object(
  {
    parentPath: ProjectRootPathSchema,
    name: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type CreateProjectDirectoryRequest = Static<typeof CreateProjectDirectoryRequestSchema>;

export const CreateProjectDirectoryResponseSchema = Type.Object(
  {
    path: ProjectRootPathSchema,
    status: Type.Union([
      Type.Literal("created"),
      Type.Literal("exists-directory"),
      Type.Literal("exists-file"),
    ]),
  },
  { additionalProperties: false },
);
export type CreateProjectDirectoryResponse = Static<typeof CreateProjectDirectoryResponseSchema>;
