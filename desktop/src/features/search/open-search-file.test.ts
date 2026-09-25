import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { prepareSearchFile } from "./open-search-file.js";

const file = {
  projectId: "p",
  projectName: "项目",
  rootPath: "/project",
  rootId: "r",
  path: "data.bin",
  name: "data.bin",
};
describe("search file opening", () => {
  it("falls back to the default application when text preview is unsupported", async () => {
    const client = {
      readProjectSourceFile: vi.fn().mockRejectedValue(new Error("binary")),
      cacheProjectImage: vi.fn(),
      openProject: vi.fn().mockResolvedValue({}),
    };
    const result = await prepareSearchFile(
      client,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      file,
    );
    expect(result).toBeNull();
    expect(client.openProject).toHaveBeenCalledWith("p", "/project", {
      appId: "system-default",
      path: "data.bin",
    });
  });
  it("does not read document formats into the WebView", async () => {
    const client = {
      readProjectSourceFile: vi.fn(),
      cacheProjectImage: vi.fn(),
      openProject: vi.fn().mockResolvedValue({}),
    };
    expect(
      await prepareSearchFile(client, new QueryClient(), {
        ...file,
        path: "report.pdf",
      }),
    ).toBeNull();
    expect(client.readProjectSourceFile).not.toHaveBeenCalled();
    expect(client.openProject).toHaveBeenCalledTimes(1);
  });
});
