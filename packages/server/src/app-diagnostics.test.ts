import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

it("exports sanitized recent logs and runtime metadata without querying version services", async () => {
  const readAppInfo = vi.fn(() => Promise.reject(new Error("offline")));
  const output: string[] = [];
  const app = await createCodexlyServer(
    createServerOptions(createProvider().provider, {
      loggerEnabled: true,
      readAppInfo,
      logDestination: {
        write: (line: string) => {
          output.push(line);
        },
      },
    }),
  );
  closeCallbacks.push(() => app.close());
  app.log.error(
    { errorCode: "TEST_FAILURE", req: { headers: { cookie: "secret" } } },
    "private message",
  );
  const response = await app.inject("/v1/diagnostics");
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.json()).toMatchObject({
    version: 1,
    runtime: { nodeVersion: process.version },
    logs: [expect.stringContaining("TEST_FAILURE")],
  });
  expect(response.body).not.toContain("secret");
  expect(response.body).not.toContain("private message");
  expect(output).toHaveLength(1);
  expect(readAppInfo).not.toHaveBeenCalled();
});

it("requires a paired session when LAN access is enabled", async () => {
  const app = await createCodexlyServer(
    createServerOptions(createProvider().provider, {
      access: { pairingCode: "test-code", sessionTtlMs: 86_400_000 },
    }),
  );
  closeCallbacks.push(() => app.close());
  expect((await app.inject("/v1/diagnostics")).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/diagnostics/codex",
        payload: { application: "{}" },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await app.inject("/v1/diagnostics/downloads/8a8f6c43-7407-4ebd-8636-7e0fc5269cb4")).statusCode,
  ).toBe(401);
  const paired = await app.inject({
    method: "POST",
    url: "/v1/access/pair",
    payload: { code: "test-code" },
  });
  const response = await app.inject({
    url: "/v1/diagnostics",
    cookies: { codexly_session: paired.cookies[0]?.value ?? "" },
  });
  expect(response.statusCode).toBe(200);
});

it("keeps terminal streams quiet while retaining diagnostic logs by default", async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, { loggerEnabled: true }),
    );
    closeCallbacks.push(() => app.close());
    app.log.info({ event: "test_operation" }, "operation completed");
    app.log.warn({ diagnosticCode: "TEST_WARNING" }, "runtime warning");
    app.log.error({ errorCode: "TEST_FAILURE" }, "runtime failure");
    const rejected = await app.inject({ method: "PUT", url: "/v1/settings", payload: {} });
    expect(rejected.statusCode).toBe(400);
    const response = await app.inject("/v1/diagnostics");
    expect(response.statusCode).toBe(200);
    expect(response.json<{ logs: string[] }>().logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("test_operation"),
        expect.stringContaining("TEST_WARNING"),
        expect.stringContaining("TEST_FAILURE"),
        expect.stringContaining('"statusCode":400'),
      ]),
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
