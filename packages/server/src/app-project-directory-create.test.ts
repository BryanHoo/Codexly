import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions, closeCallbacks } from "./app-all.test-support.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("create project directory", () => {
  it("rejects creation outside configured workspace roots", async () => {
    const parentPath = await mkdtemp(join(tmpdir(), "codexly-outside-"));
    const workspace = await mkdtemp(join(tmpdir(), "codexly-workspace-"));
    directories.push(parentPath, workspace);
    const { provider } = createProvider();
    const app = await createCodexlyServer(
      createServerOptions(provider, { workspaceRoots: [workspace] }),
    );
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method: "POST",
      url: "/v1/project-directories",
      headers: { "idempotency-key": "outside-root" },
      payload: { parentPath, name: "demo" },
    });
    expect(response.statusCode).toBe(400);
    await expect(stat(join(parentPath, "demo"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("creates one child, replays the request, and distinguishes existing directories and files", async () => {
    const parentPath = await mkdtemp(join(tmpdir(), "codexly-create-"));
    directories.push(parentPath);
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());
    const request = {
      method: "POST" as const,
      url: "/v1/project-directories",
      headers: { "idempotency-key": "create-child" },
      payload: { parentPath, name: "new-project" },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "created" });
    expect((await stat(join(parentPath, "new-project"))).isDirectory()).toBe(true);
    expect((await app.inject(request)).json()).toEqual(first.json());
    expect(
      (await app.inject({ ...request, headers: { "idempotency-key": "existing" } })).json(),
    ).toMatchObject({ status: "exists-directory" });
    await writeFile(join(parentPath, "file"), "keep");
    expect(
      (
        await app.inject({
          ...request,
          headers: { "idempotency-key": "file" },
          payload: { parentPath, name: "file" },
        })
      ).json(),
    ).toMatchObject({ status: "exists-file" });
    expect(await readFile(join(parentPath, "file"), "utf8")).toBe("keep");
    for (const name of ["..", "../escape", "a/b", "a\\b", "", " ", "CON", "trailing."]) {
      const response = await app.inject({
        ...request,
        headers: { "idempotency-key": `invalid-${name}` },
        payload: { parentPath, name },
      });
      expect(response.statusCode, name).toBe(400);
    }
  });
});
