import { configureServerDelivery } from "../server-delivery.js";
import Fastify from "fastify";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { registerProjectTextFileRoutes } from "./project-text-file-routes.js";

it("reads full text, saves with a version and rejects stale or malformed writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-text-route-"));
  await writeFile(join(root, "a.txt"), "old");
  const app = Fastify();
  await configureServerDelivery(app, { releaseResources: () => Promise.resolve() });
  registerProjectTextFileRoutes(app, (projectId) => {
    if (projectId !== "test") throw new Error("invalid");
    return Promise.resolve({ id: "root", path: root });
  });
  try {
    const url = "/v1/projects/test/files/text?rootPath=" + encodeURIComponent(root);
    const read = await app.inject({ url: url + "&path=a.txt" });
    expect(read.statusCode).toBe(200);
    const input = {
      path: "a.txt",
      content: "new",
      expectedVersion: read.json<{ version: string }>().version,
    };
    expect((await app.inject({ url, method: "POST", payload: input })).statusCode).toBe(200);
    expect((await app.inject({ url, method: "POST", payload: input })).statusCode).toBe(409);
    expect(
      (await app.inject({ url, method: "POST", payload: { path: "a.txt", content: "invalid" } }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ url: url + "&path=../outside" })).statusCode).toBe(400);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
