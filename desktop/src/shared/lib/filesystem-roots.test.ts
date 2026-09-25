import { describe, expect, it } from "vitest";

import { findActiveFilesystemRoot } from "./filesystem-roots.js";

const roots = [
  { name: "C:\\", path: "C:\\" },
  { name: "D:\\", path: "D:\\" },
] as const;

describe("findActiveFilesystemRoot", () => {
  it("匹配 Windows canonicalize 返回的 verbatim 磁盘路径", () => {
    expect(findActiveFilesystemRoot(roots, "\\\\?\\D:\\Projects")?.path).toBe("D:\\");
  });
});
