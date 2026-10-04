import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

it("submits a bounded idempotent history maintenance request and validates acknowledgement", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "scheduled" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed" })));
  const client = new CodexlyClient({ baseUrl: "http://localhost", fetch });
  expect(await client.compressHistory({ idempotencyKey: "compress-1" })).toEqual({
    status: "scheduled",
  });
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("http://localhost/v1/history/compress");
  expect(options.method).toBe("POST");
  expect(new Headers(options.headers).get("idempotency-key")).toBe("compress-1");
  expect(options.body).toBe("{}");
  await expect(client.compressHistory()).rejects.toThrow();
});
