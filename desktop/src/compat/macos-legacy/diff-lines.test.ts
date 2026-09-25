import { expect, test } from "vitest";
import { legacyDiffLines } from "./diff-lines.js";

test("Legacy diff preserves changed lines and both line numbers", () => {
  const lines = legacyDiffLines("--- a/a.ts\n+++ b/a.ts\n@@ -3,2 +3,2 @@\n keep\n-old\n+new\n");
  expect(lines.slice(1)).toEqual([
    { kind: " ", text: "keep", oldLine: 3, newLine: 3 },
    { kind: "-", text: "old", oldLine: 4, newLine: null },
    { kind: "+", text: "new", oldLine: null, newLine: 4 },
  ]);
});

test("Malformed patches remain visible as plain text", () => {
  expect(legacyDiffLines("not a patch")[0]?.text).toBe("not a patch");
});
