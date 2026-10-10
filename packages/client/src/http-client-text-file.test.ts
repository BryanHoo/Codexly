import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";
it("reads and conditionally saves project text through the shared contract", async () => {
  const version = "a".repeat(64);
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ path: "a.md", content: "# A", version }))
    .mockResolvedValueOnce(jsonResponse({ version }));
  const client = new CodexlyClient({ fetch: fetchMock });
  expect(await client.readProjectTextFile("project", "/root", "a.md")).toEqual({
    path: "a.md",
    content: "# A",
    version,
  });
  await client.saveProjectTextFile("project", "/root", {
    path: "a.md",
    content: "# B",
    expectedVersion: version,
  });
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "/v1/projects/project/files/text?path=a.md&rootPath=%2Froot",
  );
  expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
    path: "a.md",
    content: "# B",
    expectedVersion: version,
  });
});

it("preserves the conflict code for the editor instead of accepting a stale save", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      jsonResponse(
        { code: "TEXT_FILE_CONFLICT", message: "File changed", retryable: false },
        { status: 409 },
      ),
    );
  const client = new CodexlyClient({ fetch: fetchMock });
  await expect(
    client.saveProjectTextFile("project", "/root", {
      path: "a.md",
      content: "mine",
      expectedVersion: "a".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "TEXT_FILE_CONFLICT", status: 409 });
});
