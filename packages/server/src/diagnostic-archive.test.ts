import Fastify, { type FastifyInstance } from "fastify";
import type { SaveDiagnosticsResponse } from "@codexly/protocol";
import cookie from "@fastify/cookie";
import { afterEach, expect, it, vi } from "vitest";
import { registerDiagnosticArchiveRoutes } from "./diagnostic-archive.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.useRealTimers();
});
async function setup() {
  const app = Fastify();
  apps.push(app);
  await app.register(cookie);
  registerDiagnosticArchiveRoutes(app);
  await app.ready();
  return app;
}
const payload = { application: JSON.stringify({ browser: { logs: [] }, server: { logs: [] } }) };

it("creates one integrated ZIP and serves it once only to its owning session", async () => {
  const app = await setup();
  const response = await app.inject({
    method: "POST",
    url: "/v1/diagnostics/archive",
    payload,
    cookies: { codexly_session: "owner" },
  });
  expect(response.statusCode).toBe(200);
  const { downloadId, fileName } = response.json<SaveDiagnosticsResponse>();
  expect(fileName).toMatch(/\.zip$/u);
  const url = `/v1/diagnostics/downloads/${downloadId}`;
  expect((await app.inject({ url, cookies: { codexly_session: "other" } })).statusCode).toBe(404);
  const download = await app.inject({ url, cookies: { codexly_session: "owner" } });
  expect(download.statusCode).toBe(200);
  expect(download.headers["cache-control"]).toBe("no-store");
  expect(download.headers["content-type"]).toBe("application/zip");
  expect(download.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(download.rawPayload.toString()).toContain("application.json");
  expect(download.rawPayload.toString()).toContain('"runtime":"acp"');
  expect((await app.inject({ url, cookies: { codexly_session: "owner" } })).statusCode).toBe(404);
});

it("bounds pending exports and expires unused downloads", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const app = await setup();
  const first = await app.inject({ method: "POST", url: "/v1/diagnostics/archive", payload });
  expect(first.statusCode).toBe(200);
  await app.inject({ method: "POST", url: "/v1/diagnostics/archive", payload });
  expect(
    (await app.inject({ method: "POST", url: "/v1/diagnostics/archive", payload })).statusCode,
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
      (await app.inject({ method: "POST", url: "/v1/diagnostics/archive", payload })).statusCode,
    ).toBe(200);
  });
});

it("delivers exports over a real HTTP connection after the request body completes", async () => {
  const app = await setup();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const result = await fetch(`${address}/v1/diagnostics/archive`, {
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
