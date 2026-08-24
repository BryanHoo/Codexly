import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import {
  projectRootPath,
  encodedProjectRootPath,
  closeCallbacks,
  createProvider,
  createServerOptions,
} from "./app-all.test-support.js";

describe("server project files", () => {
  it("serves paginated local source previews for the configured project", async () => {
    const { provider } = createProvider();
    const readProjectSourceFile = vi.fn((_projectRoot: string, _path: string, cursor = 0) =>
      Promise.resolve(
        cursor === 0
          ? {
              content: "### 11.7 认证\n",
              nextCursor: 24,
              path: "/home/test/reports/architecture-design.md",
            }
          : {
              content: "后续内容\n",
              nextCursor: null,
              path: "/home/test/reports/architecture-design.md",
            },
      ),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectSourceFile }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/files/source?path=%2Fhome%2Ftest%2Freports%2Farchitecture-design.md&rootPath=${encodedProjectRootPath}`,
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/other/files/source?path=docs%2Farchitecture-design.md&rootPath=${encodedProjectRootPath}`,
    });
    const nextPageResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/files/source?cursor=24&path=%2Fhome%2Ftest%2Freports%2Farchitecture-design.md&rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      content: "### 11.7 认证\n",
      nextCursor: 24,
      path: "/home/test/reports/architecture-design.md",
    });
    expect(readProjectSourceFile).toHaveBeenCalledWith(
      projectRootPath,
      "/home/test/reports/architecture-design.md",
      0,
    );
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(nextPageResponse.statusCode).toBe(200);
    expect(nextPageResponse.json()).toEqual({
      content: "后续内容\n",
      nextCursor: null,
      path: "/home/test/reports/architecture-design.md",
    });
    expect(readProjectSourceFile).toHaveBeenLastCalledWith(
      projectRootPath,
      "/home/test/reports/architecture-design.md",
      24,
    );
    expect(readProjectSourceFile).toHaveBeenCalledTimes(2);
  });

  it("serves verified Project image previews without MIME sniffing", async () => {
    const { provider } = createProvider();
    const imageContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const readProjectImageFile = vi.fn(() =>
      Promise.resolve({
        content: imageContent,
        mediaType: "image/png" as const,
        path: "design/result.png",
      }),
    );
    const app = await createCodeAgentServer(
      createServerOptions(provider, { readProjectImageFile }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/files/image?path=%2Fworkspace%2FCodeAgent%2Fdesign%2Fresult.png&rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload).toEqual(imageContent);
    expect(readProjectImageFile).toHaveBeenCalledWith(
      projectRootPath,
      "/workspace/CodeAgent/design/result.png",
    );
  });

  it("serves one file tree directory only for the configured project", async () => {
    const { provider } = createProvider();
    const readProjectFileTree = vi.fn(() =>
      Promise.resolve({
        entries: [{ path: "src/main.tsx", type: "file" as const }],
        path: "src",
      }),
    );
    const app = await createCodeAgentServer(createServerOptions(provider, { readProjectFileTree }));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/files/tree?path=src&rootPath=${encodedProjectRootPath}`,
    });
    const missingProjectResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/other/files/tree?rootPath=${encodedProjectRootPath}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      entries: [{ path: "src/main.tsx", type: "file" }],
      path: "src",
    });
    expect(readProjectFileTree).toHaveBeenCalledWith(projectRootPath, "src");
    expect(missingProjectResponse.statusCode).toBe(404);
    expect(readProjectFileTree).toHaveBeenCalledTimes(1);
  });

  it("searches project files for path text references", async () => {
    const { provider } = createProvider();
    const searchProjectFiles = vi.fn(() => Promise.resolve({ data: [] }));
    const stopProjectFileSearch = vi.fn(() => Promise.resolve());
    const app = await createCodeAgentServer(
      createServerOptions(provider, { searchProjectFiles, stopProjectFileSearch }),
    );
    closeCallbacks.push(() => app.close());

    const search = await app.inject({
      method: "GET",
      url: `/v1/projects/code-agent/files/search?query=main&rootPath=${encodedProjectRootPath}&sessionId=search-1`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual({ data: [] });
    expect(searchProjectFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "code-agent",
        query: "main",
        roots: [projectRootPath],
        sessionId: "search-1",
      }),
    );

    const stopped = await app.inject({
      headers: { "idempotency-key": "stop-search-1" },
      method: "POST",
      payload: { rootPath: projectRootPath, sessionId: "search-1" },
      url: "/v1/projects/code-agent/files/search/stop",
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toEqual({});
    expect(stopProjectFileSearch).toHaveBeenCalledWith("code-agent", "search-1");
  });
});
