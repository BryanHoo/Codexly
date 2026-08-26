import { describe, expect, it, vi } from "vitest";

import {
  readFileNavigationViewPreference,
  writeFileNavigationViewPreference,
} from "./file-navigation-view-preference.js";

describe("file navigation view preference", () => {
  it("defaults to tree and restores only a valid versioned mode", () => {
    expect(readFileNavigationViewPreference("changes", { getItem: () => null })).toBe("tree");
    expect(
      readFileNavigationViewPreference("review", {
        getItem: () => JSON.stringify({ mode: "list", version: 1 }),
      }),
    ).toBe("list");
    expect(
      readFileNavigationViewPreference("changes", {
        getItem: () => JSON.stringify({ mode: "grid", version: 1 }),
      }),
    ).toBe("tree");
    expect(
      readFileNavigationViewPreference("review", {
        getItem: () => JSON.stringify({ mode: "list", version: 2 }),
      }),
    ).toBe("tree");
  });

  it("persists the latest mode without blocking on storage failures", () => {
    const setItem = vi.fn();

    writeFileNavigationViewPreference("review", "list", { setItem });
    writeFileNavigationViewPreference("changes", "tree", { setItem });

    expect(setItem).toHaveBeenNthCalledWith(
      1,
      "codexly:workbench:file-navigation-view:review:v1",
      JSON.stringify({ mode: "list", version: 1 }),
    );
    expect(setItem).toHaveBeenNthCalledWith(
      2,
      "codexly:workbench:file-navigation-view:changes:v1",
      JSON.stringify({ mode: "tree", version: 1 }),
    );
    expect(() => {
      writeFileNavigationViewPreference("review", "list", {
        setItem: () => {
          throw new Error("storage unavailable");
        },
      });
    }).not.toThrow();
  });
});
