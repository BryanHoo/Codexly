import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { createProjectFileTreeDataLoader } from "./project-file-tree-model.js";

it.each([
  {paths: ["src/main.ts", "src/.DS_Store", "src/._main.ts", "src/Thumbs.db", "src/desktop.ini"], expected: [{data: {kind: "entry", path: "src/main.ts"}}]},
  {paths: ["src/.DS_Store"], expected: [{data: {kind: "status", status: "empty"}}]},
])("桌面文件树隐藏系统元数据并正确展示空目录：$paths", async ({paths, expected}) => {
  const loader = createProjectFileTreeDataLoader({
    client: { listProjectFiles: () => Promise.resolve({entries: paths.map(path => ({path, type: "file" as const})), path: "src"}) },
    projectId: "p", projectName: "项目", rootPath: "/workspace", queryClient: new QueryClient(),
  });
  expect(await loader.getChildrenWithData("src")).toMatchObject(expected);
});
