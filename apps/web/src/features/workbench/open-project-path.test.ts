import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { buildProjectFileDownloadUrl } from "@codexly/client";

import { openProjectPath } from "./open-project-path.js";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

describe("文件打开与下载边界", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["project-1", "/workspace/worktree", "/tmp/中文 100%.pptx"],
    ["temporary", undefined, "C:\\Users\\user\\result.xlsx"],
  ])("%s 的下载动作保留文件路径和工作目录", async (projectId, rootPath, path) => {
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: () => link, body: { append } });
    const client = { openProject: vi.fn() };
    await openProjectPath(client, {
      isLanAccess: true,
      projectId,
      request: { appId: "system-default", path },
      ...(rootPath === undefined ? {} : { rootPath }),
    });

    expect(client.openProject).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
    const action = vi.mocked(toast.info).mock.calls[0]?.[1]?.action;
    if (typeof action !== "object" || action === null || !("onClick" in action))
      throw new Error("缺少下载动作");
    action.onClick({} as never);

    expect(link.href).toBe(buildProjectFileDownloadUrl("", projectId, path, rootPath));
    expect(link.download).toBe(path.split(/[\\/]/u).at(-1));
    expect(append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
  });

  it("取消的打开动作不再展示提示或启动应用", async () => {
    const client = { openProject: vi.fn() };
    const controller = new AbortController();
    controller.abort();
    await expect(
      openProjectPath(client, {
        isLanAccess: true,
        projectId: "project-1",
        request: { appId: "system-default", path: "demo.zip" },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(client.openProject).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
