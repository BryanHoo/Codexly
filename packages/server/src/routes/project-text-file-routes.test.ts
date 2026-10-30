import { configureServerDelivery } from "../server-delivery.js";
import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { registerProjectTextFileRoutes } from "./project-text-file-routes.js";

it.each([
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "\n"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "\r\n"],
  ["Mozilla/5.0 (X11; Linux x86_64)", "\n"],
  ["Mozilla/5.0 (X11; Linux x86_64)", "\r\n"],
])("HTTP 按宿主路径与文件换行读写，不受浏览器 %s 影响（%j）", async (agent, newline) => {
  const root = await mkdtemp(join(tmpdir(), "codexly-跨系统-"));
  const path = "中文 & #+/文档 +%#.txt";
  await mkdir(join(root, "中文 & #+"));
  const original = `\uFEFF中文 😀${newline}第二行${newline}`;
  await writeFile(join(root, path), original);
  const app = Fastify();
  await configureServerDelivery(app, { releaseResources: () => Promise.resolve() });
  registerProjectTextFileRoutes(app, () => Promise.resolve({ id: "root", path: root }));
  const headers = { "user-agent": agent };
  const url = "/v1/projects/test/files/text?";
  try {
    // 查询参数只做 URL 编码；不能按访问设备把宿主路径换成另一种系统格式。
    const read = await app.inject({
      url: url + new URLSearchParams({ rootPath: root, path }).toString(),
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ path, content: original });
    const content = original.replace("第二行", "已编辑 🚀");
    const input = { path, content, expectedVersion: read.json<{ version: string }>().version };
    const saved = await app.inject({
      url: url + new URLSearchParams({ rootPath: root }).toString(),
      method: "POST",
      payload: input,
      headers,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      version: createHash("sha256").update(content).digest("hex"),
    });
    expect(await readFile(join(root, path))).toEqual(Buffer.from(content, "utf8"));
    expect(
      (
        await app.inject({
          url: url + new URLSearchParams({ rootPath: root }).toString(),
          method: "POST",
          payload: input,
          headers,
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

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
    const revision = await app.inject({
      url: url.replace("/files/text?", "/files/text/revision?") + "&path=a.txt",
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.json()).toEqual({ revision: read.json<{ revision: string }>().revision });
    expect(revision.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await app.inject({
          url: url.replace("/files/text?", "/files/text/revision?") + "&path=../outside",
        })
      ).statusCode,
    ).toBe(400);
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
