import { expect, it, vi } from "vitest";
import { CodexlyClient, CodexlyResponseError } from "./http-client.js";

it("reads diagnostics using the configured transport and rejects malformed snapshots", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        version: 1,
        exportedAt: "2026-10-23T00:00:00.000Z",
        runtime: {
          nodeVersion: "v24.0.0",
          platform: "linux",
          arch: "x64",
          uptimeSeconds: 2,
          memoryBytes: 100,
        },
        logs: [],
        droppedEntries: 0,
      }),
    ),
  );
  const client = new CodexlyClient({ fetch, baseUrl: "http://localhost:3210" });
  expect(await client.getDiagnostics()).toMatchObject({ version: 1, logs: [] });
  expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:3210/v1/diagnostics");
  fetch.mockResolvedValue(new Response(JSON.stringify({ logs: "invalid" })));
  await expect(client.getDiagnostics()).rejects.toBeInstanceOf(CodexlyResponseError);
});
