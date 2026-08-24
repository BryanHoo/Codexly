import { describe, expect, it } from "vitest";

import {
  countFileChangeLines,
  normalizeFileChangePatch,
  summarizeFileChanges,
} from "./file-change.js";

describe("file change view model", () => {
  it("counts patch body lines without counting file headers", () => {
    expect(
      countFileChangeLines({
        diff: "--- a/package.json\n+++ b/package.json\n@@ -1,2 +1,3 @@\n-old\n+new\n+next",
        kind: "update",
        path: "package.json",
      }),
    ).toEqual({ additions: 2, removals: 1 });
  });

  it("counts canonical created and deleted file patches", () => {
    expect(
      countFileChangeLines({
        diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+first\n+second",
        kind: "create",
        path: "new.ts",
      }),
    ).toEqual({ additions: 2, removals: 0 });
    expect(
      countFileChangeLines({
        diff: "--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-first\n-second",
        kind: "delete",
        path: "old.ts",
      }),
    ).toEqual({ additions: 0, removals: 2 });
  });

  it("normalizes a line-only provider diff into a renderable unified patch", () => {
    const patch = normalizeFileChangePatch({
      diff: "-const oldValue = true;\n+const nextValue = true;",
      kind: "update",
      path: "src/config.ts",
    });

    expect(patch).toContain("--- a/src/config.ts");
    expect(patch).toContain("+++ b/src/config.ts");
    expect(patch).toContain("@@ -1,1 +1,1 @@");
    expect(patch).toContain("-const oldValue = true;");
    expect(patch).toContain("+const nextValue = true;");
  });

  it("preserves a canonical created file patch for the diff renderer", () => {
    const patch = "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+first\n+-second";
    expect(normalizeFileChangePatch({ diff: patch, kind: "create", path: "src/new.ts" })).toBe(
      patch,
    );
  });

  it("summarizes unique files with their latest response diff", () => {
    const firstChange = {
      diff: "@@ -1 +1 @@\n-old\n+middle",
      kind: "update" as const,
      path: "src\\config.ts",
    };
    const latestChange = {
      diff: "@@ -1 +1,2 @@\n-middle\n+new\n+next",
      kind: "update" as const,
      path: "src/config.ts",
    };
    const createdChange = {
      diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+first\n+second",
      kind: "create" as const,
      path: "src/new.ts",
    };

    expect(summarizeFileChanges([firstChange, latestChange, createdChange])).toEqual({
      additions: 4,
      changes: [latestChange, createdChange],
      removals: 1,
    });
  });
});
