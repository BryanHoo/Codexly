import { describe, expect, it } from "vitest";

import {
  createProjectOpenRequest,
  getProjectFileContainingFolderPath,
  getProjectFileManagerOpenPath,
} from "./project-file-reference.js";

describe("project file containing folder", () => {
  it("keeps temporary task identity in containing-folder requests", () => {
    expect(
      createProjectOpenRequest(
        {
          appId: "explorer",
          fallbackToExistingAncestor: true,
          path: "C:\\workspace\\missing",
        },
        "task-a",
      ),
    ).toEqual({
      appId: "explorer",
      fallbackToExistingAncestor: true,
      path: "C:\\workspace\\missing",
      taskId: "task-a",
    });
  });

  it.each([
    ["/workspace/src/main.ts", "/workspace/src"],
    ["/main.ts", "/"],
    ["src/main.ts", "src"],
    ["main.ts", undefined],
    ["C:\\workspace\\src\\main.ts", "C:\\workspace\\src"],
  ])("resolves %s to %s", (path, expected) => {
    expect(getProjectFileContainingFolderPath(path)).toBe(expected);
  });

  it("preserves the file path for Finder reveal and uses the parent elsewhere", () => {
    expect(getProjectFileManagerOpenPath("/workspace/src/main.ts", "darwin")).toBe(
      "/workspace/src/main.ts",
    );
    expect(getProjectFileManagerOpenPath("/workspace/src/main.ts", "linux")).toBe(
      "/workspace/src",
    );
    expect(getProjectFileManagerOpenPath("C:\\workspace\\src\\main.ts", "win32")).toBe(
      "C:\\workspace\\src",
    );
  });
});
