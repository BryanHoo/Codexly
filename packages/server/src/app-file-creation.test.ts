import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  encodedProjectRootPath,
  projectRootPath,
} from "./app-all.test-support.js";

describe("project file creation route", () => {
  it("returns the authoritative directory and deduplicates retried requests", async () => {
    const { provider } = createProvider();
    const createProjectFile = vi.fn(() => Promise.resolve({ path: "docs/new.txt" }));
    const tree = { entries: [{ path: "docs/new.txt", type: "file" as const }], path: "docs" };
    const readProjectFileTree = vi.fn(() => Promise.resolve(tree));
    const app = await createCodexlyServer(
      createServerOptions(provider, { createProjectFile, readProjectFileTree }),
    );
    closeCallbacks.push(() => app.close());
    const request = {
      method: "POST" as const,
      url: `/v1/projects/codexly/files/create?rootPath=${encodedProjectRootPath}`,
      headers: { "idempotency-key": "create-file-1" },
      payload: { parentPath: "docs", name: "new.txt", type: "file" },
    };
    const response = await app.inject(request);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ path: "docs/new.txt", tree });
    expect((await app.inject(request)).json()).toEqual(response.json());
    expect(createProjectFile).toHaveBeenCalledExactlyOnceWith(projectRootPath, request.payload);
    expect(readProjectFileTree).toHaveBeenCalledExactlyOnceWith(projectRootPath, "docs");
  });

  it("maps name collisions to 409 and rejects invalid names before mutation", async () => {
    const { provider } = createProvider();
    const createProjectFile = vi.fn(() => {
      throw new TypeError("Project file target already exists");
    });
    const app = await createCodexlyServer(createServerOptions(provider, { createProjectFile }));
    closeCallbacks.push(() => app.close());
    const url = `/v1/projects/codexly/files/create?rootPath=${encodedProjectRootPath}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { "idempotency-key": "collision" },
          payload: { parentPath: null, name: "existing", type: "directory" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { "idempotency-key": "invalid" },
          payload: { parentPath: null, name: "../escape", type: "file" },
        })
      ).statusCode,
    ).toBe(400);
    expect(createProjectFile).toHaveBeenCalledTimes(1);
  });
});
