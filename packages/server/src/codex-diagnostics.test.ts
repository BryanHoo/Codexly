import Fastify, { type FastifyInstance } from "fastify";
import type { SaveDiagnosticsResponse } from "@codexly/protocol";
import cookie from "@fastify/cookie";
import { access, writeFile, symlink, open } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerCodexDiagnosticRoutes } from "./codex-diagnostics.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});
async function setup(saveCodexDiagnostics?: (path: string) => Promise<void>) {
  const app = Fastify();
  apps.push(app);
  await app.register(cookie);
  registerCodexDiagnosticRoutes(app, saveCodexDiagnostics ? { saveCodexDiagnostics } : {});
  await app.ready();
  return app;
}
const payload = { application: JSON.stringify({ browser: { logs: [] }, server: { logs: [] } }) };
const zip = Buffer.from("504b030400000000", "hex");

it("creates one integrated ZIP and serves it once only to its owning session", async () => {
  let savedPath = "";
  const save = vi.fn(async (path: string) => {
    savedPath = path;
    await writeFile(path, zip);
  });
  const app = await setup(save);
  const response = await app.inject({
    method: "POST",
    url: "/v1/diagnostics/codex",
    payload,
    cookies: { codexly_session: "owner" },
  });
  expect(response.statusCode).toBe(200);
  const { downloadId, fileName } = response.json<SaveDiagnosticsResponse>();
  expect(fileName).toMatch(/\.zip$/u);
  expect(response.body).not.toContain(dirname(savedPath));
  const url = `/v1/diagnostics/downloads/${downloadId}`;
  expect((await app.inject({ url, cookies: { codexly_session: "other" } })).statusCode).toBe(404);
  const download = await app.inject({ url, cookies: { codexly_session: "owner" } });
  expect(download.statusCode).toBe(200);
  expect(download.headers["cache-control"]).toBe("no-store");
  expect(download.headers["content-type"]).toBe("application/zip");
  expect(download.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  // 外层使用存储方式嵌入原生 ZIP，确保内容原样保留且只交付一个文件。
  expect(download.rawPayload.includes(zip)).toBe(true);
  expect(download.rawPayload.toString()).toContain("application.json");
  expect(download.rawPayload.toString()).toContain('"status":"included"');
  expect((await app.inject({ url, cookies: { codexly_session: "owner" } })).statusCode).toBe(404);
  await app.close();
  await expect(access(dirname(savedPath))).rejects.toThrow();
});

it("retains application diagnostics and explicitly records unavailable native diagnostics", async () => {
  const app = await setup(() => Promise.reject(new Error("private runtime detail")));
  const result = await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload });
  const download = await app.inject(
    `/v1/diagnostics/downloads/${result.json<SaveDiagnosticsResponse>().downloadId}`,
  );
  expect(download.statusCode).toBe(200);
  expect(download.rawPayload.toString()).toContain('"status":"unavailable"');
  expect(download.rawPayload.toString()).not.toContain("private runtime detail");
  expect(download.rawPayload.toString()).not.toContain("codex/diagnostics.zip");
});

it("bounds pending exports and expires unused downloads", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const app = await setup();
  const first = await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload });
  expect(first.statusCode).toBe(200);
  await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload });
  expect(
    (await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload })).statusCode,
  ).toBe(429);
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
  expect(
    (
      await app.inject(
        `/v1/diagnostics/downloads/${first.json<SaveDiagnosticsResponse>().downloadId}`,
      )
    ).statusCode,
  ).toBe(404);
  // 文件异步删除完成后才释放容量，避免磁盘清理期间重复占用导出预算。
  await vi.waitFor(async () => {
    expect(
      (await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload })).statusCode,
    ).toBe(200);
  });
});

it("rejects symlinked native files without exposing their contents", async () => {
  const app = await setup(async (path) => {
    await symlink("/etc/passwd", path);
  });
  const result = await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload });
  const download = await app.inject(
    `/v1/diagnostics/downloads/${result.json<SaveDiagnosticsResponse>().downloadId}`,
  );
  expect(download.rawPayload.toString()).toContain('"status":"unavailable"');
  expect(download.rawPayload.toString()).not.toContain("root:");
});

it("rejects oversized native files while preserving the application ZIP", async () => {
  const app = await setup(async (path) => {
    const file = await open(path, "w");
    await file.truncate(256 * 1024 * 1024 + 1);
    await file.close();
  });
  const result = await app.inject({ method: "POST", url: "/v1/diagnostics/codex", payload });
  const download = await app.inject(
    `/v1/diagnostics/downloads/${result.json<SaveDiagnosticsResponse>().downloadId}`,
  );
  expect(download.rawPayload.toString()).toContain('"status":"unavailable"');
  expect(download.rawPayload.length).toBeLessThan(4096);
});

it("delivers exports over a real HTTP connection after the request body completes", async () => {
  const app = await setup();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const result = await fetch(`${address}/v1/diagnostics/codex`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(result.status).toBe(200);
  const { downloadId } = (await result.json()) as { downloadId: string };
  const download = await fetch(`${address}/v1/diagnostics/downloads/${downloadId}`);
  expect(download.status).toBe(200);
  expect(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 4)
      .toString("hex"),
  ).toBe("504b0304");
});
