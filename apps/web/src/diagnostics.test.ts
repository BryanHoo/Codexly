import { afterEach, expect, it, vi } from "vitest";
import { BrowserDiagnosticBuffer, exportDiagnostics } from "./diagnostics.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("bounds browser records and strips credentials, application context and URL queries", () => {
  const buffer = new BrowserDiagnosticBuffer();
  for (let index = 0; index < 150; index++)
    buffer.record({
      event: "window_error",
      level: "error",
      errorMessage: `failure ${String(index)}`,
      stack: "at render (https://private.example/assets/app.js?token=private:2:3)",
      context: { prompt: "private" },
    });
  buffer.record({
    event: "window_error",
    level: "error",
    errorMessage: "Bearer secret-key",
    stack: null,
    context: {},
  });
  const snapshot = buffer.snapshot();
  expect(snapshot.logs).toHaveLength(100);
  expect(snapshot.droppedEntries).toBe(51);
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(JSON.stringify(snapshot)).not.toContain("secret-key");
  expect(snapshot.logs.at(-1)?.errorMessage).toContain("redacted");
});

it("downloads one integrated ZIP without buffering its body in the browser", async () => {
  const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "" };
  vi.stubGlobal("document", { createElement: () => anchor, body: { append: vi.fn() } });
  vi.stubGlobal("navigator", { userAgent: "Test browser", language: "zh-CN" });
  const client = {
    saveDiagnostics: vi.fn((_input: { application: string }) =>
      Promise.resolve({
        downloadId: "download-id",
        fileName: "codexly-diagnostics-web-1.zip",
      }),
    ),
    diagnosticsDownloadUrl: vi.fn(() => "/v1/diagnostics/downloads/download-id"),
    getDiagnostics: vi.fn(() =>
      Promise.resolve({
        version: 1 as const,
        exportedAt: "2026-10-23T00:00:00Z",
        runtime: {
          nodeVersion: "v24",
          platform: "linux",
          arch: "x64",
          uptimeSeconds: 1,
          memoryBytes: 1,
        },
        logs: [],
        droppedEntries: 0,
      }),
    ),
  };
  const name = await exportDiagnostics(client, { appVersion: "0.41.0", codexVersion: "0.163.0" });
  expect(name).toBe("codexly-diagnostics-web-1.zip");
  expect(anchor.href).toBe("/v1/diagnostics/downloads/download-id");
  expect(anchor.click).toHaveBeenCalledOnce();
  const input = client.saveDiagnostics.mock.calls[0]?.[0];
  if (!input) throw new Error("No application diagnostics prepared");
  expect(JSON.parse(input.application)).toMatchObject({
    version: 1,
    manifest: { appVersion: "0.41.0", codexVersion: "0.163.0" },
    server: { logs: [] },
    browser: { userAgent: "Test browser" },
  });
  expect(anchor.remove).toHaveBeenCalledOnce();
  client.getDiagnostics.mockRejectedValueOnce(new Error("offline"));
  await expect(exportDiagnostics(client)).rejects.toThrow("offline");
  expect(anchor.click).toHaveBeenCalledOnce();
});
