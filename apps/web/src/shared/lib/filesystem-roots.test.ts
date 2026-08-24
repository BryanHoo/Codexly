import { describe, expect, it } from "vitest";

import { findActiveFilesystemRoot } from "./filesystem-roots.js";

describe("filesystem roots", () => {
  it("matches a Windows path to its drive without case sensitivity", () => {
    const roots = [
      { name: "C:", path: "C:\\" },
      { name: "D:", path: "D:\\" },
    ];

    expect(findActiveFilesystemRoot(roots, "d:\\Projects\\Codexly")).toEqual(roots[1]);
  });
});
