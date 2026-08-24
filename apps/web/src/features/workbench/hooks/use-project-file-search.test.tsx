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
          rootId: "root-codexly",
          rootPath: "/workspace/Codexly",
        },
      ],
    };
    const client = {
      searchProjectFiles: vi.fn(() => Promise.resolve(page)),
      stopProjectFileSearch: vi.fn(() => Promise.resolve({})),
    };
    const options = projectFileSearchQueryOptions(
      client,
      "codexly",
      "/workspace/Codexly",
      "search-1",
      "main",
      true,
    );

    expect(options.queryKey).toEqual([
      "projects",
      "codexly",
      "/workspace/Codexly",
      "file-search",
      "search-1",
      "main",
    ]);
    expect(options.enabled).toBe(true);
    await expect(options.queryFn?.({ signal: controller.signal } as never)).resolves.toEqual(page);
    expect(client.searchProjectFiles).toHaveBeenCalledWith(
      "codexly",
      "/workspace/Codexly",
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
      "codexly",
      "/workspace/Codexly",
      "search-1",
    );
    await vi.waitFor(() => {
      expect(stopProjectFileSearch).toHaveBeenCalledWith(
        "codexly",
        "/workspace/Codexly",
        "search-1",
      );
    });
  });
});
