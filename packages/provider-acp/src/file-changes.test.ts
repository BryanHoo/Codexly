import { expect, it } from "vitest";
import { projectAcpFileChanges } from "./file-changes.js";

it("v1 Diff 保留中文路径，区分创建和清空，不能把空文件推断为删除", () => {
  const result = projectAcpFileChanges(
    [
      { type: "diff", path: "/repo/新建.ts", newText: "new" },
      { type: "diff", path: "/repo/清空.ts", oldText: "old", newText: "" },
    ],
    65536,
  );
  expect(result.map(({ path, kind }) => ({ path, kind }))).toEqual([
    { path: "/repo/新建.ts", kind: "create" },
    { path: "/repo/清空.ts", kind: "update" },
  ]);
  expect(result[0]?.diff).toContain("+new");
  expect(result[1]?.diff).toContain("-old");
});

it("超预算保留路径，同一路径使用最新正文，文件数量有界", () => {
  const result = projectAcpFileChanges(
    [
      { type: "diff", path: "/a", oldText: "old", newText: "new" },
      { type: "diff", path: "/a", oldText: "new", newText: "latest" },
    ],
    65536,
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.diff).toContain("+latest");
  expect(
    projectAcpFileChanges([{ type: "diff", path: "/a", newText: "large".repeat(100) }], 1)[0],
  ).toEqual({ path: "/a", kind: "create", diff: "" });
  expect(
    projectAcpFileChanges(
      Array.from({ length: 200 }, (_, i) => ({ type: "diff", path: `/${String(i)}`, newText: "" })),
      0,
    ),
  ).toHaveLength(128);
});
