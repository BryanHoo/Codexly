import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "@codexly/ui/core/notifications";

import { prepareSearchFile } from "./open-search-file.js";

vi.mock("@codexly/ui/core/notifications", () => ({ toast: { info: vi.fn() } }));

describe("远程文件打开", () => {
  afterEach(() => vi.clearAllMocks());

  const file = {
    projectId: "project-1",
    projectName: "Demo",
    rootId: "root-1",
    rootPath: "/workspace/demo",
    path: "slides/中文 100%.pptx",
    name: "中文 100%.pptx",
  };

  it.each(["pptx", "docx", "xlsx", "zip", "mp4", "mp3", "pages", "7z"])(
    "局域网点击 %s 时提示下载，不请求服务端启动应用",
    async (extension) => {
      const client = { openProject: vi.fn(), readProjectSourceFile: vi.fn() };
      const result = await prepareSearchFile(
        client,
        new QueryClient(),
        { ...file, path: `slides/demo.${extension}` },
        undefined,
        true,
      );

      expect(result).toBeNull();
      expect(client.openProject).not.toHaveBeenCalled();
      expect(client.readProjectSourceFile).not.toHaveBeenCalled();
      const [title, options] = vi.mocked(toast.info).mock.calls[0] ?? [];
      expect(title).toBe("请下载后使用系统应用打开");
      expect(options?.description).toContain("浏览器无法直接打开当前设备的系统应用");
      const action = options?.action;
      if (!action) throw new Error("缺少下载动作");
      expect(action.label).toBe("下载文件");
      expect(typeof action.onClick).toBe("function");
    },
  );

  it("未知二进制文件无法读取为源码时也提示下载", async () => {
    const client = {
      openProject: vi.fn(),
      readProjectSourceFile: vi.fn().mockRejectedValue(new Error("Source file is unavailable")),
    };
    const cache = new QueryClient();
    await prepareSearchFile(client, cache, { ...file, path: "model.custom" }, undefined, true);

    expect(client.openProject).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledOnce();
    cache.clear();
  });

  it("本机点击 PPT 时继续交给系统默认应用", async () => {
    const client = { openProject: vi.fn(), readProjectSourceFile: vi.fn() };
    await prepareSearchFile(client, new QueryClient(), file);

    expect(client.openProject).toHaveBeenCalledWith(
      file.projectId,
      file.rootPath,
      { appId: "system-default", path: file.path },
      {},
    );
    expect(toast.info).not.toHaveBeenCalled();
  });
});
