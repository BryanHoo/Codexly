import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../platform/tauri/native-invoke.js", () => ({ invoke }));

import { openProjectFileInNewWindow } from "./project-file-popup.js";

describe("project file popup", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      location: { href: "tauri://localhost/p/project-a/task/task-a" },
      open: vi.fn(),
    });
  });

  it("opens source files through a dedicated native window", () => {
    openProjectFileInNewWindow({
      onOpenSystemDefault: vi.fn(),
      projectId: "project-a",
      reference: { lineNumber: 12, path: "src/main.ts" },
      rootPath: "/workspace/project-a",
      taskId: "task-a",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("open_project_file_window", {
      route: expect.stringMatching(
        /^p\/project-a\/file\?.*path=src%2Fmain\.ts.*taskId=task-a.*window=project-file/u,
      ),
    });
  });
});
