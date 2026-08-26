import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildProjectFilePopupUrl,
  openProjectFileInNewWindow,
  parseProjectFilePopupSearch,
} from "./project-file-popup.js";

describe("project file popup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a standalone preview URL with the selected root and source location", () => {
    const url = buildProjectFilePopupUrl(
      "https://codexly.test/p/project-1/t/task-1",
      "project-1",
      { lineNumber: 18, path: "docs/guide.md" },
      "/workspace/Codexly",
    );

    expect(url).toBe(
      "https://codexly.test/p/project-1/file?path=docs%2Fguide.md&previewKind=source&lineNumber=18&rootPath=%2Fworkspace%2FCodexly",
    );
    expect(
      parseProjectFilePopupSearch({
        lineNumber: "18",
        path: "docs/guide.md",
        previewKind: "source",
        rootPath: "/workspace/Codexly",
      }),
    ).toEqual({
      lineNumber: 18,
      path: "docs/guide.md",
      previewKind: "source",
      rootPath: "/workspace/Codexly",
    });
  });

  it("requests minimal browser chrome for internally previewable files", () => {
    const open = vi.fn();
    const onOpenSystemDefault = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://codexly.test/p/project-1/t/task-1" },
      open,
    });

    openProjectFileInNewWindow({
      onOpenSystemDefault,
      projectId: "project-1",
      reference: { lineNumber: null, path: "src/main.ts" },
      rootPath: "/workspace/Codexly",
    });

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "https://codexly.test/p/project-1/file?path=src%2Fmain.ts&previewKind=source&rootPath=%2Fworkspace%2FCodexly",
      "codexly-project-file-popup",
      "popup,width=1100,height=800,resizable=yes,scrollbars=yes",
    );
    expect(onOpenSystemDefault).not.toHaveBeenCalled();
  });

  it("keeps unsupported files on the system-default path", () => {
    const open = vi.fn();
    const onOpenSystemDefault = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://codexly.test/p/project-1" },
      open,
    });

    openProjectFileInNewWindow({
      onOpenSystemDefault,
      projectId: "project-1",
      reference: { lineNumber: null, path: "slides/demo.pptx" },
      rootPath: "/workspace/Codexly",
    });

    expect(open).not.toHaveBeenCalled();
    expect(onOpenSystemDefault).toHaveBeenCalledWith("slides/demo.pptx");
  });
});
