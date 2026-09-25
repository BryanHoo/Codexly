import { describe, expect, it, vi } from "vitest";
import { searchFiles } from "./search-files.js";
const projects = Array.from({ length: 6 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  createdAt: "2026-09-15T00:00:00Z",
  roots: [{ id: `r${i}`, path: `/p${i}` }],
}));

describe("global file search", () => {
  it("limits concurrency and preserves available roots when one fails", async () => {
    let active = 0;
    let peak = 0;
    const client = {
      stopProjectFileSearch: vi.fn(),
      searchProjectFiles: vi.fn(async (projectId: string, rootPath: string) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        if (projectId === "p1") throw new Error("permission denied");
        return {
          data: [{ name: "a.ts", path: "a.ts", rootId: projectId, rootPath }],
        };
      }),
    };
    const page = await searchFiles(
      client,
      projects,
      "a",
      new AbortController().signal,
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(page.files).toHaveLength(5);
    expect(page.failedRoots).toEqual(["Project 1: /p1"]);
  });
  it("does not launch scans for an already cancelled query", async () => {
    const client = {
      stopProjectFileSearch: vi.fn(),
      searchProjectFiles: vi.fn(),
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchFiles(client, projects, "a", controller.signal),
    ).rejects.toThrow(/abort/i);
    expect(client.searchProjectFiles).not.toHaveBeenCalled();
  });
  it("bounds retained and displayed file results", async () => {
    const client = {
      stopProjectFileSearch: vi.fn(),
      searchProjectFiles: vi.fn(async () => ({
        data: Array.from({ length: 50 }, (_, i) => ({
          name: `${i}.ts`,
          path: `${i}.ts`,
          rootId: "r",
          rootPath: "/p",
        })),
      })),
    };
    const page = await searchFiles(
      client,
      projects,
      "ts",
      new AbortController().signal,
    );
    expect(page.files).toHaveLength(50);
    expect(page.truncated).toBe(true);
  });
});
