import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

it("routes Claude extension reads and mutations with an isolated project identity", async () => {
  const fetch = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response('{"data":[]}', { headers: { "content-type": "application/json" } }),
    ),
  );
  const client = new CodexlyClient({ baseUrl: "http://localhost", fetch });
  await client.listClaudeExtensions("mcp", "project/a");
  await client.mutateClaudeExtension(
    { kind: "skills", action: "disable", id: "review", scope: "local" },
    "project/a",
  );
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "http://localhost/v1/engines/claude/extensions?kind=mcp&projectId=project%2Fa",
  );
  expect(fetch.mock.calls[1]?.[0]).toBe(
    "http://localhost/v1/engines/claude/extensions?projectId=project%2Fa",
  );
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ kind: "skills", action: "disable", id: "review", scope: "local" }),
  });
});
