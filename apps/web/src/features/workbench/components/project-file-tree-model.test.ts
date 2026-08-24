import type { ProjectFileTree } from "@code-agent/protocol";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  PROJECT_FILE_TREE_ROOT_ID,
  PROJECT_FILE_TREE_PROJECT_ROOT_ID,
  createProjectFileTreeDataLoader,
  getProjectFileTreeItemId,
} from "./project-file-tree-model.js";

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("project file tree model", () => {
  it("loads each directory once through the existing query cache", async () => {
    const listings = new Map<string | null, ProjectFileTree>([
      [
        null,
        {
          entries: [
            { path: "src", type: "directory" },
            { path: "README.md", type: "file" },
          ],
          path: null,
        },
      ],
      [
        "src",
        {
          entries: [{ path: "src/main.tsx", type: "file" }],
          path: "src",
        },
      ],
    ]);
    const listProjectFiles = vi.fn((_projectId: string, _rootPath: string, path: string | null) => {
      const listing = listings.get(path);
      if (listing === undefined) return Promise.reject(new Error("missing fixture"));
      return Promise.resolve(listing);
    });
    const loader = createProjectFileTreeDataLoader({
      client: { listProjectFiles },
      projectId: "project-1",
      projectName: "CodeAgent",
      queryClient: createQueryClient(),
      rootPath: "/workspace/CodeAgent",
    });

    await expect(loader.getItem(PROJECT_FILE_TREE_PROJECT_ROOT_ID)).resolves.toMatchObject({
      kind: "root",
      name: "CodeAgent",
    });
    await expect(loader.getChildrenWithData(PROJECT_FILE_TREE_ROOT_ID)).resolves.toEqual([
      {
        data: { kind: "root", name: "CodeAgent", type: "directory" },
        id: PROJECT_FILE_TREE_PROJECT_ROOT_ID,
      },
    ]);
    const rootChildren = await loader.getChildrenWithData(PROJECT_FILE_TREE_PROJECT_ROOT_ID);
    expect(rootChildren.map(({ id }) => id)).toEqual(["src", "README.md"]);
    expect(rootChildren[0]?.data).toMatchObject({ kind: "entry", path: "src" });

    await expect(loader.getChildrenWithData("src")).resolves.toMatchObject([
      { data: { kind: "entry", path: "src/main.tsx", type: "file" }, id: "src/main.tsx" },
    ]);
    await loader.getChildrenWithData("src");

    expect(listProjectFiles).toHaveBeenCalledTimes(2);
    expect(listProjectFiles).toHaveBeenNthCalledWith(
      1,
      "project-1",
      "/workspace/CodeAgent",
      null,
      expect.any(Object),
    );
    expect(listProjectFiles).toHaveBeenNthCalledWith(
      2,
      "project-1",
      "/workspace/CodeAgent",
      "src",
      expect.any(Object),
    );
  });

  it("turns empty and failed directory loads into stable status items", async () => {
    const listProjectFiles = vi.fn((_projectId: string, _rootPath: string, path: string | null) => {
      if (path === "broken") return Promise.reject(new Error("permission denied"));
      return Promise.resolve({ entries: [], path } satisfies ProjectFileTree);
    });
    const loader = createProjectFileTreeDataLoader({
      client: { listProjectFiles },
      projectId: "project-1",
      projectName: "CodeAgent",
      queryClient: createQueryClient(),
      rootPath: "/workspace/CodeAgent",
    });

    await expect(
      loader.getChildrenWithData(PROJECT_FILE_TREE_PROJECT_ROOT_ID),
    ).resolves.toMatchObject([{ data: { kind: "status", status: "empty" } }]);
    await expect(loader.getChildrenWithData("broken")).resolves.toMatchObject([
      {
        data: {
          directoryPath: "broken",
          kind: "status",
          message: "permission denied",
          status: "error",
        },
      },
    ]);
  });

  it("keeps internal ids outside the project-relative path namespace", () => {
    expect(PROJECT_FILE_TREE_ROOT_ID.startsWith("\0")).toBe(true);
    expect(PROJECT_FILE_TREE_PROJECT_ROOT_ID.startsWith("\0")).toBe(true);
    expect(PROJECT_FILE_TREE_PROJECT_ROOT_ID).not.toBe(PROJECT_FILE_TREE_ROOT_ID);
    expect(getProjectFileTreeItemId({ path: "src/main.tsx", type: "file" })).toBe("src/main.tsx");
  });
});
