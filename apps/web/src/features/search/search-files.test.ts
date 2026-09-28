import { describe, expect, it, vi } from "vitest";

import { searchFiles } from "./search-files.js";

const projects = Array.from({ length: 6 }, (_, index) => ({
  id: `p${String(index)}`,
  name: `Project ${String(index)}`,
  createdAt: "2026-09-15T00:00:00Z",
  roots: [{ id: `r${String(index)}`, path: `/p${String(index)}` }],
}));

function clientWithResults(count: number) {
  return {
    stopProjectFileSearch: vi.fn(),
    searchProjectFiles: vi.fn((projectId: string, rootPath: string) =>
      Promise.resolve({
        data: Array.from({ length: count }, (_, index) => ({
          name: `${String(index)}.ts`,
          path: `${String(index)}.ts`,
          rootId: projectId,
          rootPath,
        })),
      }),
    ),
  };
}

describe("global file search result limit", () => {
  it("stops dispatching roots after one root fills the result limit", async () => {
    const client = clientWithResults(50);
    const page = await searchFiles(client, projects, "ts", new AbortController().signal);

    expect(client.searchProjectFiles).toHaveBeenCalledTimes(2);
    expect(page.files).toHaveLength(50);
    expect(page.truncated).toBe(true);
  });

  it("stops dispatching roots when concurrent results reach the limit", async () => {
    const client = clientWithResults(25);
    const page = await searchFiles(client, projects, "ts", new AbortController().signal);

    expect(client.searchProjectFiles).toHaveBeenCalledTimes(3);
    expect(page.files).toHaveLength(50);
    expect(page.truncated).toBe(true);
  });

  it("does not mark a complete search with exactly 50 results as truncated", async () => {
    const client = clientWithResults(25);
    const page = await searchFiles(
      client,
      projects.slice(0, 2),
      "ts",
      new AbortController().signal,
    );

    expect(client.searchProjectFiles).toHaveBeenCalledTimes(2);
    expect(page.files).toHaveLength(50);
    expect(page.truncated).toBe(false);
  });
});
