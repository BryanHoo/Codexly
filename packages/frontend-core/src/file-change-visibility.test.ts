import { expect, it } from "vitest";
import { isEmptyFileUpdate } from "./file-change-visibility.js";

it.each(["", "--- a/a.ts\n+++ b/a.ts\n", "--- a/a.ts\r\n+++ b/a.ts\r\n"])(
  "识别已加载的空操作：%s",
  (diff) => {
    expect(isEmptyFileUpdate({ kind: "update", diff })).toBe(true);
  },
);

it.each([
  { kind: "create", diff: "" },
  { kind: "delete", diff: "" },
  { kind: "update", diff: "", truncated: true },
  { kind: "update", diff: "", stats: { additions: 1, removals: 0 } },
  { kind: "update", diff: "Binary files a/a and b/a differ" },
  { kind: "update", diff: "diff --git a/a b/a\nold mode 100644\nnew mode 100755" },
  { kind: "update", diff: "diff --git a/a b/b\nrename from a\nrename to b" },
  { kind: "update", diff: "@@ -1 +1 @@\n-old\n+new" },
])("保留实际或尚不可判断的变更：%j", (change) => {
  expect(isEmptyFileUpdate(change)).toBe(false);
});
