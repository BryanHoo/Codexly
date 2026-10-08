import { describe, expect, it } from "vitest";

import {
  classifyProjectFileReference,
  classifyMessageAttachment,
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
    expect(getProjectFileManagerOpenPath("/workspace/src/main.ts", "linux")).toBe("/workspace/src");
    expect(getProjectFileManagerOpenPath("C:\\workspace\\src\\main.ts", "win32")).toBe(
      "C:\\workspace\\src",
    );
  });
});

describe("PDF previews", () => {
  it.each(["report.pdf", "/tmp/generated.PDF", "C:\\reports\\报告.pdf"])("previews %s", (path) => {
    expect(classifyProjectFileReference(path)).toBe("pdf");
  });
  it("previews large PDF attachments by MIME type or extension", () => {
    for (const [name, mediaType] of [
      ["report.PDF", "application/octet-stream"],
      ["report", "application/pdf"],
    ] as const) {
      expect(
        classifyMessageAttachment({
          id: "pdf",
          kind: "file",
          name,
          mediaType,
          size: 8 * 1024 * 1024,
        }),
      ).toBe("pdf");
    }
  });
});
