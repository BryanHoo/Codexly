import { describe, expect, it } from "vitest";

import { findActiveFilesystemRoot } from "./filesystem-roots.js";

describe("filesystem roots", () => {
  it("按目录边界和最长根匹配，保留 POSIX 大小写", () => {
    const roots = [
      { name: "root", path: "/" },
      { name: "work", path: "/srv/Work" },
      { name: "nested", path: "/srv/Work/project" },
    ];
    expect(findActiveFilesystemRoot(roots, "/srv/Work/project/src")).toBe(roots[2]);
    expect(findActiveFilesystemRoot(roots, "/srv/Workspace")).toBe(roots[0]);
    expect(findActiveFilesystemRoot(roots, "/srv/work/a")).toBe(roots[0]);
  });

  it("Windows 根匹配兼容两种分隔符和命名空间前缀", () => {
    const roots = [{ name: "work", path: "C:\\Work" }];
    expect(findActiveFilesystemRoot(roots, "c:/Work/src")).toBe(roots[0]);
    expect(findActiveFilesystemRoot(roots, "\\\\?\\C:\\Work\\src")).toBe(roots[0]);
    expect(findActiveFilesystemRoot(roots, "C:\\Workspace")).toBeUndefined();
  });
  it("matches a Windows path to its drive without case sensitivity", () => {
    const roots = [
      { name: "C:", path: "C:\\" },
      { name: "D:", path: "D:\\" },
    ];

    expect(findActiveFilesystemRoot(roots, "d:\\Projects\\Codexly")).toEqual(roots[1]);
  });
});
