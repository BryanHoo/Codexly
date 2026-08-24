import { describe, expect, it, vi } from "vitest";

import {
  projectFileSearchQueryOptions,
  stopProjectFileSearchSession,
} from "./use-project-file-search.js";

describe("projectFileSearchQueryOptions", () => {
  it("scopes file search by Project and forwards query cancellation", async () => {
    const controller = new AbortController();
    const page = {
      data: [
        {
          name: "main.tsx",
          path: "src/main.tsx",
          rootId: "root-code-agent",
          rootPath: "/workspace/CodeAgent",
        },
      ],
    };
    const client = {
      searchProjectFiles: vi.fn(() => Promise.resolve(page)),
      stopProjectFileSearch: vi.fn(() => Promise.resolve({})),
    };
    const options = projectFileSearchQueryOptions(
      client,
      "code-agent",
      "/workspace/CodeAgent",
      "search-1",
      "main",
      true,
    );

    expect(options.queryKey).toEqual([
      "projects",
      "code-agent",
      "/workspace/CodeAgent",
      "file-search",
      "search-1",
      "main",
    ]);
    expect(options.enabled).toBe(true);
    await expect(options.queryFn?.({ signal: controller.signal } as never)).resolves.toEqual(page);
    expect(client.searchProjectFiles).toHaveBeenCalledWith(
      "code-agent",
      "/workspace/CodeAgent",
      "main",
      "search-1",
      {
        signal: controller.signal,
      },
    );
  });

  it("stops a search session without surfacing cleanup failures", async () => {
    const stopProjectFileSearch = vi.fn(() => Promise.reject(new Error("connection closed")));

    stopProjectFileSearchSession(
      { searchProjectFiles: vi.fn(), stopProjectFileSearch },
      "code-agent",
      "/workspace/CodeAgent",
      "search-1",
    );
    await vi.waitFor(() => {
      expect(stopProjectFileSearch).toHaveBeenCalledWith(
        "code-agent",
        "/workspace/CodeAgent",
        "search-1",
      );
    });
  });
});
